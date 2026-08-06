// ─── 信物交互总控（对齐 v1 交互模型：点击/长按 + 潜行 + 分段） ──
// 事件分层（方块交互用 beforeEvents，先于 afterEvents、可 cancel 默认行为）：
//   · beforeEvents.playerInteractWithBlock —— 持信物右键方块：
//       · 点击（isFirstEvent=true）：
//           - 潜行 + 容器 → **单容器整理**（详细分析报告，v1 同款）
//           - 潜行 + 非容器 → 忽略（v1 为背包整理，v2 暂不实现）
//           - 非潜行 + 容器 → 打开该容器的**管理菜单**（ContainerRoleMenu）
//           - 非潜行 + 非容器 → 选区模式（有会话）/ **仓库菜单模式**（按点位找仓 → 打开其设置；
//              无仓则提示"当前位置不是仓库"）
//       · 长按（isFirstEvent=false，按住产生的重复事件）：
//           - 潜行长按 → 仓库菜单模式（取**玩家所在位置**找仓）
//           - 非潜行长按 → 忽略（不打扰）
//   · afterEvents.itemUse —— 对空右键兜底：读方块交互防抖时间戳（250ms 内忽略），
//     视线指向容器（潜影盒等不触发方块交互）→ 容器菜单；否则主菜单
// 防抖为**单向依赖**：方块事件写时间戳、itemUse 只读——无"谁先耗防抖"的竞态。
// ⚠️ beforeEvents 回调在**受限执行上下文**：触世界/容器/UI 的操作（整理/开菜单/角点建仓）
//    用 system.run 延迟到正常上下文；仅分支判断/读状态留在回调内。
import { world, system } from "@minecraft/server";
import type { CommandDeps } from "../commands/deps";
import { findContainerAt, findWarehouseAt } from "../../core/model/Area";
import { isSupportedContainerType } from "../../core/model/ContainerTypes";
import type { Location } from "../../core/model/types";
import { handleCornerClick } from "./interactionLogic";
import { showContainerRoleMenu } from "../ui/ContainerRoleMenu";
import { showWarehouseSettingsMenu } from "../ui/WarehouseSettingsMenu";
import { showMainMenu } from "../ui/MainMenu";
import { MoveJournal } from "../../core/routing/Move";
import { formatOrganizeResult } from "../ui/OrganizeFormatter";
import { chat } from "../ui/uiColor";

/** 防抖窗口：方块点击后短时间内忽略 itemUse（v1 同款 250ms） */
const DEBOUNCE_MS = 250;
/** 长按判定：按住超过该时长（ms）且出现重复事件（isFirstEvent=false）视为长按 */
const LONG_PRESS_MS = 400;

export function registerToolInteraction(deps: CommandDeps): void {
  /** 玩家最近一次方块交互的时间戳（只由方块事件写、itemUse 只读） */
  const recentBlockUse = new Map<string, number>();
  /** 长按状态：pressStart 时间戳 + 是否已处理过本次长按（防重复事件刷屏） */
  const pressState = new Map<string, { start: number; handled: boolean }>();
  const cornerCtx = {
    session: deps.session,
    warehouses: deps.warehouses,
    bus: deps.bus,
    resolveWarehouse: (id: string) => deps.loadedWarehouses().find((w) => w.id === id),
  };
  // 命中容器前按需加载该仓（防"服务器启动即点/激活竞态"）
  const hitLoaded = (dimensionId: string, loc: Location): ReturnType<typeof findContainerAt> => {
    const wh = findWarehouseAt(deps.loadedWarehouses(), dimensionId, loc);
    if (wh !== undefined) deps.ensureContainersLoaded(wh);
    return findContainerAt(deps.loadedWarehouses(), dimensionId, loc);
  };
  // 仓库菜单模式：按点位找仓 → 打开其设置；无仓则提示
  const warehouseMenuAt = (player: import("@minecraft/server").Player, loc: Location, dimensionId: string): void => {
    system.run(() => {
      const wh = findWarehouseAt(deps.loadedWarehouses(), dimensionId, loc);
      if (wh === undefined) {
        player.sendMessage(`${chat.error}当前位置不是仓库`);
        return;
      }
      deps.ensureContainersLoaded(wh);
      void showWarehouseSettingsMenu(player, deps, wh);
    });
  };
  // 潜行点击容器 → 单容器整理 + 详细分析报告
  const quickOrganizeContainer = (player: import("@minecraft/server").Player, dimensionId: string, loc: Location): void => {
    system.run(() => {
      const hit = hitLoaded(dimensionId, loc);
      if (hit === undefined) return;
      const res = deps.organize.organizeContainer(hit.warehouse, hit.container, new MoveJournal());
      const name = hit.container.id.split("@")[1] ?? hit.container.id;
      for (const line of formatOrganizeResult(res, name)) player.sendMessage(line);
    });
  };

  // 右键方块（beforeEvents）：持信物 → 按 点击/长按 + 潜行 + 容器/非容器 分段
  world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
    try {
      const player = e.player;
      if (player === undefined) return;
      if (e.itemStack === undefined || !deps.config.isToken(e.itemStack.typeId)) return; // 信物判定
      const isLongPress = !e.isFirstEvent; // 长按：按住产生的重复事件
      const now = Date.now();
      recentBlockUse.set(player.name, now);
      e.cancel = true; // 取消默认行为：不打开箱子界面、不锄地等
      const loc: Location = { x: e.block.location.x, y: e.block.location.y, z: e.block.location.z };
      const dimensionId = e.block.dimension.id;

      if (isLongPress) {
        // 长按：仅潜行长按生效一次 → 仓库菜单模式（取玩家位置）；其余忽略
        if (!player.isSneaking) return;
        const st = pressState.get(player.name);
        if (st === undefined || st.handled || now - st.start < LONG_PRESS_MS) return;
        st.handled = true;
        const playerLoc: Location = {
          x: Math.floor(player.location.x),
          y: Math.floor(player.location.y),
          z: Math.floor(player.location.z),
        };
        warehouseMenuAt(player, playerLoc, player.dimension.id);
        return;
      }

      // 点击（isFirstEvent=true）——刷新长按状态起始
      pressState.set(player.name, { start: now, handled: false });

      if (player.isSneaking) {
        // 潜行点击：容器 → 单容器整理；非容器 → 忽略
        if (isSupportedContainerType(e.block.typeId)) quickOrganizeContainer(player, dimensionId, loc);
        return;
      }

      // 非潜行点击
      if (isSupportedContainerType(e.block.typeId)) {
        // 点击容器 → 该容器的管理菜单
        system.run(() => {
          const hit = hitLoaded(dimensionId, loc);
          if (hit) void showContainerRoleMenu(player, deps, hit.warehouse);
          else player.sendMessage(`${chat.error}该容器不属于任何仓库`);
        });
        return;
      }

      // 点击非容器：选区模式（有会话） / 仓库菜单模式（无会话按点位找仓）
      const session = deps.session.get(player.name);
      if (session !== undefined) {
        system.run(() => {
          const msg = handleCornerClick(cornerCtx, player.name, loc, dimensionId);
          if (msg) player.sendMessage(msg);
        });
        return;
      }
      warehouseMenuAt(player, loc, dimensionId);
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

      // 视线指向容器（如潜影盒等可能不触发方块交互）→ 容器管理菜单
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

  // 玩家离开：清理防抖 + 长按状态（防内存泄漏）
  world.afterEvents.playerLeave.subscribe((e) => {
    recentBlockUse.delete(e.playerName);
    pressState.delete(e.playerName);
  });
}
