// ── 存储服务：区域句柄 + 本地凭据索引 + 存取编排 ─────────────────────
// 封装 @yinxe/nbt-data-storage 的存取能力，供命令与 UI 共用：
// - 持有当前配置下的 StoredRegion 句柄（applyConfig 时经 registerTest 注册/重注册，
//   幂等共享；布局参数不一致 → 返回错误信息提示换锚点）
// - 本地凭据索引（`ndsdemo:refs` DP）：只维护本上下文见过的槽位记录
//   （自己的 put + 跨模组事件同步），**带 regionId 并按当前区域过滤**——
//   切换锚点/布局后旧凭据保留不混取；UI 列表/命令 list 来源于此，不扫描桶阵列
// - 防丢物：take 取出后先 addItem 给玩家，背包放不下则把剩余部分 put 回区域
// - 扩容见证：存入前后对比 stats().barrels，汇报新物化桶数（快速满箱时可亲见扩容过程）
// - 事件订阅：stored/taken 事件驱动同步索引与区域真值一致
import { world } from "@minecraft/server";
import type { ItemStack, Player } from "@minecraft/server";
import { ItemStorage, chunkFromAnchor, regionId, shortDimension, type StoredRegion } from "@yinxe/nbt-data-storage";
import { loadConfig, saveConfig, type DemoConfig } from "./config";

/** 凭据索引记录（可序列化，经 DP 持久化 + 事件同步） */
export interface StoredRefRecord {
  /** 所属区域 ID（旧数据缺字段 → 视为当前区域） */
  regionId?: string;
  /** 格子 ID（O(1) 取物凭据） */
  slotId: number;
  /** 物品类型 ID（minecraft:diamond_sword） */
  typeId: string;
  /** 数量 */
  amount: number;
  /** 存入时间（unix ms） */
  storedAt: number;
}

/** 本地凭据索引 DP 键 */
const REFS_KEY = "ndsdemo:refs";

/** 操作结果（命令/UI 统一消费，替换色格式化） */
export interface OpResult {
  ok: boolean;
  message: string;
}

/** 操作结果着色（成功绿 / 失败红） */
export function colorOf(r: OpResult): string {
  return r.ok ? "§a" : "§c";
}

/** 读取凭据索引（DP，损坏/缺失 → 空） */
function readRefs(): StoredRefRecord[] {
  try {
    const raw = world.getDynamicProperty(REFS_KEY);
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (x): x is StoredRefRecord =>
            typeof x === "object" &&
            x !== null &&
            typeof (x as StoredRefRecord).slotId === "number" &&
            typeof (x as StoredRefRecord).typeId === "string"
        );
      }
    }
  } catch (e) {
    console.warn("[nds-demo] 读取凭据索引失败", e);
  }
  return [];
}

/** 写凭据索引（事件驱动写穿，无定时 flush） */
function writeRefs(refs: StoredRefRecord[]): void {
  try {
    world.setDynamicProperty(REFS_KEY, JSON.stringify(refs));
  } catch (e) {
    console.warn("[nds-demo] 持久化凭据索引失败", e);
  }
}

/** NBT 存储测试的领域服务（单例，main.ts Phase 4 初始化） */
export class StorageService {
  private region: StoredRegion | undefined;
  private refs: StoredRefRecord[] = [];

  /** Phase 4 初始化：按配置注册区域 + 读凭据索引 + 订阅存储事件（只调一次） */
  init(): void {
    this.applyConfig(loadConfig(), false);
    this.refs = readRefs();
    ItemStorage.events.stored.subscribe((e) => {
      if (!e.itemTypeId) return;
      this.upsertRef({
        regionId: e.regionId,
        slotId: e.slotId,
        typeId: e.itemTypeId,
        amount: e.stackSize ?? 1,
        storedAt: Date.now(),
      });
    });
    ItemStorage.events.taken.subscribe((e) => {
      this.removeRef(e.regionId, e.slotId);
    });
    // 巡检确认丢失（桶损坏/外部取走）：槽位已释放回洞池，凭据立即失效——
    // 否则 UI 列表残留"无法取出且已损坏"的物品记录（用户点取出永远报"没有物品"）
    ItemStorage.events.itemLost.subscribe((e) => {
      this.removeRef(e.regionId, e.slotId);
    });
    // 任何渠道移除（remove/transferOut）：索引与区域真值保持一致
    ItemStorage.events.removed.subscribe((e) => {
      this.removeRef(e.regionId, e.slotId);
    });
    console.warn(
      `[nds-demo] 初始化完成：${this.region ? `区域 ${this.region.regionId}（容量 ${this.region.capacity}）` : "存储未启用"}，凭据 ${this.refs.length} 条`
    );
  }

  /**
   * 应用配置（可选持久化）：注册/重注册存储区域。
   * - 目标区块已有记录：
   *   - 参数完全一致 → 直接共享（不调整）；
   *   - **测试区域（test:true）参数不一致** → `resizeLayout` 动态调整层数/每桶槽数
   *     （含 0..27，扩层任意、缩层需高层为空），无需换锚点；
   *   - 正式区域参数不一致 → 走注册 → 布局冲突拒绝 → 提示更换锚点。
   * - 无记录 → 经 registerTest 新建（test:true 测试区域）。
   * **持久化时机**：应用**成功**后才写 DP（persist=true）——失败时 DP 保持上一个
   * 可用配置，重进地图启动仍用旧配置恢复（不会出现"坏配置被保存 → 每次重进被拒"）。
   * @param persist 是否写入 DP（UI 保存传 true；启动加载传 false）
   * @returns null=就绪（含停用）；字符串=注册/调整失败原因（未持久化）
   */
  applyConfig(config: DemoConfig, persist: boolean): string | null {
    if (!config.enabled) {
      if (persist) saveConfig(config); // 显式停用：无论是否成功都保存（停用无失败可能）
      this.region = undefined; // 只有显式停用才清空句柄
      return null;
    }
    try {
      // 目标区块已有记录且每桶槽数一致 → 动态调整层数（不触发布局冲突）
      const { cx, cz } = chunkFromAnchor(config.anchorX, config.anchorZ);
      const targetId = regionId(shortDimension(config.dimension), cx, cz);
      const target = ItemStorage.getRegion(targetId);
      if (target) {
        const curSlots = target.layout.slotPerBarrel ?? 27;
        const same = config.slotPerBarrel === curSlots && config.maxLevels === target.layout.maxLevels;
        if (same) {
          this.region = target; // 参数一致 → 直接共享
          if (persist) saveConfig(config);
          return null;
        }
        if (target.layout.test === true) {
          // 测试区域：动态调整布局参数（层/槽，无需换锚点）
          const err = target.resizeLayout({
            maxLevels: config.maxLevels,
            slotPerBarrel: config.slotPerBarrel,
          });
          if (err) return err;
          this.region = target;
          if (persist) saveConfig(config);
          return null;
        }
        // 正式区域参数不一致 → 落到下方注册，布局冲突抛错提示换锚点
      }
      this.region = ItemStorage.registerTest({
        dimension: config.dimension,
        anchor: { x: config.anchorX, y: config.baseY, z: config.anchorZ },
        baseY: config.baseY,
        slotPerBarrel: config.slotPerBarrel,
        maxLevels: config.maxLevels,
      });
      if (persist) saveConfig(config);
      return null;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.warn("[nds-demo] 注册存储区域失败", e);
      // 失败时**不写 DP**（保持上一个成功配置，重进地图可恢复）；
      // 保留上一个可用区域句柄（不置空），存取仍可用原区域
      return reason;
    }
  }

  /** 当前配置（读 DP，实时） */
  get config(): DemoConfig {
    return loadConfig();
  }

  /** 是否可用（启用且区域句柄就绪） */
  get ready(): boolean {
    return this.region !== undefined;
  }

  /** 当前区域 ID（未启用/未就绪 → undefined） */
  get regionId(): string | undefined {
    return this.region?.regionId;
  }

  /** 凭据索引快照（仅当前区域；旧数据无 regionId 视为当前区域；升序按 slotId） */
  list(): StoredRefRecord[] {
    const rid = this.regionId;
    return this.refs.filter((r) => r.regionId === undefined || r.regionId === rid).sort((a, b) => a.slotId - b.slotId);
  }

  /** 区域统计（未就绪 → undefined） */
  stats() {
    return this.region?.stats();
  }

  // ─── 存取编排 ─────────────────────────────────────────────────────

  /** 存入手持物品 → 区域（成功后清空手持槽，防止复制）；带扩容见证 */
  storeHeldItem(player: Player): OpResult {
    const notReady = this.notReadyResult();
    if (notReady) return notReady;
    const container = player.getComponent("minecraft:inventory")?.container;
    if (!container) return { ok: false, message: "无法读取背包容器" };
    const item = container.getItem(player.selectedSlotIndex);
    if (!item) return { ok: false, message: "手中没有可存入的物品" };

    const growth = this.measureGrowth(() => {
      const ref = this.region!.put(item);
      if (!ref) return null;
      container.setItem(player.selectedSlotIndex, undefined);
      this.upsertRef({
        regionId: ref.regionId,
        slotId: ref.slotId,
        typeId: item.typeId,
        amount: item.amount,
        storedAt: Date.now(),
      });
      return ref;
    });
    if (!growth.ref) return { ok: false, message: "存储区域已满，存入失败" };
    return {
      ok: true,
      message: `已存入 #${growth.ref.slotId}：${item.typeId} ×${item.amount}（区域 ${growth.ref.regionId}）${growth.text}`,
    };
  }

  /**
   * 批量存入：读取玩家背包指定槽位（UI 勾选），逐件 put 进区域。
   * 成功清空源槽；区域满则中断并汇报。带扩容见证（新物化桶数）。
   */
  storeItems(player: Player, slots: number[]): OpResult {
    const notReady = this.notReadyResult();
    if (notReady) return notReady;
    const container = player.getComponent("minecraft:inventory")?.container;
    if (!container) return { ok: false, message: "无法读取背包容器" };

    const chosen = slots.filter((s) => container.getItem(s) !== undefined);
    if (chosen.length === 0) return { ok: false, message: "所选槽位没有物品" };

    let stored = 0;
    let full = false;
    let growth = 0;
    const before = this.stats()?.barrels ?? 0;
    for (const slot of chosen) {
      const item = container.getItem(slot);
      if (!item) continue;
      const ref = this.region!.put(item);
      if (!ref) {
        full = true;
        break;
      }
      container.setItem(slot, undefined);
      this.upsertRef({
        regionId: ref.regionId,
        slotId: ref.slotId,
        typeId: item.typeId,
        amount: item.amount,
        storedAt: Date.now(),
      });
      stored += 1;
    }
    const after = this.stats()?.barrels ?? 0;
    growth = after - before;
    return {
      ok: stored > 0,
      message:
        `已存入 §e${stored}§r 件` +
        (full ? `，区域已满/写入失败，剩余 ${chosen.length - stored} 件未存入（请先取出、巡检或换区域）` : "") +
        (growth > 0 ? `；扩容见证：新物化木桶 §e+${growth}§r（${before}→${after}）` : ""),
    };
  }

  /**
   * 按格子 ID 取出 → 放进玩家背包；背包放不下的部分自动放回区域（不丢不重复）。
   * 放回也失败 → **掉落地面**（spawnItem），物品绝不静默消失。
   */
  takeToPlayer(player: Player, slotId: number): OpResult {
    const notReady = this.notReadyResult();
    if (notReady) return notReady;
    const took = this.region!.take(slotId);
    if (!took) {
      // 槽空（已丢失/外部取走）：take 不触发 taken 事件，主动清凭据，
      // 防止 UI 列表残留"取不出"的损坏记录
      this.removeRef(this.region!.regionId, slotId);
      return { ok: false, message: `格子 #${slotId} 没有物品` };
    }

    const container = player.getComponent("minecraft:inventory")?.container;
    const leftover = container ? container.addItem(took) : took;
    if (!leftover) {
      return { ok: true, message: `已取出 #${slotId}：${took.typeId} ×${took.amount} 已放入背包` };
    }
    const back = this.region!.put(leftover);
    if (back) {
      return {
        ok: true,
        message: `#${slotId} 已取出但背包空间不足：${leftover.typeId} ×${leftover.amount} 放回存储（新槽位 #${back.slotId}）`,
      };
    }
    // 放回也失败：掉落地面兜底（物品不消失）
    try {
      player.dimension.spawnItem(leftover, player.location);
      return {
        ok: true,
        message: `#${slotId} 已取出：${leftover.typeId} ×${leftover.amount} 背包空间不足且放回失败，物品已掉落在地面，请捡起`,
      };
    } catch {
      return { ok: false, message: `#${slotId} 已取出但既放不进背包也放不回存储，物品可能丢失，请尽快处理！` };
    }
  }

  /**
   * 原位覆写：手持物品覆写（ItemStack → 指定格子，slotId 不变；空槽也允许——实时数据保存用）。
   * 成功后清空手持槽（防复制）、同步凭据索引；旧物品进背包（放不下 → 存回存储/掉落地面）。
   * 护栏：位置异常（非木桶/未加载）→ 拒绝（请先 /nds-demo:check）。
   */
  overwriteToSlot(player: Player, slotId: number): OpResult {
    const notReady = this.notReadyResult();
    if (notReady) return notReady;
    const container = player.getComponent("minecraft:inventory")?.container;
    if (!container) return { ok: false, message: "无法读取背包容器" };
    const item = container.getItem(player.selectedSlotIndex);
    if (!item) return { ok: false, message: "手中没有可覆写的物品" };

    const r = this.region!.overwrite(slotId, item);
    if (!r.ok) return { ok: false, message: `覆写失败：${r.error ?? "未知原因"}` };
    // 成功后清空手持槽（防复制），并同步凭据索引（overwritten 不触发 stored/taken）
    container.setItem(player.selectedSlotIndex, undefined);
    this.upsertRef({
      regionId: this.region!.regionId,
      slotId,
      typeId: item.typeId,
      amount: item.amount,
      storedAt: Date.now(),
    });
    // 旧物品处置：先放背包，放不下 → 存回存储（新槽）/掉落地面，不丢
    const old = r.old as ItemStack | undefined;
    if (!old)
      return { ok: true, message: `已覆写 #${slotId}：${item.typeId} ×${item.amount}（原位置为空/洞，已写入）` };
    const leftover = container.addItem(old);
    if (!leftover) {
      return {
        ok: true,
        message: `已覆写 #${slotId}：${item.typeId} 替换 ${old.typeId} ×${old.amount}（旧物已放入背包）`,
      };
    }
    const back = this.region!.put(leftover);
    if (back) {
      return {
        ok: true,
        message: `已覆写 #${slotId}：${item.typeId} 替换 ${old.typeId}；背包空间不足，旧物品已存回存储（新槽位 #${back.slotId}）`,
      };
    }
    try {
      player.dimension.spawnItem(leftover, player.location);
      return {
        ok: true,
        message: `已覆写 #${slotId}：${item.typeId} 替换 ${old.typeId}；背包/存储均放不下，旧物品已掉落在地面，请捡起`,
      };
    } catch {
      return { ok: true, message: `已覆写 #${slotId}：${item.typeId}；旧物品 ${old.typeId} 处置失败，请尽快处理！` };
    }
  }

  /** 批量取出：按格子 ID 列表逐件取出（UI 勾选），汇总成功/失败 */
  takeItems(player: Player, slotIds: number[]): OpResult {
    const notReady = this.notReadyResult();
    if (notReady) return notReady;
    let took = 0;
    let empty = 0;
    for (const slotId of slotIds) {
      const r = this.takeToPlayer(player, slotId);
      if (r.ok) took += 1;
      else if (r.message.includes("没有物品")) empty += 1;
    }
    return {
      ok: took > 0,
      message: `已取出 §e${took}§r 件` + (empty > 0 ? `；${empty} 件槽位为空（可能已被取走）` : ""),
    };
  }

  /** 汇总显示：本区域统计 + 世界全库（命令与 UI 菜单共用） */
  showStats(player: Player): void {
    this.ensureRegion();
    const s = this.stats();
    const total = ItemStorage.totalStats();
    const lines = [
      "§l== NBT 存储测试 · 统计 ==§r",
      s
        ? `区域 §e${s.key}§r｜维度 ${s.dimensionId}｜区块 ${s.chunkX},${s.chunkZ}｜底层 Y=${s.baseY}`
        : "§7（存储未初始化）§r",
      s
        ? `层数 ${s.maxLevels}｜每桶 ${s.slotPerBarrel} 槽｜容量 §e${s.capacity}§r｜已用 §e${s.used}§r｜空洞 ${s.freePoolSize}`
        : "",
      s
        ? `桶 §e${s.barrels}§r/${s.totalBarrels}（扩容进度：已物化 ${Math.round((s.barrels / Math.max(s.totalBarrels, 1)) * 100)}%）`
        : "",
      `凭据索引 §e${this.list().length}§r 条（当前区域）`,
      `§7世界全库：${total.regionCount} 区域，容量 ${total.totalCapacity}，已用 ${total.totalUsed}§r`,
    ];
    player.sendMessage(lines.filter((l) => l !== "").join("\n"));
  }

  /** 凭据列表文本（/nds-demo:list 用；空 → 提示文案） */
  formatList(): string {
    const refs = this.list();
    if (refs.length === 0) return "§7（当前区域尚无凭据记录：先 /nds-demo:store 存入手持物品）§r";
    return [
      "§l== 已存物品凭据 ==§r",
      ...refs.map(
        (r) => `§e#${r.slotId}§r §f${r.typeId}§r ×${r.amount} §7（${new Date(r.storedAt).toLocaleTimeString("zh-CN")}）`
      ),
      `§7共 ${refs.length} 条；用 /nds-demo:take <格子号> 或 UI 取出§r`,
    ].join("\n");
  }

  // ─── 私有工具 ─────────────────────────────────────────────────────

  /**
   * 惰性确保区域就绪：句柄为空且配置启用时，用当前配置重新应用一次（不改 DP）。
   * 解决"进世界过早操作 / 上次配置应用失败"导致的"存储未初始化"。
   */
  private ensureRegion(): void {
    if (!this.region && loadConfig().enabled) {
      this.applyConfig(loadConfig(), false);
    }
  }

  /** 未就绪时的统一错误结果（先尝试惰性恢复） */
  private notReadyResult(): OpResult | null {
    this.ensureRegion();
    if (!this.region) {
      return { ok: false, message: "存储未初始化：请用 /nds-demo:config 打开配置 UI 保存启用（或稍候重试）" };
    }
    return null;
  }

  /**
   * 阵列巡检 + 修复（自检维护）：损坏桶重建、丢失槽回收、洞池对齐。
   * 发送面向玩家的格式化报告。
   */
  checkAndRepair(player: Player): void {
    this.ensureRegion();
    if (!this.region) {
      player.sendMessage("§c存储未初始化：请用 /nds-demo:config 打开配置 UI 保存启用");
      return;
    }
    const report = this.region.checkAndRepair();
    const kindLabel = (k: "barrel-destroyed" | "taken-externally") =>
      k === "barrel-destroyed" ? "桶损坏" : "外部取走";
    const lines = [
      "§l== 阵列自检（巡检 + 修复）==§r",
      `区域 §e${this.region.regionId}§r｜扫描 §e${report.scanned}§r 槽`,
      report.fixedBarrels > 0
        ? `§e修复损坏木桶 ${report.fixedBarrels} 个§r（已重建；桶内物品随方块损坏无法找回）`
        : "§7木桶方块完好§r",
      report.lostSlots.length > 0
        ? `§c确认丢失 ${report.lostSlots.length} 件物品§r（${report.lostDetails
            .map((d) => `#${d.slotId}${kindLabel(d.kind)}`)
            .join("、")}），槽位已释放可重新存入`
        : "§7无丢失槽位§r",
      report.unknownSlots > 0 ? `§7跳过 ${report.unknownSlots} 槽（区块未加载，下次巡检再试）§r` : "",
      "§7空洞池已重建，容量与真值对齐§r",
    ];
    player.sendMessage(lines.filter((l) => l !== "").join("\n"));
  }

  /**
   * 扩容见证：执行 fn（内部含 put），返回其结果 + 本次新物化木桶数文本。
   * 物化桶数变化来自 meta.barrelCount（真正 setBlockType 建桶才 +1）。
   */
  private measureGrowth<T>(fn: () => T): { ref: T; text: string } {
    const before = this.stats()?.barrels ?? 0;
    const ref = fn();
    const after = this.stats()?.barrels ?? 0;
    const growth = after - before;
    return {
      ref,
      text: growth > 0 ? `；扩容见证：新物化木桶 §e+${growth}§r（${before}→${after}）` : "",
    };
  }

  // ─── 凭据索引维护（regionId+slotId 幂等 upsert） ───────────────────

  private upsertRef(rec: StoredRefRecord): void {
    const i = this.refs.findIndex((r) => r.regionId === rec.regionId && r.slotId === rec.slotId);
    if (i >= 0) this.refs[i] = rec;
    else this.refs.push(rec);
    writeRefs(this.refs);
  }

  private removeRef(regionId: string | undefined, slotId: number): void {
    const i = this.refs.findIndex((r) => r.regionId === regionId && r.slotId === slotId);
    if (i < 0) return;
    this.refs.splice(i, 1);
    writeRefs(this.refs);
  }
}

/** 全局单例（main.ts Phase 4 init；命令/UI 直接引用） */
export const storage = new StorageService();
