// ─── 跨包 HUD 管理器（actionbar / title / sidebar，逐玩家优先级仲裁） ──
// 每个行为包 = 独立 JS 环境，内存不共享 → 用 /scriptevent 作**纯运行时总线**：
//   · 本包每驱动周期广播三槽声明（`yinxe:hud` + 紧凑 JSON，不进存档），
//     每个槽位声明带**覆盖玩家集**（`n:[名字]`，"*"=覆盖全员），即"我对哪些玩家有内容"
//   · 订阅同命名空间事件，把其他包的声明收进内存表；心跳超时自动过期
//   · **逐玩家仲裁**：对每个真实玩家 X，赢家 = 对 X 有内容（覆盖集含 X 或本包对 X 有内容）
//     且 priority 最高的包；同值按 modId 字典序小者。赢家才给 X 渲染，输家清 X 的残留。
//     → 灵魂者见灵魂 HUD、圈地者见选点、仓库旁见仓库状态，各看各的，互不压制。
// **渲染策略（防消失/防误清）**：赢家每周期**无条件写**（含内容不变；即使被外部清空，下周期自愈）；
// 输家**绝不写也绝不清**（他包内容由赢家维护）；仅当某玩家该槽**无人赢**时，才清自己的残留。
//
// 范围/逐玩家条件：由源自行判断——`render(player)` 对不在范围/不满足该玩家条件的玩家
// 返回 undefined，即不被覆盖、不参与该玩家的仲裁（无需单独的"范围"开关）。
//
// 玩家目标过滤：默认跳过 undefined/坏对象（访问抛错）与**模拟玩家/假人**
// （假人读取游戏模式 getGameMode() 会抛错，据此识别，不依赖 tag，兼容任何假人模组）；
// `filterPlayer` 选项可在其后叠加黑名单/权限过滤。
// 启停控制：`setEnabled(false)` 暂停并立即释放全部槽位声明（他包可接管）+ 清残留；
// `register()` 返回注销函数可停止单个源；`stop()` 全量销毁。
//
// ⚠️ 已知限制：scriptevent best-effort（~1 tick 递送延迟，极端负载可能丢事件）；仲裁收敛
// 延迟约一个声明周期，转换瞬间可能短暂双写后自愈。任意行为包可伪造总线（自家套件内可接受）。
// sidebar 槽框架就绪、暂无消费模组，建议冒烟后再启用。
import {
  world,
  system,
  DisplaySlotId,
  ObjectiveSortOrder,
  ScoreboardIdentityType,
  Player,
} from "@minecraft/server";
import type { Dimension, ScriptEventCommandMessageAfterEvent } from "@minecraft/server";
import { pickWinner, type BusClaim } from "./arbiter";

// ── 槽位 ──────────────────────────────────────────────────────
export type HudSlot = "actionbar" | "title" | "sidebar";
export const HUD_SLOTS: readonly HudSlot[] = ["actionbar", "title", "sidebar"] as const;

/** sidebar 内容：标题 + 行（标签→数值），行按 score 降序显示 */
export interface SidebarView {
  title?: string;
  rows: Array<[string, number]>;
}

/** 屏幕显示源（一个模组可注册多个源；范围/逐玩家条件见 targets） */
export interface HudSource {
  /** 包内唯一标识（session/warehouse/soul…），仅日志/调试用 */
  id: string;
  slot: HudSlot;
  /** 越大越优先；同优先级按 modId 字典序小者赢 */
  priority: number;
  /**
   * 前置条件（**范围/逐玩家条件**，可选）：返回 false 的玩家不被本源覆盖、
   * 不参与该玩家的仲裁，render 也不会被调用。默认对所有可用玩家生效。
   * 范围条件可直接用 `isWithinRange(player, center, radius)`。
   */
  targets?(player: Player): boolean;
  /**
   * actionbar/title：返回该玩家的文本；`undefined` = 该玩家无内容，即不被覆盖、不参与仲裁。
   */
  render?(player: Player): string | undefined;
  /** sidebar：返回行数据；undefined = 无内容（当前无消费，框架就绪） */
  renderSidebar?(player: Player): SidebarView | undefined;
}

export interface HudManagerOptions {
  /** 跨包唯一标识（如 "item-route" / "spectator-mode"），参与总线与同位决胜 */
  modId: string;
  /** 单驱动周期（tick）：广播 + 过期 + 仲裁 + 渲染（默认 2） */
  intervalTicks?: number;
  /** 他包声明过期阈值（tick；默认 40 ≈ 2s，需 > 2×intervalTicks） */
  expiryTicks?: number;
  /**
   * 额外玩家过滤：**内置已默认排除假人/模拟玩家与无效对象**，
   * 此回调在其后叠加（返回 false 的玩家不参与声明、不被渲染）。可用于黑名单/权限过滤。
   */
  filterPlayer?: (player: Player) => boolean;
  /** 调试日志（广播/接收声明打印，`console.warn`），游戏内验证跨包递送用；默认 false */
  debug?: boolean;
}

// ── 总线常量（跨包协定的脚本事件 id / 命名空间，勿配） ─────
const BUS_NAMESPACE = "yinxe";
const BUS_EVENT = "yinxe:hud";

/**
 * 玩家目标可用性判定：模拟玩家（假人，含本仓 mock-player 与第三方假人模组）
 * 在**读取游戏模式 `getGameMode()` 时会抛错**（已知可靠特征，跨任意假人成立），
 * 据此识别并排除；同时防御 undefined / 非 Player / 半初始化（字段缺失或访问抛错）。
 * 不依赖 tag / 白名单。
 */
function isUsablePlayerTarget(p: unknown): p is Player {
  if (p === undefined || p === null || !(p instanceof Player)) return false;
  try {
    if (typeof p.id !== "string" || p.id.length === 0) return false;
    if (p.dimension === undefined || p.location === undefined) return false;
    if (p.getGameMode() === undefined) return false; // 结果异常也视为不可用
    return true;
  } catch {
    return false; // getGameMode 抛错 → 视为假人/不可用对象
  }
}

/** 在线玩家安全枚举：跳过假人/坏对象（见 isUsablePlayerTarget）；可选叠加调用方过滤器。 */
function usablePlayers(extra: ((p: Player) => boolean) | undefined): Player[] {
  let all: Player[];
  try {
    all = world.getPlayers();
  } catch {
    return [];
  }
  const out: Player[] = [];
  for (const p of all) {
    try {
      if (!isUsablePlayerTarget(p)) continue;
      if (extra !== undefined && !extra(p)) continue;
      out.push(p);
    } catch {
      /* 半初始化/异常实体跳过 */
    }
  }
  return out;
}

/** modId → 计分板目标名（去掉非法字符） */
function objectiveName(modId: string): string {
  return `yinxe_hud_${modId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

/** 某槽位的声明（含逐玩家覆盖集）：priority>0 且覆盖集决定"对谁生效" */
interface SlotClaim {
  priority: number;
  /** 覆盖的玩家名；`"*"` = 覆盖本包识别的全部可用玩家 */
  names: string[] | "*";
}

/** 无内容占位声明 */
const NO_CLAIM: SlotClaim = { priority: 0, names: [] };

/** 某槽位本周期计算结果 */
interface SlotData {
  claim: SlotClaim;
  /** actionbar/title：playerId → 文本（undefined = 该玩家无内容） */
  texts: Map<string, string | undefined>;
  /** sidebar：视图（无内容为 undefined） */
  sidebar?: SidebarView;
}

export class HudManager {
  private readonly modId: string;
  private readonly intervalTicks: number;
  private readonly expiryTicks: number;
  private readonly sources: HudSource[] = [];
  /** 其他包声明：modId → (各槽位声明 + 收到时 tick) */
  private readonly others = new Map<
    string,
    { slots: Partial<Record<HudSlot, SlotClaim>>; lastSeenTick: number }
  >();
  private intervalId?: number;
  private unlisten?: () => void;
  /** 是否启用显示（setEnabled 暂停/恢复；停用时释放全部声明并清残留） */
  private enabled = true;
  private readonly filterPlayer: ((p: Player) => boolean) | undefined;
  private readonly debug: boolean;
  /** change-detection：`${slot}:${playerId}` → 上次写的文本 */
  private readonly lastText = new Map<string, string>();
  /** sidebar 状态 */
  private sidebarHeld = false;
  private lastSidebarSig?: string;
  private dimension?: Dimension;

  constructor(opts: HudManagerOptions) {
    this.modId = opts.modId;
    this.intervalTicks = opts.intervalTicks ?? 2;
    this.expiryTicks = opts.expiryTicks ?? 40;
    this.filterPlayer = opts.filterPlayer;
    this.debug = opts.debug ?? false;
  }

  // ─── 公开入口 ──────────────────────────────────────────────
  /** 注册一个显示源；返回注销函数。可在 start 前后调用。 */
  register(source: HudSource): () => void {
    this.sources.push(source);
    return () => {
      const i = this.sources.indexOf(source);
      if (i >= 0) this.sources.splice(i, 1);
    };
  }

  /** 启动驱动循环。须在安全上下文调用（Phase 4 `system.run` / 事件回调内）。 */
  start(): void {
    if (this.intervalId !== undefined) return;
    const cb = (ev: ScriptEventCommandMessageAfterEvent): void => this.onEvent(ev);
    this.unlisten = () => system.afterEvents.scriptEventReceive.unsubscribe(cb);
    system.afterEvents.scriptEventReceive.subscribe(cb, { namespaces: [BUS_NAMESPACE] });
    this.intervalId = system.runInterval(() => this.drive(), this.intervalTicks);
  }

  /** 停止驱动循环并发总线声明。一般只在包卸载/功能禁用时调用。 */
  stop(): void {
    if (this.intervalId !== undefined) {
      system.clearRun(this.intervalId);
      this.intervalId = undefined;
    }
    if (this.unlisten) {
      this.unlisten();
      this.unlisten = undefined;
    }
    this.others.clear();
    this.lastText.clear();
    this.lastSidebarSig = undefined;
    this.releaseSidebar();
  }

  /**
   * 暂停 / 恢复显示（包级总闸）。停用时立即向总线广播全槽释放（他包可接管）、
   * 清空本地声明表与渲染残留；恢复后下一个驱动周期重新声明。仅暂停不销毁订阅，轻量。
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.announce({ actionbar: NO_CLAIM, title: NO_CLAIM, sidebar: NO_CLAIM });
      this.others.clear();
      this.lastText.clear();
      this.lastSidebarSig = undefined;
      this.releaseSidebar();
    }
  }

  // ─── 驱动循环：声明 → 过期 → 逐玩家仲裁 → 渲染 ────────────
  private drive(): void {
    if (!this.enabled) return; // 已停用：setEnabled(false) 已释放声明并清残留，静默等待恢复
    const now = system.currentTick;
    const players = usablePlayers(this.filterPlayer);
    // 清理离线玩家残留的渲染记录
    this.pruneGone(players);

    // 1) 各槽内容 + 声明（含覆盖集）
    const slotData = new Map<HudSlot, SlotData>();
    const claims: Record<HudSlot, SlotClaim> = { actionbar: NO_CLAIM, title: NO_CLAIM, sidebar: NO_CLAIM };
    for (const slot of HUD_SLOTS) {
      const d = this.computeSlot(slot, players);
      slotData.set(slot, d);
      claims[slot] = d.claim;
    }

    // 2) 广播 + 3) 过期
    this.announce(claims);
    this.expireOthers(now);

    // 4) 逐槽：sidebar 全局仲裁；actionbar/title 逐玩家仲裁 + 渲染
    for (const slot of HUD_SLOTS) {
      if (slot === "sidebar") {
        const winner = this.resolveSidebarWinner(claims.sidebar, now);
        if (winner === this.modId) this.renderSidebarSlot(slotData.get(slot)!.sidebar);
        else this.releaseSidebar();
        continue;
      }
      const data = slotData.get(slot)!;
      for (const p of players) {
        const cands = this.candidatesFor(slot, p, claims[slot], data.texts.get(p.id) !== undefined, now);
        const winner = pickWinner(cands, now, this.expiryTicks);
        if (winner === undefined) {
          // 该玩家此槽无人赢（含本包内容刚结束）→ 清自己的残留（幂等）
          this.clearResidue(slot, p);
        } else if (winner.modId === this.modId) {
          // 我赢 → 每周期无条件写：即使被外部（他包/系统）清空，下周期自愈
          this.renderOne(slot, p, data.texts.get(p.id));
        }
        // 他赢 → 绝不写也绝不清：该玩家的内容由赢家自己维护（防止误清赢家内容）
      }
    }
  }

  /** 汇总某槽位内容 + 声明：priority = 有内容源的最高优先级；覆盖集 = 有内容的玩家名。 */
  private computeSlot(slot: HudSlot, players: Player[]): SlotData {
    const ordered = this.sources
      .filter((s) => s.slot === slot && (slot === "sidebar" ? s.renderSidebar : s.render))
      .sort((a, b) => b.priority - a.priority);
    if (ordered.length === 0) return { claim: NO_CLAIM, texts: new Map() };

    if (slot === "sidebar") {
      // 全局侧栏：任意（被 targets/范围条件命中的）可用玩家有视图 → 声明；内容取第一个视图
      for (const src of ordered) {
        for (const p of players) {
          if (src.targets !== undefined && !src.targets(p)) continue;
          const view = src.renderSidebar?.(p);
          if (view && view.rows.length > 0) {
            return {
              claim: { priority: src.priority, names: players.length > 0 ? "*" : [] },
              texts: new Map(),
              sidebar: view,
            };
          }
        }
      }
      return { claim: NO_CLAIM, texts: new Map() };
    }

    // actionbar / title：逐玩家取最高优先级源有内容者；覆盖集 = 有内容的玩家名
    const texts = new Map<string, string | undefined>();
    const covered: string[] = [];
    let activePriority = 0;
    for (const p of players) {
      let text: string | undefined;
      for (const src of ordered) {
        // 范围/逐玩家前置条件：未命中 → 本源不覆盖该玩家
        if (src.targets !== undefined && !src.targets(p)) continue;
        const t = src.render?.(p);
        if (t !== undefined) {
          text = t;
          if (src.priority > activePriority) activePriority = src.priority;
          break;
        }
      }
      texts.set(p.id, text);
      if (text !== undefined) covered.push(p.name);
    }
    const claim: SlotClaim =
      activePriority > 0
        ? { priority: activePriority, names: covered.length === players.length ? "*" : covered }
        : NO_CLAIM;
    return { claim, texts };
  }

  /** 对玩家 P 构建某槽候选（本包仅当对该玩家有内容 + 他包覆盖含 P）。 */
  private candidatesFor(
    slot: HudSlot,
    p: Player,
    selfClaim: SlotClaim,
    selfHasContent: boolean,
    now: number
  ): BusClaim[] {
    const cands: BusClaim[] = [];
    if (selfClaim.priority > 0 && selfHasContent) {
      cands.push({ modId: this.modId, priority: selfClaim.priority, lastSeenTick: now });
    }
    for (const [modId, o] of this.others) {
      const c = o.slots[slot];
      if (c === undefined || c.priority <= 0) continue;
      if (c.names !== "*" && !c.names.includes(p.name)) continue; // 覆盖集不含 P → 对他无效
      cands.push({ modId, priority: c.priority, lastSeenTick: o.lastSeenTick });
    }
    return cands;
  }

  /** 广播本包三槽声明（紧凑 JSON；priority=0 的槽省略；覆盖集为名字数组或 "*"）。 */
  private announce(claims: Record<HudSlot, SlotClaim>): void {
    if (this.dimension === undefined) {
      try {
        this.dimension = world.getDimension("overworld");
      } catch {
        return;
      }
    }
    const parts: string[] = [];
    for (const slot of HUD_SLOTS) {
      const c = claims[slot];
      if (c.priority > 0) parts.push(`"${slot}":{"p":${c.priority},"n":${JSON.stringify(c.names)}}`);
    }
    const payload = `{"m":"${this.modId}","c":{${parts.join(",")}}}`;
    if (this.debug) console.warn(`[hud:${this.modId}] 广播 ${payload}`);
    try {
      this.dimension.runCommand(`scriptevent ${BUS_EVENT} ${payload}`);
    } catch {
      /* 广播尽力而为：失败不影响本包显示 */
    }
  }

  /** 接收他包声明（跳过自己；整体替换该包声明，priority=0 即释放）。 */
  private onEvent(ev: ScriptEventCommandMessageAfterEvent): void {
    if (ev.id !== BUS_EVENT) return;
    let data: { m?: unknown; c?: Record<string, { p?: unknown; n?: unknown }> };
    try {
      data = JSON.parse(ev.message) as { m?: unknown; c?: Record<string, { p?: unknown; n?: unknown }> };
    } catch {
      return;
    }
    const modId = data?.m;
    if (typeof modId !== "string" || modId.length === 0 || modId === this.modId) return;
    const c = data?.c;
    if (!c || typeof c !== "object") return;
    const slots: Partial<Record<HudSlot, SlotClaim>> = {};
    for (const slot of HUD_SLOTS) {
      const s = c[slot];
      if (s && typeof s === "object" && typeof s.p === "number" && s.p > 0) {
        const names = Array.isArray(s.n)
          ? s.n.filter((x: unknown): x is string => typeof x === "string")
          : [];
        slots[slot] = { priority: s.p, names: names.includes("*") ? "*" : names };
      }
    }
    this.others.set(modId, { slots, lastSeenTick: system.currentTick });
    if (this.debug) console.warn(`[hud:${this.modId}] 收到 ${modId} → ${JSON.stringify(slots)}`);
  }

  /** 心跳过期：超时未再声明的他包整体移除。 */
  private expireOthers(now: number): void {
    for (const [modId, o] of [...this.others]) {
      if (now - o.lastSeenTick > this.expiryTicks) this.others.delete(modId);
    }
  }

  /** 移除已离线玩家的渲染记录（防内存增长）。 */
  private pruneGone(players: Player[]): void {
    const online = new Set<string>();
    for (const p of players) online.add(p.id);
    for (const key of [...this.lastText.keys()]) {
      const sep = key.indexOf(":");
      if (sep >= 0 && !online.has(key.slice(sep + 1))) this.lastText.delete(key);
    }
  }

  // ─── 渲染 / 清残留（逐玩家） ───────────────────────────────
  /** 本包是玩家 P 的赢家：每周期无条件写内容（含空内容清屏）。 */
  private renderOne(slot: HudSlot, p: Player, text: string | undefined): void {
    const t = text ?? "";
    const key = `${slot}:${p.id}`;
    try {
      if (slot === "actionbar") p.onScreenDisplay.setActionBar(t);
      else p.onScreenDisplay.setTitle(t, { fadeInDuration: 0, stayDuration: 60, fadeOutDuration: 0 });
      this.lastText.set(key, t);
    } catch {
      /* 玩家下线/切换维度：跳过 */
    }
  }

  /**
   * 该玩家此槽**无人赢**时清自己的残留（幂等）：
   * 仅当本包之前写过非空内容才写空；别人赢时绝不调用本方法（见 drive）。
   */
  private clearResidue(slot: HudSlot, p: Player): void {
    const key = `${slot}:${p.id}`;
    const prev = this.lastText.get(key);
    if (typeof prev !== "string" || prev === "") return; // 从未写过/已为空 → 不动
    try {
      if (slot === "actionbar") p.onScreenDisplay.setActionBar("");
      else p.onScreenDisplay.setTitle("", { fadeInDuration: 0, stayDuration: 0, fadeOutDuration: 0 });
      this.lastText.delete(key);
    } catch {
      this.lastText.delete(key);
    }
  }

  // ── sidebar 写回（未消费，冒烟后再启用） ──────────────────
  private resolveSidebarWinner(selfClaim: SlotClaim, now: number): string | undefined {
    const cands: BusClaim[] = [];
    if (selfClaim.priority > 0) cands.push({ modId: this.modId, priority: selfClaim.priority, lastSeenTick: now });
    for (const [modId, o] of this.others) {
      const c = o.slots.sidebar;
      if (c !== undefined && c.priority > 0) cands.push({ modId, priority: c.priority, lastSeenTick: o.lastSeenTick });
    }
    return pickWinner(cands, now, this.expiryTicks)?.modId;
  }

  private renderSidebarSlot(view: SidebarView | undefined): void {
    if (!view || view.rows.length === 0) {
      this.releaseSidebar();
      return;
    }
    const sig = JSON.stringify(view);
    if (this.lastSidebarSig === sig && this.sidebarHeld) return; // change-detection
    const name = objectiveName(this.modId);
    try {
      let obj = world.scoreboard.getObjective(name);
      if (!obj) obj = world.scoreboard.addObjective(name, view.title ?? this.modId);
      const labels = new Set<string>();
      for (const [label, value] of view.rows) {
        labels.add(label);
        obj.setScore(label, value);
      }
      for (const part of obj.getParticipants()) {
        if (part.type === ScoreboardIdentityType.FakePlayer && !labels.has(part.displayName)) {
          obj.removeParticipant(part);
        }
      }
      world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, {
        objective: obj,
        sortOrder: ObjectiveSortOrder.Descending,
      });
      this.lastSidebarSig = sig;
      this.sidebarHeld = true;
    } catch {
      /* 计分板操作失败不影响其它槽 */
    }
  }

  /** 释放自己持有的 sidebar：清槽位 + 删自己命名 objective。 */
  private releaseSidebar(): void {
    if (!this.sidebarHeld) return;
    this.sidebarHeld = false;
    this.lastSidebarSig = undefined;
    try {
      world.scoreboard.clearObjectiveAtDisplaySlot(DisplaySlotId.Sidebar);
      const obj = world.scoreboard.getObjective(objectiveName(this.modId));
      if (obj) world.scoreboard.removeObjective(obj);
    } catch {
      /* 忽略 */
    }
  }
}