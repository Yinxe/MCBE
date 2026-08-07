// ─── 事件桥接：MC 世界事件 → 领域事件 + 索引/统计内存联动 ──
// 这是"MC 无容器内容事件"问题的解法落点（三层兜底之第一层 代理信号）：
//   · playerInteractWithBlock —— 玩家手动改箱的"代理信号"→ reconcile 惰性校验索引 + 统计失效
//   · playerPlaceBlock —— 区域内放容器 → 工厂创建适配器 + 注册进仓库/索引 + 发结构事件
//   · playerBreakBlock / blockExplode —— 拆容器 → 注销（双箱半拆：occupiedLocations 过滤 + 主坐标重定）
//   · 结构变更发 **containerAdded / containerRegistryChanged / containerRemoved**，
//     持久化由 main.ts 的中央订阅订阅者负责（每容器一条键、事件驱动）——此处只管
//     内存注册表/索引联动，不亲自写 DP、无 markDirty、无定时 flush。
//   · 主循环（每 5 tick）—— scheduler.tick() 驱动路由/生命周期 + stats.tick() 递减预警冷却
// 路由移动（itemRouted）的索引/统计：itemRouted → main.ts 扫描目标 → containerScanned
// （统计单容器写穿）；索引 itemRouted 不落盘（卸载/离仓时按每容器条目落盘，重载后惰性自愈）。
import { world, system, type Block } from "@minecraft/server";
import type { EventBus } from "../../core/events/DomainEvents";
import type { ItemIndex } from "../../core/index/ItemIndex";
import type { StatsService } from "../../core/stats/StatsService";
import type { Scheduler } from "../../core/scheduling/Scheduler";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Container } from "../../core/model/Container";
import { findContainerAt, findWarehouseAt } from "../../core/model/Area";
import { isSupportedContainerType } from "../../core/model/ContainerTypes";
import { locationKey, type ContainerId, type Location, type WarehouseId } from "../../core/model/types";
import { containerIdOf, primaryLocationOf, containerIdPointsTo } from "../../core/model/ContainerId";
import { itemTypeSignature } from "../../core/model/ItemTypeSignature";
import { registerContainer, unregisterContainer, rebaseContainer } from "../../core/model/ContainerRegistry";
import type { McContainerFactory } from "./McContainerFactory";
import type { McContainerAdapter } from "./McContainerAdapter";

export interface EventBridgeDeps {
  bus: EventBus;
  /** 每仓库索引解析（隔离：由 Scheduler 持有，激活加载/空闲卸载） */
  resolveIndex: (warehouseId: WarehouseId) => ItemIndex | undefined;
  stats: StatsService;
  scheduler: Scheduler;
  factory: McContainerFactory;
  /** 当前已加载仓库（Phase 4 填充） */
  warehouses: () => Warehouse[];
  /** 命中容器前按需加载该仓（防启动即点/激活竞态；成员交互通常已激活，此处幂等兜底） */
  ensureContainersLoaded: (warehouse: Warehouse) => void;
  /** 单仓最大容器数（放置注册校验；来自模组配置） */
  getMaxContainers: () => number;
}

const MAIN_TICK_INTERVAL = 5; // 全局主任务：调度轮询（路由/生命周期，非持久化）

// ── 容器 GUI 生命周期事件的结构类型（低版兼容） ──
// blockContainerOpened/Closed 只存在于较新游戏（约 1.21.16x+）。当前 SDK 2.6.0 没有它们的
// 类型定义，这里用**结构类型** + 运行时 `!== undefined` 特性检测订阅：
//   · 编译期不依赖 2.8 类型 → 与共享 @yinxe/toolkit（2.6.0）类型一致，不产生跨包冲突
//   · 运行期在新游戏（有该事件）→ 生效；老游戏（无该事件）→ world.afterEvents 上
//     该属性为 undefined → 跳过订阅、不报错（优雅降级，由既有 interact 代理+惰性自愈兜底）
interface ContainerAccessEvent {
  block: Block;
  openSource?: { entity?: { typeId?: string } };
  closeSource?: { entity?: { typeId?: string } };
}
interface ContainerAccessSignal {
  subscribe(cb: (e: ContainerAccessEvent) => void): void;
}
type ContainerAccessSignals = {
  blockContainerOpened?: ContainerAccessSignal;
  blockContainerClosed?: ContainerAccessSignal;
};

/**
 * 事件桥接：把 MC 世界事件（放置/拆除/交互/方块爆炸）翻译为领域事件 + 索引/统计内存联动。
 *  - 放块 → 注册/双箱合并；拆块 → 注销/半拆重定；交互代理信号 → reconcile 惰性校验。
 *  - 结构变更发 container-added / container-registry-changed / container-removed，
 *    持久化由 Subscriptions 订阅者负责（本类不碰 DP、无定时 flush）。
 *  - 主循环（每 5 tick）驱动 scheduler.tick() + stats.tick()。
 */
export class McEventBridge {
  /** 开箱时记录的容器"物品类型签名"（关箱对比用；仅玩家来源、受支持容器的当前会话） */
  private readonly openSignatures = new Map<string, string>();

  constructor(private readonly deps: EventBridgeDeps) {}

  start(): void {
    const { bus, stats, scheduler, factory } = this.deps;

    // 代理信号：玩家交互带容器方块 → 三层兜底第二层（reconcile 惰性校验）+ 统计失效
    world.afterEvents.playerInteractWithBlock.subscribe((e) => {
      try {
        if (!e.isFirstEvent) return;
        // ⚠️ 提前窄化：本事件对全维度所有方块触发，只关心**受支持容器**——非容器方块
        //    （绝大多数交互：草/土/门/……）不查仓库/容器，直接跳过（省 findWarehouseAt 遍历）
        if (!isSupportedContainerType(e.block.typeId)) return;
        const hit = this.locate(e.block);
        if (!hit) return;
        this.deps.resolveIndex(hit.warehouse.id)?.reconcile(hit.container);
        // ⚠️ 不在此解除输入阻塞态：玩家开箱不一定改动物品（只点开/看），
        //    过早解除会让下个轮询重堵重报（更吵）。阻塞态交给 Scheduler.processOnce
        //    下一次调度对"空输入"自检清除（取走物品→空 → 自动解除）。
        stats.invalidate(hit.container.id);
        bus.containerChanged.trigger({
          type: "container-changed",
          warehouseId: hit.warehouse.id,
          containerId: hit.container.id,
        });
      } catch (err) {
        console.warn(`[ItemRoute] interact 事件处理失败: ${err}`);
      }
    });

    // ── 容器 GUI 生命周期：开箱记录类型、关箱对比变化才重建索引 ──
    // 玩家"开箱→关箱"整段会话的手动改动没有逐格内容事件；interact（开箱瞬间）reconcile
    // 时物品还没放=白扫。这里用 blockContainerOpened/Closed（新游戏才有的高级 API）：
    //   · 开箱：记录该容器当前"物品类型集合"签名
    //   · 关箱：重算签名，若与开箱时不同 → 重建索引 + 失效统计（一次收敛整段编辑会话）
    //   类型集合没变（只点开/看、移动同类型）→ 跳过，不浪费重建。
    // ⚠️ 低版兼容：blockContainerOpened/Closed 约 1.21.16x 游戏才有。cast 为可选签名（可能
    //    undefined），运行时 `!== undefined` 特性检测——老游戏缺该事件 → 跳过订阅、不报错
    //    （优雅降级，仍由既有 interact 代理 + 策略侧惰性校验兜底）。
    const containerSignals = world.afterEvents as unknown as ContainerAccessSignals;
    if (containerSignals.blockContainerOpened !== undefined && containerSignals.blockContainerClosed !== undefined) {
      containerSignals.blockContainerOpened.subscribe((e) => {
        try {
          if (!isSupportedContainerType(e.block.typeId)) return;
          if (e.openSource?.entity?.typeId !== "minecraft:player") return; // 排除漏斗/自动化
          const hit = this.locate(e.block);
          if (!hit) return;
          const key = this.signatureKey(hit.warehouse.id, hit.container.id);
          this.openSignatures.set(key, itemTypeSignature(hit.container));
        } catch (err) {
          console.warn(`[ItemRoute] blockContainerOpened 处理失败: ${err}`);
        }
      });
      containerSignals.blockContainerClosed.subscribe((e) => {
        try {
          if (!isSupportedContainerType(e.block.typeId)) return;
          if (e.closeSource?.entity?.typeId !== "minecraft:player") return;
          const hit = this.locate(e.block);
          if (!hit) return;
          const key = this.signatureKey(hit.warehouse.id, hit.container.id);
          const prev = this.openSignatures.get(key);
          this.openSignatures.delete(key); // 会话结束即清（防 Map 无限累积）
          // 未记录开箱（脚本启动前已开/漏配）→ 保守视为变化；记录且类型集合没变 → 跳过重建
          if (prev !== undefined && prev === itemTypeSignature(hit.container)) return;
          this.deps.resolveIndex(hit.warehouse.id)?.reconcile(hit.container); // 类型变化 → 收敛索引脏化
          stats.invalidate(hit.container.id);
        } catch (err) {
          console.warn(`[ItemRoute] blockContainerClosed 处理失败: ${err}`);
        }
      });
    }

    // 放置容器方块 → 注册（默认按仓库角色，漏斗强制 input 由工厂处理）
    // 若新块与已注册容器合并成双箱 → 合并进已有容器（扩展 occupied + 重定主 id），
    // 避免已注册单箱与新合并双箱共存/撞 id。
    world.afterEvents.playerPlaceBlock.subscribe((e) => {
      try {
        // ⚠️ 提前窄化：只关心放置**受支持容器**——非容器方块（绝大多数放置）不进 findWarehouseAt
        if (!isSupportedContainerType(e.block.typeId)) return;
        const dim = e.block.dimension.id;
        const loc = e.block.location;
        const warehouse = findWarehouseAt(this.deps.warehouses(), dim, { x: loc.x, y: loc.y, z: loc.z });
        if (warehouse === undefined) return;
        // 新放置容器按仓库默认角色/启用注册（漏斗仍强制 input，见工厂）
        const container = factory.create(e.block, warehouse.settings.defaultContainerRole);
        if (container === undefined) return;
        container.enabled = warehouse.settings.defaultContainerEnabled;

        if (container.occupiedLocations.length > 1) {
          // 双箱：找伙伴块是否已是注册容器
          const partnerLoc = container.occupiedLocations.find((l) => locationKey(l) !== locationKey(loc))!;
          const hit = findContainerAt(this.deps.warehouses(), dim, partnerLoc);
          // ⚠️ 不要求 id 不同：新块若为主坐标（更低坐标），其 id 恰与伙伴旧单箱相同——
          //    此时也应**合并**（扩展 occupiedLocations），而非当作新容器注册（item 3.1 修复）。
          if (hit !== undefined) {
            const existing = hit.container;
            const index = this.deps.resolveIndex(warehouse.id);
            // 拆旧 id 索引条目 → 并入新格并重定主 id → 迁移两 map 键 → 重建索引
            index?.onContainerRemoved(existing);
            const oldId = existing.id;
            stats.discard(oldId); // 合并后容器重定 id → 旧 id 统计键失效
            existing.occupiedLocations.push({ x: loc.x, y: loc.y, z: loc.z });
            // 重绑定到合并后共享库存句柄（工厂新建 adapter 持有最新 mc，覆盖 existing 旧单箱引用）
            (existing as McContainerAdapter).rebindMc((container as McContainerAdapter).getMc());
            (existing as McContainerAdapter).rebaseId(
              containerIdOf(primaryLocationOf(existing.occupiedLocations)!, warehouse.area.dimension)
            );
            rebaseContainer(warehouse, oldId, existing);
            index?.onContainerAdded(existing);
            stats.invalidate(existing.id);
            // 持久化（注册表/索引/统计清旧键）由中央订阅订阅 containerRegistryChanged 负责
            bus.containerRegistryChanged.trigger({
              type: "container-registry-changed",
              warehouseId: warehouse.id,
              containerId: existing.id,
              oldId,
              reason: "merge",
            });
            return;
          }
        }
        // 单仓容器数达上限 → 拒绝放置注册（v1 assertContainerCount 的放置侧校验）
        if (warehouse.containers.size >= this.deps.getMaxContainers()) {
          try {
            e.player.sendMessage(`§c仓库容器已达上限（${this.deps.getMaxContainers()} 个），该容器未加入仓库`);
          } catch {
            /* 忽略 */
          }
          return;
        }
        registerContainer(warehouse, container);
        const index = this.deps.resolveIndex(warehouse.id);
        index?.onContainerAdded(container);
        stats.invalidate(container.id);
        bus.containerAdded.trigger({
          type: "container-added",
          warehouseId: warehouse.id,
          containerId: container.id,
          role: container.role,
        });
      } catch (err) {
        console.warn(`[ItemRoute] place 事件处理失败: ${err}`);
      }
    });

    // 破坏/爆炸移除容器方块 → 注销（双箱半拆：occupiedLocations 过滤 + 主坐标重定）
    // ⚠️ typeId 单独传入：break/explode afterEvent 触发时方块**已被破坏**，`block.typeId`
    //    读的是该位置的现况（已变 air）——提前窄化必须用事件携带的
    //    brokenBlockPermutation/explodedBlockPermutation 的 type.id，而不是 e.block.typeId，
    //    否则所有拆箱都因"air 非容器"被跳过、容器滞留清不掉（stale handle 令菜单/扫描读容量抛错）。
    const unregister = (block: Block, blockTypeId: string): void => {
      try {
        // ⚠️ 提前窄化：破坏/爆炸对全维度所有方块触发，只关心**受支持容器**——非容器方块不查仓库
        if (!isSupportedContainerType(blockTypeId)) return;
        const hit = this.locate(block);
        if (!hit) return;
        const { warehouse, container } = hit;
        const loc: Location = { x: block.location.x, y: block.location.y, z: block.location.z };
        const idx = container.occupiedLocations.findIndex((l) => locationKey(l) === locationKey(loc));
        if (idx >= 0) container.occupiedLocations.splice(idx, 1);
        const index = this.deps.resolveIndex(warehouse.id);
        if (container.occupiedLocations.length === 0) {
          // 完全拆除
          unregisterContainer(warehouse, container.id);
          index?.onContainerRemoved(container);
          stats.discard(container.id); // 容器已移除 → 清其统计键（每容器一条）
          bus.containerRemoved.trigger({
            type: "container-removed",
            warehouseId: warehouse.id,
            containerId: container.id,
          });
        } else if (containerIdPointsTo(container.id, loc, warehouse.area.dimension)) {
          // 半拆且拆的是主坐标（id 承载位）：重定 id 到幸存主坐标，
          // 否则 ID 悬空 + 后续在原主坐标新放容器会撞 ID
          const newId = containerIdOf(primaryLocationOf(container.occupiedLocations)!, warehouse.area.dimension);
          if (newId !== container.id) {
            index?.onContainerRemoved(container);
            const oldId = container.id;
            stats.discard(oldId); // 旧 id 统计键失效（容器已重定 id）
            (container as McContainerAdapter).rebaseId(newId);
            rebaseContainer(warehouse, oldId, container);
            index?.onContainerAdded(container);
            stats.invalidate(container.id);
            bus.containerRegistryChanged.trigger({
              type: "container-registry-changed",
              warehouseId: warehouse.id,
              containerId: container.id,
              oldId,
              reason: "split",
            });
          } else {
            // 主半拆但重定后 id 未变（罕见）：仍按真实内容重建索引 + 失效统计
            index?.reconcile(container);
            stats.invalidate(container.id);
            bus.containerRegistryChanged.trigger({
              type: "container-registry-changed",
              warehouseId: warehouse.id,
              containerId: container.id,
              reason: "split",
            });
          }
        } else {
          // 副半拆：几何变化但 ID 不变 → 持久化注册表（否则重启按旧 locations 占用已消失坐标）
          // 并**重建索引 / 统计**（item 5：任何拆箱都按真实内容重建，防拆箱改变内容的残留条目）
          bus.containerRegistryChanged.trigger({
            type: "container-registry-changed",
            warehouseId: warehouse.id,
            containerId: container.id,
            reason: "split",
          });
          index?.reconcile(container);
          stats.invalidate(container.id);
        }
        bus.containerChanged.trigger({
          type: "container-changed",
          warehouseId: warehouse.id,
          containerId: container.id,
        });
      } catch (err) {
        console.warn(`[ItemRoute] 移除事件处理失败: ${err}`);
      }
    };
    world.afterEvents.playerBreakBlock.subscribe((e) => unregister(e.block, e.brokenBlockPermutation.type.id));
    world.afterEvents.blockExplode.subscribe((e) => unregister(e.block, e.explodedBlockPermutation.type.id));

    // 主任务：5 tick 调度 + 预警冷却递减（无持久化定时器——持久化全部事件驱动）
    system.runInterval(() => {
      try {
        scheduler.tick();
      } catch (err) {
        console.warn(`[ItemRoute] 主任务异常: ${err}`);
      }
      try {
        stats.tick(); // 预警冷却递减（否则冷却永不失效，预警只触发一次）
      } catch (err) {
        console.warn(`[ItemRoute] 统计冷却异常: ${err}`);
      }
    }, MAIN_TICK_INTERVAL);
  }

  /** 开箱/关箱会话签名键：仓库 ID + 容器 ID 唯一组成 */
  private signatureKey(warehouseId: WarehouseId, containerId: ContainerId): string {
    return `${warehouseId}:${containerId}`;
  }

  private locate(block: Block): { warehouse: Warehouse; container: Container } | undefined {
    const loc: Location = { x: block.location.x, y: block.location.y, z: block.location.z };
    const wh = findWarehouseAt(this.deps.warehouses(), block.dimension.id, loc);
    if (wh !== undefined) this.deps.ensureContainersLoaded(wh); // 命中前按需加载（防激活竞态）
    return findContainerAt(this.deps.warehouses(), block.dimension.id, loc);
  }
}
