// ─── 仓库/会话状态 HUD：玩家物品栏上方（actionbar）显示 ──
// 优先级：**选区会话 > 仓库状态**。每 0.5 秒为每个玩家刷新一次：
//   · 选区会话（建仓/调整区域进行中）→ 显示会话流程/状态/选点情况（item 2.4）
//   · 仓库状态（成员 + 附近）→ 仓库名 + 路由状态 + 工作状态（待分拣**物品总数** + 堵塞数）
// 路由状态取调度器实时生命周期 + 全局/每仓开关；工作状态用容器 O(1) 属性（usedSlots）
// 快速累加启用输入容器的待分拣物品数（item 13.1），并显示调度器的阻塞输入数（item 4）。
import { world, system } from "@minecraft/server";
import type { Scheduler } from "../../core/scheduling/Scheduler";
import type { Warehouse } from "../../core/model/Warehouse";
import type { MemberService } from "../../core/services/MemberService";
import type { SelectionSessionStore, SelectionSession } from "../interaction/SelectionSessionStore";
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

/** 选区会话 HUD 文案（建仓/调整区域流程状态） */
function sessionLine(session: SelectionSession): string {
  const corner = session.corner1;
  const pos = corner === undefined ? "" : ` (${corner.x},${corner.y},${corner.z})`;
  if (session.kind === "createWarehouse") {
    const picked = corner === undefined ? `${color.warn}未选点` : `${color.success}已选 1 角${pos}`;
    return `${color.gold}建仓「${session.name}」${picked} ${color.muted}· 请选对角方块完成`;
  }
  const picked = corner === undefined ? `${color.warn}未选点` : `${color.success}已选 1 角${pos}`;
  return `${color.gold}调整区域 ${picked} ${color.muted}· 请选对角方块完成`;
}

/** 组装一行仓库状态 HUD 文案：`[仓库名] 路由中 · 待分拣 3 格` */
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
  // 工作状态：待分拣**物品总数**（启用输入容器 usedSlots 累加，O(1) 属性，item 13.1）
  let pending = 0;
  for (const input of w.inputs.values()) {
    if (input.enabled) pending += input.usedSlots;
  }
  const blocked = scheduler.blockedInputCount(w.id);
  let work: string;
  if (blocked > 0) work = `${color.error}堵塞 ${blocked} 格`;
  else if (pending > 0) work = `${color.info}待分拣 ${pending} 格`;
  else work = `${color.muted}空闲`;
  return `${color.gold}[${w.displayName}] ${routeState}${color.muted} · ${work}`;
}

/**
 * 注册 HUD：主循环 interval 定期刷新。
 * - 有选区会话（建仓/调整区域）→ 优先显示会话状态（选点进度）
 * - 否则显示"成员 + 附近"的最近仓库状态；都不满足则清空 actionbar。
 *
 * @param scheduler - 调度器（读生命周期/全局开关/阻塞态）
 * @param loaded    - 运行时仓库表
 * @param members   - 成员权限（过滤非成员仓库）
 * @param sessions  - 选区会话存储（建仓/调整区域流程 HUD）
 */
export function registerWarehouseHUD(
  scheduler: Scheduler,
  loaded: Warehouse[],
  members: MemberService,
  sessions: SelectionSessionStore
): void {
  system.runInterval(() => {
    try {
      for (const p of world.getAllPlayers()) {
        let text = "";
        // 1) 选区会话优先（建仓/调整区域进行中，显示流程/选点/异常提示）
        const session = sessions.get(p.name);
        if (session !== undefined) {
          text = sessionLine(session);
        } else {
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
          if (best !== undefined) text = hudLine(scheduler, best);
        }
        try {
          p.onScreenDisplay.setActionBar(text);
        } catch {
          /* 玩家离线/维度切换：忽略 */
        }
      }
    } catch {
      /* 主循环单帧失败不崩溃 */
    }
  }, HUD_INTERVAL);
}
