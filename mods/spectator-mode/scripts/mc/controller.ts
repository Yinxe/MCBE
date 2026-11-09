// ── 旁观控制器:组合 core 状态机与 mc 副作用,驱动活跃灵魂会话 ──
import { GameMode, system, world, type Player } from "@minecraft/server";
import { HudManager, runSafeDetached } from "@mc-toolchain/mod-common";
import { clampMaxDistance, DEFAULT_MAX_DISTANCE } from "../core/config";
import type { SpConfig, SoulAnchor } from "../core/types";
import { SoulEngine } from "../core/engine";
import { buildSoulHud, type SoulHudState } from "../core/hud";
import { readConfig, writeConfig, readSoulAnchor, writeSoulAnchor, clearSoulAnchor } from "./store";
import { clearNightVisionSnapshot, readNightVisionSnapshot, writeNightVisionSnapshot } from "./store";
import { spawnBodyGlow, spawnSoulGlow, spawnTetherLine } from "./particles";
import { allUsablePlayers, findAnyPlayer } from "./playerUtil";

/** 切换命令(带命名空间,唯一注册):/sp:soul 切换 · /sp:soul menu 管理 */
export const TOGGLE_COMMAND = "sp:soul";
/** tick 间隔(ticks);2 tick = 100ms(状态机更精准、扫掠连线呈高速流) */
export const TICK_INTERVAL_TICKS = 2;
/** 粒子每 N 个 tick 才刷一次(100ms×N);真身侧粒子降密度、减轻负担 */
export const PARTICLE_EVERY = 3;
/** 无人出窍时,自愈扫描降到 1 秒一次(100ms×N)避免空转 */
export const IDLE_EVERY = 10;
/** 超出距离容忍倒计时(毫秒) */
export const TOLERANCE_MS = 5000;

/** 夜视效果标识 */
export const NIGHT_VISION_EFFECT = "minecraft:night_vision";
/**
 * 夜视刷新间隔(ticks,20s)。
 *
 * 远小于效果时长,留 40 秒断档余量:即使某次 tick 被跳过或玩家卡顿也不会断档。
 */
export const NIGHT_VISION_REFRESH_TICKS = 400;
/**
 * 单次施加的夜视时长(ticks,60s)。
 *
 * MUST 显著大于 200 tick(10 秒)——客户端在夜视剩余不足 10 秒时会让屏幕
 * 在 40%~100% 强度间持续闪烁。若时长本身短于该阈值(第一版用的是 120 tick),
 * 整个灵魂阶段都会处在闪烁区间。取 60 秒后效果剩余时长始终在 40~60 秒之间,
 * 最低点仍是阈值的 4 倍,灵魂阶段不会闪烁。
 */
export const NIGHT_VISION_DURATION_TICKS = 1200;

/** 单 tick 经过的毫秒数(2 tick 一次驱动 → 100ms) */
const TICK_DELTA_MS = TICK_INTERVAL_TICKS * 50;

interface SoulSession {
  /** 进入旁观时的真身(维度/位置/原模式) */
  anchor: SoulAnchor;
  /** 距离/容忍状态机 */
  engine: SoulEngine;
  /** 运行帧计数(驱动扫掠连线相位) */
  run: number;
  /** 距上次刷新夜视已过的 tick 数 */
  nvElapsed: number;
}

/**
 * 旁观模式核心控制器:
 * - 进出场:记录锚点 → 切换到原生 Spectator;回归 → 还原维度/位置/游戏模式。
 * - 每 100ms 推进一次状态机:距离监控 + 容忍倒计时 + 强制回归。
 * - HUD(actionBar)渲染距离(由绿变红 / 容忍红色倒计时)。
 * - 真身标记粒子 + 灵魂锁链连线粒子。
 */
export class SoulController {
  private config: SpConfig;
  private readonly sessions = new Map<string, SoulSession>();
  private intervalId: number | undefined;
  /** HudManager 源注销函数(start 幂等:重复调用时先注销旧源,避免叠加渲染) */
  private unregisterHud: (() => void) | undefined;
  /** 已提示过失败(粒子/单玩家 tick 异常)的玩家 id(避免刷屏) */
  private readonly warned = new Set<string>();
  /** 无人出窍时的低频扫描计数 */
  private idleCounter = 0;
  /** 每灵魂玩家最新 HUD 状态(tick 更新;公用 HudManager 渲染 + 跨包仲裁) */
  private readonly soulStates = new Map<string, SoulHudState>();
  /** 公共 actionbar 显示管理器(/scriptevent 总线,priority 200 抢 actionbar) */
  private readonly hud = new HudManager({ modId: "spectator-mode", intervalTicks: TICK_INTERVAL_TICKS });

  constructor() {
    // 世界 DP 须在安全上下文读取,构造期先用默认值
    this.config = { enabled: true, maxDistance: DEFAULT_MAX_DISTANCE, showLink: false, nightVision: true };
  }

  /** 延迟启动:读取持久化配置并启动 tick 循环 */
  start(): void {
    this.config = readConfig();
    if (this.intervalId !== undefined) system.clearRun(this.intervalId);
    this.intervalId = system.runInterval(() => this.tick(), TICK_INTERVAL_TICKS);
    // 公共 actionbar 总线:灵魂 HUD 以 priority 200 抢占(他包自动让位),渲染交给 HudManager
    this.unregisterHud?.();
    this.unregisterHud = this.hud.register({
      id: "soul",
      slot: "actionbar",
      priority: 200,
      render: (p: Player) => {
        const st = this.soulStates.get(p.id);
        return st !== undefined ? buildSoulHud(st) : undefined;
      },
    });
    this.hud.start();
  }

  /** 当前配置(拷贝,防外部改) */
  getConfig(): SpConfig {
    return { ...this.config };
  }

  /**
   * 管理员保存配置;若禁用功能则强制所有灵魂回归。
   *
   * ⚠ 上下文约束:本方法由表单 `show().then()` 回调调用,该回调运行在受限(只读)
   * 上下文,`removeEffect` / `setGameMode` / `teleport` 在其中会抛错。
   * 因此配置立即生效(纯内存),而一切写操作推迟到安全 tick 执行。
   *
   * @param config - 新配置
   */
  setConfig(config: SpConfig): void {
    this.config = {
      enabled: config.enabled,
      maxDistance: clampMaxDistance(config.maxDistance),
      showLink: !!config.showLink,
      nightVision: !!config.nightVision,
    };
    // setDynamicProperty 不受限,可直接写盘
    writeConfig(this.config);

    // 以下均含受限写操作,推迟到安全上下文
    runSafeDetached(() => {
      if (!this.config.enabled) {
        this.forceReturnAll("旁观功能已被管理员禁用");
        return;
      }
      if (!this.config.nightVision) {
        this.stripNightVisionAll();
      }
    });
  }

  /** 玩家是否处于灵魂出窍状态 */
  isActive(player: Player): boolean {
    return this.sessions.has(player.id);
  }

  /**
   * /sp:soul 切换:进入旁观或回归本体。
   * 极限模式(world.isHardcore)下禁用——模式切换单向,切成旁观无法切回。
   * @param player - 执行命令的玩家
   * @returns 需要发送给玩家的提示消息;空串表示内部已处理
   */
  toggle(player: Player): string {
    const existing = this.sessions.get(player.id);
    if (existing !== undefined) {
      this.returnSoul(player, existing, "手动回归");
      return "";
    }

    // 已是旁观者:有残留锚点(重进未恢复/事件漏触等遗留灵魂)→ 强制回归本体作逃生出口;
    // 无锚点则只是普通旁观者,仅提示不代办。
    if (player.getGameMode() === GameMode.Spectator) {
      const anchor = readSoulAnchor(player);
      if (anchor !== undefined) {
        this.returnToAnchor(player, anchor, "手动回归");
        return "";
      }
      if (!this.config.enabled) {
        return `§c旁观功能未启用,请联系管理员在 §f/${TOGGLE_COMMAND} menu§c 开启`;
      }
      return "§c你已处于旁观模式(非本模组进入,请用游戏提供的方式退出旁观)";
    }

    if (world.isHardcore) {
      return "§c本世界为极限模式:游戏模式切换单向,灵魂出窍已禁用";
    }
    if (!this.config.enabled) {
      return `§c旁观功能未启用,请联系管理员在 §f/${TOGGLE_COMMAND} menu§c 开启`;
    }
    return this.enterSoul(player);
  }

  /**
   * 玩家加入后恢复。加入事件早期 player 对象可能未就绪(location/dimension 为
   * undefined),轮询重试直到能拿到实体(上限 ~4s,tick 自愈兜底不限时),然后:
   * - 极限模式:警告玩家禁用。
   * - 有锚点(以灵魂状态离线):交给 resumeSoul 恢复(含配置守卫)。
   */
  restoreOnJoin(playerId: string): void {
    let attempts = 0;
    const tryProcess = (): void => {
      const player = findAnyPlayer(playerId);
      if (player === undefined) {
        attempts += 1;
        if (attempts <= 10) system.runTimeout(() => tryProcess(), 20); // 每 20 tick 重试
        return;
      }
      if (world.isHardcore) {
        player.sendMessage("§c⚠ 本世界为极限模式:旁观模式(灵魂出窍)已禁用(游戏模式切换单向)。");
      }
      const anchor = readSoulAnchor(player);
      if (anchor) this.resumeSoul(player, anchor);
    };
    tryProcess();
  }

  /** 玩家离开:按 id 清理内存会话与 HUD 状态(锚点留玩家身上,供重连恢复) */
  onPlayerLeave(playerId: string): void {
    this.sessions.delete(playerId);
    this.soulStates.delete(playerId);
  }

  /** 一次性失败提示(粒子/单玩家 tick 异常;每玩家只记一次,避免刷屏) */
  private warnOnce(id: string, e: unknown): void {
    if (this.warned.has(id)) return;
    this.warned.add(id);
    console.warn(`[spectator-mode] tick/particle failed (${id}): ${String(e)}`);
  }

  // ── 夜视增益 ─────────────────────────────────────────────

  /**
   * 快照玩家进入前的夜视状态,并立即施加模组夜视。
   *
   * 快照**必须**在施加之前完成:否则读到的就是模组自己施加的效果,
   * 回归时会把模组夜视当成玩家原有夜视再恢复一次(玩家白得夜视)。
   * 进入前无夜视时快照记为 undefined,回归时据此移除。
   */
  private applyNightVision(player: Player): void {
    if (!this.config.nightVision) return;
    clearNightVisionSnapshot(player);
    try {
      const existing = player.getEffect(NIGHT_VISION_EFFECT);
      if (existing !== undefined) {
        writeNightVisionSnapshot(player, {
          amplifier: existing.amplifier,
          durationTicks: existing.duration,
        });
      }
    } catch (e) {
      // 读不到原有夜视 → 当作原本没有;回归时移除夜视
      this.warnOnce(player.id, e);
    }
    this.refreshNightVision(player);
  }

  /** 施加一轮模组夜视(短时长 + 低粒子,由 tick 周期刷新维持不断档) */
  private refreshNightVision(player: Player): void {
    if (!this.config.nightVision) return;
    try {
      player.addEffect(NIGHT_VISION_EFFECT, NIGHT_VISION_DURATION_TICKS, {
        amplifier: 0,
        showParticles: false,
      });
    } catch (e) {
      this.warnOnce(player.id, e);
    }
  }

  /**
   * 回归本体时把夜视**原样**恢复成进入那一刻的状态。
   *
   * 关键语义:夜视是模组赠送的效果,MUST NOT 消耗玩家自己的夜视时长。
   * 因此按快照的 `durationTicks` 原样重新施加,不扣除灵魂阶段停留的时间;
   * 快照不存在(进入前无夜视)→ 移除夜视;总时长为非正数(无限)→ 保持无限。
   */
  private restoreNightVision(player: Player): void {
    const snapshot = readNightVisionSnapshot(player);
    clearNightVisionSnapshot(player);
    try {
      if (snapshot === undefined) {
        player.removeEffect(NIGHT_VISION_EFFECT);
        return;
      }
      player.addEffect(NIGHT_VISION_EFFECT, snapshot.durationTicks, {
        amplifier: snapshot.amplifier,
        showParticles: true,
      });
    } catch (e) {
      this.warnOnce(player.id, e);
    }
  }

  /** 管理员关闭夜视增益:立即移除在场灵魂的夜视(快照保留,回归时仍能恢复玩家原有夜视) */
  private stripNightVisionAll(): void {
    const players = allUsablePlayers();
    for (const id of this.sessions.keys()) {
      const player = players.get(id);
      if (!player) continue;
      try {
        player.removeEffect(NIGHT_VISION_EFFECT);
      } catch (e) {
        this.warnOnce(id, e);
      }
    }
  }

  // ── 私有方法 ──────────────────────────────────────────────

  /**
   * 恢复灵魂出窍会话:保持旁观模式、重建状态机,不移动本体。
   * 玩家可随时用 /sp:soul 手动回归本体。
   * 守卫:极限模式 / 功能被禁用时一律回退"回归本体"。
   */
  private resumeSoul(player: Player, anchor: SoulAnchor): void {
    if (world.isHardcore) {
      this.returnToAnchor(player, anchor, "极限模式无法保持旁观状态");
      return;
    }
    if (!this.config.enabled) {
      this.returnToAnchor(player, anchor, "旁观功能已被禁用");
      return;
    }
    this.sessions.delete(player.id);
    try {
      player.setGameMode(GameMode.Spectator);
    } catch {
      // 无法切回旁观(如极限模式)→ 退化为回归本体
      this.returnToAnchor(player, anchor, "无法恢复旁观状态");
      return;
    }
    this.sessions.set(player.id, {
      anchor,
      engine: new SoulEngine(TOLERANCE_MS),
      run: 0,
      nvElapsed: 0,
    });
    this.applyNightVision(player);
    player.sendMessage(`§a已恢复灵魂出窍状态 · 输入 §f/${TOGGLE_COMMAND}§a 回归本体`);
  }

  /** 进入旁观:先切模式成功再落盘锚点,避免切换失败留下无会话的残留锚点 */
  private enterSoul(player: Player): string {
    const location = player.location;
    const anchor: SoulAnchor = {
      dimensionId: player.dimension.id,
      x: location.x,
      y: location.y,
      z: location.z,
      gameMode: player.getGameMode() as string,
    };

    // 先切模式:失败(极限模式/权限/引擎拒绝)时不留任何状态,玩家保持原样
    try {
      player.setGameMode(GameMode.Spectator);
    } catch {
      return "§c无法进入旁观模式(游戏模式切换被拒绝)";
    }

    // 切换成功后才写锚点与会话,保证"有锚点 ⟺ 曾成功进入"
    writeSoulAnchor(player, anchor);
    this.sessions.set(player.id, {
      anchor,
      engine: new SoulEngine(TOLERANCE_MS),
      run: 0,
      nvElapsed: 0,
    });
    // 夜视:先快照玩家原有状态再施加模组夜视(顺序不可颠倒)
    this.applyNightVision(player);
    try {
      spawnBodyGlow(player.dimension, location, 24);
    } catch (e) {
      this.warnOnce(player.id, e);
    }

    return `§a已进入旁观模式(灵魂出窍)· 输入 §f/${TOGGLE_COMMAND}§r 回归本体`;
  }

  /** 移出会话并回归真身(手动回归 / 容忍耗尽强制) */
  private returnSoul(player: Player, session: SoulSession, reason: string): void {
    this.sessions.delete(player.id);
    this.returnToAnchor(player, session.anchor, reason);
  }

  /** 统一回归:清 HUD/锚点 → 传送回真身 → 还原游戏模式 → 恢复夜视 → 标记粒子 → 提示 */
  private returnToAnchor(player: Player, anchor: SoulAnchor, reason: string): void {
    clearSoulAnchor(player);
    // HUD 状态移除:公共 HudManager 感知"无灵魂内容"后自动清 actionbar / 让位其它模组
    this.soulStates.delete(player.id);

    const dimension = safeDimension(anchor.dimensionId);
    if (dimension !== undefined) {
      try {
        player.teleport({ x: anchor.x, y: anchor.y, z: anchor.z }, { dimension });
        spawnBodyGlow(dimension, { x: anchor.x, y: anchor.y, z: anchor.z }, 24);
      } catch {
        // 目标维度/位置不可用时跳过传送(至少还原模式)
      }
    }

    try {
      player.setGameMode(anchor.gameMode as GameMode);
    } catch {
      player.setGameMode(GameMode.Survival); // 兜底
    }

    // 夜视:按进入时的快照原样恢复(不扣除灵魂阶段停留的时长)
    this.restoreNightVision(player);

    player.sendMessage(`§a${reason},已回到本体`);
  }

  /** 管理员禁用功能:强制所有在场灵魂回归 */
  private forceReturnAll(reason: string): void {
    const players = allUsablePlayers();
    for (const [id, session] of this.sessions) {
      const player = players.get(id);
      if (!player) continue;
      this.returnSoul(player, session, reason);
    }
  }

  /** 自愈:已是旁观者且有残留锚点未建会话(重进/事件漏触)→ 恢复灵魂出窍(或按守卫回归) */
  private selfHeal(players: Map<string, Player>): void {
    for (const [playerId, player] of players) {
      if (this.sessions.has(playerId)) continue;
      // 单个玩家异常只跳过该玩家,不中断整个扫描(假人/半初始化实体可能随时抛错)
      try {
        if (player.getGameMode() !== GameMode.Spectator) continue;
        const anchor = readSoulAnchor(player);
        if (anchor) this.resumeSoul(player, anchor);
      } catch {
        continue;
      }
    }
  }

  /** tick 循环:有人出窍时走全量(状态/容忍/HUD/粒子);无人时降到低频 1Hz 扫描,避免空转 */
  private tick(): void {
    if (this.sessions.size === 0) {
      this.idleCounter += 1;
      if (this.idleCounter % IDLE_EVERY !== 0) return; // 无人出窍:约 1s 扫一次即可
      this.selfHeal(allUsablePlayers());
      return;
    }
    this.idleCounter = 0;
    const players = allUsablePlayers();
    this.selfHeal(players);

    for (const [id, session] of this.sessions) {
      const player = players.get(id);
      if (!player) continue; // 玩家不在线(防御)
      // 单个玩家的任何异常只跳过该玩家,不中断整轮 tick(不让他人灵魂卡住)
      try {
        this.tickOne(id, player, session);
      } catch (e) {
        this.warnOnce(id, e);
      }
    }
  }

  /** 单个灵魂玩家的 tick 推进:距离 → 状态机 → 强制回归 / HUD / 粒子 */
  private tickOne(id: string, player: Player, session: SoulSession): void {
    const anchor = session.anchor;
    const position = player.location;
    const sameDimension = player.dimension.id === anchor.dimensionId;
    const distance = sameDimension
      ? Math.hypot(position.x - anchor.x, position.y - anchor.y, position.z - anchor.z)
      : Infinity; // 跨维度一律视为超限

    const result = session.engine.update(distance, this.config.maxDistance, TICK_DELTA_MS);

    if (result.forceReturn) {
      this.returnSoul(player, session, "超出距离,容忍倒计时结束");
      return;
    }

    // HUD:把最新状态交给公共 HudManager(actionbar 槽 priority 200)渲染/仲裁,不在本层直写屏幕
    this.soulStates.set(player.id, {
      inRange: result.inRange,
      dist: distance,
      maxDistance: this.config.maxDistance,
      remainingMs: result.remainingMs,
    });

    // 夜视:每 N tick 刷新一次,保证灵魂阶段全程不断档
    session.nvElapsed += TICK_INTERVAL_TICKS;
    if (session.nvElapsed >= NIGHT_VISION_REFRESH_TICKS) {
      session.nvElapsed = 0;
      this.refreshNightVision(player);
    }

    // 视觉:灵魂光环每帧(隔离失败,不影响其他);真身侧低频且真身未加载则跳过
    session.run++;
    try {
      spawnSoulGlow(player.dimension, position, 2);
    } catch (e) {
      this.warnOnce(id, e);
    }

    if (session.run % PARTICLE_EVERY === 0) {
      const body = { x: anchor.x, y: anchor.y, z: anchor.z };
      if (isPositionLoaded(player.dimension, body)) {
        try {
          spawnBodyGlow(player.dimension, body, 4);
        } catch (e) {
          this.warnOnce(id, e);
        }
        if (this.config.showLink) {
          try {
            spawnTetherLine(player.dimension, body, position, session.run / PARTICLE_EVERY);
          } catch (e) {
            this.warnOnce(id, e);
          }
        }
      }
    }
  }
}

/** 安全获取维度对象;无效 id 返回 undefined */
function safeDimension(dimensionId: string): import("@minecraft/server").Dimension | undefined {
  try {
    return world.getDimension(dimensionId);
  } catch {
    return undefined;
  }
}

/** 位置所在区块是否已加载(未加载时 spawnParticle/方块访问会抛 LocationInUnloadedChunkError) */
function isPositionLoaded(
  dimension: import("@minecraft/server").Dimension,
  at: { x: number; y: number; z: number }
): boolean {
  try {
    dimension.getBlock(at);
    return true;
  } catch {
    return false;
  }
}
