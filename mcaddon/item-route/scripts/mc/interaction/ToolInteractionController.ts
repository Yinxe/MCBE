// ─── 信物交互总控：右键容器/空地 → 角色菜单/主菜单/选区 ──
// 事件分层对齐 v1 已验证的交互模型（核心：方块交互用 beforeEvents）：
//   · beforeEvents.playerInteractWithBlock —— 方块右键（持信物）：先于 afterEvents
//     触发、可 event.cancel 取消默认行为（不打开箱子界面/不锄地等）；处理前先写
//     防抖时间戳；分支：潜行→快速整理；容器方块→角色菜单/不属于仓库；非容器
//     方块→选区角点（无会话则提示先对空右键开菜单创建仓库）
//   · afterEvents.itemUse —— 对空右键兜底：先读方块交互刚写的时间戳，DEBOUNCE_MS 内
//     忽略（方块点击后紧跟的 itemUse 不再误弹主菜单）；视线指向容器（如潜影盒等
//     可能不触发方块交互）→ 容器角色菜单；否则主菜单
// 防抖是**单向依赖**：方块事件写时间戳、itemUse 只读——无"谁先耗防抖"的竞态，
// 方块点击永远生效、主菜单永不抢走选点（修复"建仓后无法进入选区模式"）。
// 选区角点只在**非容器方块**上标记（v1 语义）：区域用两个普通方块对角，
// 容器由创建后的扫描自动纳入。
// ⚠️ beforeEvents 回调在**受限执行上下文**：直触世界/容器/UI 的操作（整理、开菜单、
// 角点建仓）必须用 system.run 延迟到正常上下文再执行；仅分支判断/读状态留在回调内。
// 一切回调整体 try-catch（单事件崩溃不影响其他事件），日志 `[item-route]` 前缀。
import { world, system } from "@minecraft/server";
import type { CommandDeps } from "../commands/deps";
import { findContainerAt, findWarehouseAt } from "../../core/model/Area";
import { isSupportedContainerType } from "../../core/model/ContainerTypes";
import type { Location } from "../../core/model/types";
import { handleCornerClick } from "./interactionLogic";
import { showContainerRoleMenu } from "../ui/ContainerRoleMenu";
import { showMainMenu } from "../ui/MainMenu";
import { MoveJournal } from "../../core/routing/Move";
import { chat } from "../ui/uiColor";

/** 防抖窗口：方块点击后短时间内忽略 itemUse（v1 同款 250ms） */
const DEBOUNCE_MS = 250;

export function registerToolInteraction(deps: CommandDeps): void {
  /** 玩家最近一次方块交互的时间戳（只由方块事件写、itemUse 只读） */
  const recentBlockUse = new Map<string, number>();
  const cornerCtx = {
    session: deps.session,
    warehouses: deps.warehouses,
    bus: deps.bus,
    resolveWarehouse: (id: string) => deps.loadedWarehouses().find((w) => w.id === id),
  };
  // 命中容器前按需加载该仓（防"服务器启动即点/激活竞态"——成员交互通常已激活，这里幂等兜底）
  const hitLoaded = (dimensionId: string, loc: Location): ReturnType<typeof findContainerAt> => {
    const wh = findWarehouseAt(deps.loadedWarehouses(), dimensionId, loc);
    if (wh !== undefined) deps.ensureContainersLoaded(wh);
    return findContainerAt(deps.loadedWarehouses(), dimensionId, loc);
  };

  // 右键方块（beforeEvents）：先触发、可取消默认行为、写防抖时间戳后处理
  world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
    try {
      if (!e.isFirstEvent) return;
      const player = e.player;
      if (player === undefined) return;
      if (e.itemStack === undefined || !deps.config.isToken(e.itemStack.typeId)) return;
      recentBlockUse.set(player.name, Date.now());
      e.cancel = true; // 取消默认行为：不打开箱子界面、不锄地等
      const loc: Location = { x: e.block.location.x, y: e.block.location.y, z: e.block.location.z };
      const dimensionId = e.block.dimension.id;

      if (player.isSneaking) {
        // 潜行右键：快速整理该容器（单容器就地整理，受限上下文 → 延迟到 system.run）
        system.run(() => {
          const hit = hitLoaded(dimensionId, loc);
          if (hit === undefined) return;
          const res = deps.organize.organizeContainer(hit.warehouse, hit.container, new MoveJournal());
          const name = hit.container.id.split("@")[1] ?? hit.container.id;
          player.sendMessage(
            res.ok
              ? `${chat.success}${name} 整理完成${res.moves > 0 ? `（合并 ${res.moves} 组）` : "（已整齐）"}`
              : `${chat.error}${name} 整理失败`
          );
        });
        return;
      }

      // 容器方块 vs 非容器方块分区处理（v1 语义：选区角点只在非容器方块上标记）
      if (isSupportedContainerType(e.block.typeId)) {
        system.run(() => {
          const hit = hitLoaded(dimensionId, loc);
          if (hit) {
            void showContainerRoleMenu(player, deps, hit.warehouse);
          } else {
            player.sendMessage(`${chat.error}该容器不属于任何仓库`);
          }
        });
        return;
      }

      const session = deps.session.get(player.name);
      if (session === undefined) {
        player.sendMessage(`${chat.info}请先对空右键信物打开菜单创建仓库`);
        return;
      }
      // 角点处理（建仓/调整可能触发视觉事件 → 延迟到 system.run）
      system.run(() => {
        const msg = handleCornerClick(cornerCtx, player.name, loc, dimensionId);
        if (msg) player.sendMessage(msg);
      });
    } catch (err) {
      console.warn(`[item-route] 交互处理失败: ${err}`);
    }
  });

  // 对空交互（itemUse）——兜底：仅当没有"刚点过方块"才处理（afterEvents，已正常执行上下文）
  world.afterEvents.itemUse.subscribe((e) => {
    try {
      const player = e.source;
      if (player === undefined) return;
      if (e.itemStack === undefined || !deps.config.isToken(e.itemStack.typeId)) return;
      const lastBlock = recentBlockUse.get(player.name);
      if (lastBlock !== undefined && Date.now() - lastBlock < DEBOUNCE_MS) return;

      // 视线指向容器（如潜影盒等可能不触发方块交互）→ 容器角色菜单
      const block = player.getBlockFromViewDirection({ maxDistance: 6 })?.block;
      if (block !== undefined && isSupportedContainerType(block.typeId)) {
        const loc: Location = { x: block.location.x, y: block.location.y, z: block.location.z };
        const hit = hitLoaded(block.dimension.id, loc);
        if (hit) void showContainerRoleMenu(player, deps, hit.warehouse);
        return;
      }
      void showMainMenu(player, deps);
    } catch (err) {
      console.warn(`[item-route] itemUse 处理失败: ${err}`);
    }
  });

  // 玩家离开：清理防抖时间戳（v1 同款，防内存泄漏）
  world.afterEvents.playerLeave.subscribe((e) => {
    recentBlockUse.delete(e.playerName);
  });
}
