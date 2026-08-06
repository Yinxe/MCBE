// ─── 仓库状态 HUD：玩家物品栏上方（actionbar）显示附近仓库状态 ──
// 每 0.5 秒为每个玩家刷新一次 actionbar 一行：仓库名 + 路由状态（生命周期）+ 工作状态（待分拣）。
// 只对"成员 + 在仓库附近（margin）"的玩家显示；不在任何仓库附近则清空 actionbar。
// 路由状态取调度器实时生命周期（路由中/停用中/停用），并反映全局开关与每仓运转开关；
// 工作状态 = 非空启用的输入容器数（待分拣格数）。全内存、无副作用。
import { world, system } from "@minecraft/server";
import type { Scheduler } from "../../core/scheduling/Scheduler";
import type { Warehouse } from "../../core/model/Warehouse";
import type { MemberService } from "../../core/services/MemberService";
import { isPlayerNearby, type PlayerPosition } from "../../core/model/Area";
import { color } from "../ui/uiColor";

/** HUD 刷新间隔（tick；0.5 秒 @20tps） */
const HUD_INTERVAL = 10;
/** 附近判定外扩格数（站仓库外稍远也能看到状态） */
const HUD_MARGIN = 12;

/** 距仓库中心 XZ 直线距离 */
function distTo(w: Warehouse, pos: PlayerPosition): number {
  const a = w.area;
  const cx = (Math.min(a.corner1.x, a.corner2.x) + Math.max(a.corner1.x, a.corner2.x)) / 2;
  const cz = (Math.min(a.corner1.z, a.corner2.z) + Math.max(a.corner1.z, a.corner2.z)) / 2;
  return Math.hypot(pos.x - cx, pos.z - cz);
}

/** 组装一行 HUD 文案：`[仓库名] 路由中 · 待分拣 3 格` */
function hudLine(scheduler: Scheduler, w: Warehouse): string {
  // 路由状态：全局关 > 每仓停运 > 生命周期
  const routeState = !scheduler.isGlobalEnabled
    ? `${color.error}全局暂停`
    : !w.settings.routingEnabled
      ? `${color.error}已停运`
      : scheduler.getLifecycle(w.id) === "active"
        ? `${color.success}路由中`
        : scheduler.getLifecycle(w.id) === "deactivating"
          ? `${color.warn}停用中`
          : `${color.muted}停用`;
  // 工作状态：非空启用输入容器数（待分拣）
  let pending = 0;
  for (const input of w.inputs.values()) {
    if (input.enabled && input.usedSlots > 0) pending++;
  }
  const work = pending > 0 ? `${color.info}待分拣 ${pending} 格` : `${color.muted}空闲`;
  return `${color.gold}[${w.displayName}] ${routeState}${color.muted} · ${work}`;
}

/**
 * 注册仓库状态 HUD：主循环 interval 定期为附近成员刷新 actionbar。
 * 只显示玩家有成员身份（member+）且在附近（margin）的最近仓库。
 *
 * @param scheduler - 调度器（读生命周期/全局开关）
 * @param loaded    - 运行时仓库表
 * @param members   - 成员权限（过滤非成员仓库）
 */
export function registerWarehouseHUD(scheduler: Scheduler, loaded: Warehouse[], members: MemberService): void {
  system.runInterval(() => {
    try {
      for (const p of world.getAllPlayers()) {
        const pos: PlayerPosition = { dimension: p.dimension.id, x: p.location.x, z: p.location.z };
        // 就近取"成员身份 + 在附近"的仓库（同一玩家多仓时只显示最近一仓，避免刷屏）
        let best: Warehouse | undefined;
        let bestDist = Infinity;
        for (const w of loaded) {
          if (!members.can(w, p.name, "member")) continue; // HUD 只给拥有/管理成员看
          if (!isPlayerNearby(w.area, [pos], HUD_MARGIN)) continue;
          const d = distTo(w, pos);
          if (d < bestDist) {
            bestDist = d;
            best = w;
          }
        }
        try {
          p.onScreenDisplay.setActionBar(best === undefined ? "" : hudLine(scheduler, best));
        } catch {
          /* 玩家离线/维度切换：忽略 */
        }
      }
    } catch {
      /* 主循环单帧失败不崩溃 */
    }
  }, HUD_INTERVAL);
}
