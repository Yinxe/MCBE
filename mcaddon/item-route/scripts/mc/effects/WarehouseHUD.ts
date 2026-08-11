// ─── 仓库/会话状态 HUD：接入公共 actionbar 显示总线（@yinxe/toolkit） ──
// 本包注册两个 actionbar 源，包内优先级：**选区会话(100) > 仓库状态(80)**；
// 跨包优先级统一在 HudManager 的 /scriptevent 总线上仲裁（数值越大越优先，
// 本包 modId = "item-route"，同优先级按 modId 字典序小者赢）。
//   · 选区会话（建仓/调整区域进行中）→ 会话流程/状态/选点情况
//   · 仓库状态（成员 + 附近）→ 仓库名 + 路由状态 + 工作状态（待分拣**物品总数**）
// 每个玩家按需产出内容；无内容返回 undefined → 本包不占总线，让位其它模组。
import type { Player } from "@minecraft/server";
import { HudManager } from "@yinxe/toolkit";
import type { Scheduler } from "../../core/scheduling/Scheduler";
import type { Warehouse } from "../../core/model/Warehouse";
import type { MemberService } from "../../core/services/MemberService";
import type { SelectionSessionStore, SelectionSession } from "../interaction/SelectionSessionStore";
import { isPlayerNearby, type PlayerPosition } from "../../core/model/Area";
import { color } from "../ui/uiColor";
import { playerNameOf } from "../util/playerName";

/** 附近判定外扩格数（站仓库外稍远也能看到状态） */
const HUD_MARGIN = 12;
/** 包内优先级：选区会话 > 仓库状态 */
const PRIORITY_SESSION = 100;
const PRIORITY_WAREHOUSE = 80;

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
  // 堵塞 = 处于阻塞态的输入容器**实际占用的槽数**（HUD bug 修复：`blockedInputs` 按容器 ID 记，
  // size 是"容器数"而非槽数——满箱输入因首格路由失败被整箱阻塞时，旧口径恒显示"堵塞 1 格"，误导玩家；
  // 现按 blockedInputIds 累加其 usedSlots，满 8 格即显示"堵塞 8 格"）
  let blocked = 0;
  for (const id of scheduler.blockedInputIds(w.id)) {
    const input = w.inputs.get(id);
    if (input !== undefined) blocked += input.usedSlots;
  }
  let work: string;
  if (blocked > 0) work = `${color.error}堵塞 ${blocked} 格`;
  else if (pending > 0) work = `${color.info}待分拣 ${pending} 格`;
  else work = `${color.muted}空闲`;
  return `${color.gold}[${w.displayName}] ${routeState}${color.muted} · ${work}`;
}

/**
 * 注册仓库/会话 HUD：接入公共 HudManager（每 0.5s 仲裁一次）。
 * - 有选区会话（建仓/调整区域）→ 会话源产出内容（priority 100）
 * - 否则就近"成员 + 附近"仓库 → 仓库源产出内容（priority 80）
 * - 皆无内容 → 两个源都返回 undefined → 不占总线，actionbar 让位。
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
  const hud = new HudManager({ modId: "item-route", intervalTicks: 10 });
  hud.register({
    id: "session",
    slot: "actionbar",
    priority: PRIORITY_SESSION,
    // 选区会话优先：正在建仓/调整区域的玩家显示流程/选点
    render: (p: Player) => {
      const name = playerNameOf(p);
      if (name === undefined) return undefined;
      const session = sessions.get(name);
      return session === undefined ? undefined : sessionLine(session);
    },
  });
  hud.register({
    id: "warehouse",
    slot: "actionbar",
    priority: PRIORITY_WAREHOUSE,
    // 就近取"成员身份 + 在附近"的仓库（同一玩家多仓时只显示最近一仓，避免刷屏）
    render: (p: Player) => {
      const name = playerNameOf(p);
      if (name === undefined) return undefined;
      const pos: PlayerPosition = { dimension: p.dimension.id, x: p.location.x, z: p.location.z };
      let best: Warehouse | undefined;
      let bestDist = Infinity;
      for (const w of loaded) {
        if (!members.can(w, name, "member")) continue; // HUD 只给拥有/管理成员看（真实+模拟玩家同名判定）
        if (!isPlayerNearby(w.area, [pos], HUD_MARGIN)) continue;
        const d = distTo(w, pos);
        if (d < bestDist) {
          bestDist = d;
          best = w;
        }
      }
      return best === undefined ? undefined : hudLine(scheduler, best);
    },
  });
  hud.start();
}