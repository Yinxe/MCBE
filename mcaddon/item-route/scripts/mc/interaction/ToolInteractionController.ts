// ─── 信物交互总控：右键容器/空地 → 角色菜单/主菜单/选区 ──
import { world, type Player } from "@minecraft/server";
import type { CommandDeps } from "../commands/deps";
import { findContainerAt } from "../../core/model/Area";
import type { Location } from "../../core/model/types";
import { handleCornerClick } from "./interactionLogic";
import { showContainerRoleMenu } from "../ui/ContainerRoleMenu";
import { showMainMenu } from "../ui/MainMenu";
import { MoveJournal } from "../../core/routing/Move";

/** 防抖：同 tick 双击只处理一次 */
const DEBOUNCE_MS = 250;

export function registerToolInteraction(deps: CommandDeps): void {
  const debounces = new Map<string, number>();
  const debounce = (playerId: string): boolean => {
    const now = Date.now();
    const prev = debounces.get(playerId) ?? 0;
    if (now - prev < DEBOUNCE_MS) return true;
    debounces.set(playerId, now);
    return false;
  };
  const cornerCtx = {
    session: deps.session,
    warehouses: deps.warehouses,
    resolveWarehouse: (id: string) => deps.loadedWarehouses().find((w) => w.id === id),
  };

  // 右键方块：持信物 → 潜行整理 / 选区角点 / 容器角色菜单
  world.afterEvents.playerInteractWithBlock.subscribe((e) => {
    try {
      if (!e.isFirstEvent) return;
      const player = e.player;
      if (player === undefined || debounce(player.id)) return;
      if (!isHoldingToken(player, deps.config)) return;
      const loc: Location = { x: e.block.location.x, y: e.block.location.y, z: e.block.location.z };
      const session = deps.session.get(player.id);

      if (player.isSneaking) {
        // 潜行右键：快速整理所在仓库
        const hit = findContainerAt(deps.loadedWarehouses(), e.block.dimension.id, loc);
        if (hit) {
          const ok = deps.organize.organize(hit.warehouse, new MoveJournal());
          player.sendMessage(ok ? "§a整理完成" : "§c整理失败");
        }
        return;
      }
      if (session !== undefined) {
        const msg = handleCornerClick(cornerCtx, player.id, loc, e.block.dimension.id);
        if (msg) player.sendMessage(msg);
        return;
      }
      const hit = findContainerAt(deps.loadedWarehouses(), e.block.dimension.id, loc);
      if (hit) {
        void showContainerRoleMenu(player, deps, hit.warehouse);
      }
    } catch (err) {
      console.warn(`[item-route] 交互处理失败: ${err}`);
    }
  });

  // 对空右键：持信物 → 主菜单；选区完成建仓/调整（对角第二个点）
  world.afterEvents.itemUse.subscribe((e) => {
    try {
      const player = e.source;
      if (player === undefined || debounce(player.id)) return;
      if (!isHoldingToken(player, deps.config)) return;
      const session = deps.session.get(player.id);
      if (session !== undefined && session.corner1 !== undefined) {
        const loc: Location = { x: Math.floor(player.location.x), y: Math.floor(player.location.y), z: Math.floor(player.location.z) };
        const msg = handleCornerClick(cornerCtx, player.id, loc, player.dimension.id);
        if (msg) player.sendMessage(msg);
        return;
      }
      void showMainMenu(player, deps);
    } catch (err) {
      console.warn(`[item-route] itemUse 处理失败: ${err}`);
    }
  });
}

function isHoldingToken(player: Player, deps: { tokenItemId: string }): boolean {
  const main = player.getComponent("minecraft:inventory")?.container?.getSlot(player.selectedSlotIndex).getItem();
  return main !== undefined && main.typeId === deps.tokenItemId;
}