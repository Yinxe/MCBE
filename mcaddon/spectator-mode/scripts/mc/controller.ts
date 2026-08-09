// ── 旁观控制器：组合 core 状态机与 mc 副作用，驱动活跃灵魂会话 ──
import { GameMode, system, world, type Player } from "@minecraft/server";
import { clampMaxDistance, DEFAULT_MAX_DISTANCE } from "../core/config";
import type { SpConfig, SoulAnchor } from "../core/types";
import { SoulEngine } from "../core/engine";
import { buildSoulHud } from "../core/hud";
import { readConfig, writeConfig, readSoulAnchor, writeSoulAnchor, clearSoulAnchor } from "./store";
import { spawnBodyGlow, spawnSoulGlow, spawnTetherLine } from "./particles";
import { allUsablePlayers, findAnyPlayer } from "./playerUtil";

/** 切换命令（带命名空间，唯一注册）：/sp:soul 切换 · /sp:soul menu 管理 */
export const TOGGLE_COMMAND = "sp:soul";
/** tick 间隔（ticks）；2 tick = 100ms（状态机更精准、扫掠连线呈高速流） */
const TICK_INTERVAL_TICKS = 2;
/** 粒子每 N 个 tick 才刷一次（100ms×N）；真身侧粒子降密度、减轻负担 */
const PARTICLE_EVERY = 3;
/** 无人出窍时，自愈扫描降到 1 秒一次（100ms×N）避免空转 */
const IDLE_EVERY = 10;
/** 超出距离容忍倒计时（毫秒） */
const TOLERANCE_MS = 5000;

interface SoulSession {
  /** 进入旁观时的真身（维度/位置/原模式） */
  anchor: SoulAnchor;
  /** 距离/容忍状态机 */
  engine: SoulEngine;
  /** 运行帧计数（驱动扫掠连线相位） */
  run: number;
}

/**
 * 旁观模式核心控制器：
 * - 进出场：记录锚点 → 切换到原生 Spectator；回归 → 还原维度/位置/游戏模式。
 * - 每 100ms 推进一次状态机：距离监控 + 容忍倒计时 + 强制回归。
 * - HUD（actionBar）渲染距离（由绿变红 / 容忍红色倒计时）。
 * - 真身标记粒子 + 灵魂锁链连线粒子。
 */
export class SoulController {
  private config: SpConfig;
  private readonly sessions = new Map<string, SoulSession>();
  private intervalId: number | undefined;
  /** 已提示过粒子失败的玩家 id（避免刷屏） */
  private readonly particleWarned = new Set<string>();
  /** 无人出窍时的低频扫描计数 */
  private idleCounter = 0;

  constructor() {
    // 世界 DP 须在 Phase 4 后读取，构造期先用默认值
    this.config = { enabled: true, maxDistance: DEFAULT_MAX_DISTANCE, showLink: false };
  }

  /** Phase 4 延迟启动：读取持久化配置并启动 tick 循环 */
  start(): void {
    this.config = readConfig();
    if (this.intervalId !== undefined) system.clearRun(this.intervalId);
    this.intervalId = system.runInterval(() => this.tick(), TICK_INTERVAL_TICKS);
  }

  /** 当前配置（拷贝，防外部改） */
  getConfig(): SpConfig {
    return { ...this.config };
  }

  /**
   * 管理员保存配置；若禁用功能则强制所有灵魂回归。
   * @param config - 新配置
   */
  setConfig(config: SpConfig): void {
    this.config = {
      enabled: config.enabled,
      maxDistance: clampMaxDistance(config.maxDistance),
      showLink: !!config.showLink,
    };
    writeConfig(this.config);
    if (!this.config.enabled) {
      this.forceReturnAll("旁观功能已被管理员禁用");
    }
  }

  /** 玩家是否处于灵魂出窍状态 */
  isActive(player: Player): boolean {
    return this.sessions.has(player.id);
  }

  /**
   * /sp:soul 切换：进入旁观或回归本体。
   * 极限模式（world.isHardcore）下禁用——模式切换单向，切成旁观无法切回。
   * @param player - 执行命令的玩家
   * @returns 需要发送给玩家的提示消息；空串表示内部已处理
   */
  toggle(player: Player): string {
    const existing = this.sessions.get(player.id);
    if (existing !== undefined) {
      this.returnSoul(player, existing, "手动回归");
      return "";
    }

    // 已是旁观者：有残留锚点（重进未恢复/事件漏触等遗留灵魂）→ 强制回归本体作逃生出口；
    // 无锚点则只是普通旁观者，仅提示不代办。
    if (player.getGameMode() === GameMode.Spectator) {
      const anchor = readSoulAnchor(player);
      if (anchor !== undefined) {
        this.returnToAnchor(player, anchor, "手动回归");
        return "";
      }
      if (!this.config.enabled) {
        return `§c旁观功能未启用，请联系管理员在 §f/${TOGGLE_COMMAND} menu§c 开启`;
      }
      return "§c你已处于旁观模式（非本模组进入，请用游戏提供的方式退出旁观）";
    }

    if (world.isHardcore) {
      return "§c本世界为极限模式：游戏模式切换单向，灵魂出窍已禁用";
    }
    if (!this.config.enabled) {
      return `§c旁观功能未启用，请联系管理员在 §f/${TOGGLE_COMMAND} menu§c 开启`;
    }
    return this.enterSoul(player);
  }

  /**
   * 玩家加入后恢复。加入事件早期 player 对象可能未就绪（location/dimension 为
   * undefined），轮询重试直到能拿到实体（上限 ~4s，tick 自愈兜底不限时），然后：
   * - 极限模式：警告玩家禁用。
   * - 有锚点（以灵魂状态离线）：交给 resumeSoul 恢复（含配置守卫）。
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
        player.sendMessage("§c⚠ 本世界为极限模式：旁观模式（灵魂出窍）已禁用（游戏模式切换单向）。");
      }
      const anchor = readSoulAnchor(player);
      if (anchor) this.resumeSoul(player, anchor);
    };
    tryProcess();
  }

  /** 玩家离开：按 id 清理内存会话（锚点留玩家身上，供重连恢复） */
  onPlayerLeave(playerId: string): void {
    this.sessions.delete(playerId);
  }

  /** 一次性粒子失败提示（避免刷屏） */
  private warnParticleOnce(id: string, e: unknown): void {
    if (this.particleWarned.has(id)) return;
    this.particleWarned.add(id);
    console.warn(`[spectator-mode] particle spawn failed (${id}): ${String(e)}`);
  }

  // ── 私有方法 ──────────────────────────────────────────────

  /**
   * 恢复灵魂出窍会话：保持旁观模式、重建状态机，不移动本体。
   * 玩家可随时用 /sp:soul 手动回归本体。
   * 守卫：极限模式 / 功能被禁用时一律回退"回归本体"。
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
      // 无法切回旁观（如极限模式）→ 退化为回归本体
      this.returnToAnchor(player, anchor, "无法恢复旁观状态");
      return;
    }
    this.sessions.set(player.id, {
      anchor,
      engine: new SoulEngine(TOLERANCE_MS),
      run: 0,
    });
    player.sendMessage(`§a已恢复灵魂出窍状态 · 输入 §f/${TOGGLE_COMMAND}§a 回归本体`);
  }

  /** 进入旁观：记录锚点 → 标记粒子 → 切换到原生 Spectator */
  private enterSoul(player: Player): string {
    const location = player.location;
    const anchor: SoulAnchor = {
      dimensionId: player.dimension.id,
      x: location.x,
      y: location.y,
      z: location.z,
      gameMode: player.getGameMode() as string,
    };

    writeSoulAnchor(player, anchor);
    spawnBodyGlow(player.dimension, location, 24);
    player.setGameMode(GameMode.Spectator);
    this.sessions.set(player.id, {
      anchor,
      engine: new SoulEngine(TOLERANCE_MS),
      run: 0,
    });

    return `§a已进入旁观模式（灵魂出窍）· 输入 §f/${TOGGLE_COMMAND}§r 回归本体`;
  }

  /** 移出会话并回归真身（手动回归 / 容忍耗尽强制） */
  private returnSoul(player: Player, session: SoulSession, reason: string): void {
    this.sessions.delete(player.id);
    this.returnToAnchor(player, session.anchor, reason);
  }

  /** 统一回归：清 HUD/锚点 → 传送回真身 → 还原游戏模式 → 标记粒子 → 提示 */
  private returnToAnchor(player: Player, anchor: SoulAnchor, reason: string): void {
    clearSoulAnchor(player);
    player.onScreenDisplay.setActionBar("");

    const dimension = safeDimension(anchor.dimensionId);
    if (dimension !== undefined) {
      try {
        player.teleport({ x: anchor.x, y: anchor.y, z: anchor.z }, { dimension });
        spawnBodyGlow(dimension, { x: anchor.x, y: anchor.y, z: anchor.z }, 24);
      } catch {
        // 目标维度/位置不可用时跳过传送（至少还原模式）
      }
    }

    try {
      player.setGameMode(anchor.gameMode as GameMode);
    } catch {
      player.setGameMode(GameMode.Survival); // 兜底
    }

    player.sendMessage(`§a${reason}，已回到本体`);
  }

  /** 管理员禁用功能：强制所有在场灵魂回归 */
  private forceReturnAll(reason: string): void {
    const players = allUsablePlayers();
    for (const [id, session] of this.sessions) {
      const player = players.get(id);
      if (!player) continue;
      this.returnSoul(player, session, reason);
    }
  }

  /** 自愈：已是旁观者且有残留锚点未建会话（重进/事件漏触）→ 恢复灵魂出窍（或按守卫回归） */
  private selfHeal(players: Map<string, Player>): void {
    for (const [playerId, player] of players) {
      if (this.sessions.has(playerId)) continue;
      let isSpectator: boolean;
      try {
        isSpectator = player.getGameMode() === GameMode.Spectator;
      } catch {
        continue;
      }
      if (!isSpectator) continue;
      const anchor = readSoulAnchor(player);
      if (anchor) this.resumeSoul(player, anchor);
    }
  }

  /** tick 循环：有人出窍时走全量（状态/容忍/HUD/粒子）；无人时降到低频 1Hz 扫描，避免空转 */
  private tick(): void {
    if (this.sessions.size === 0) {
      this.idleCounter += 1;
      if (this.idleCounter % IDLE_EVERY !== 0) return; // 无人出窍：约 1s 扫一次即可
      this.selfHeal(allUsablePlayers());
      return;
    }
    this.idleCounter = 0;
    const players = allUsablePlayers();
    this.selfHeal(players);

    for (const [id, session] of this.sessions) {
      const player = players.get(id);
      if (!player) continue; // 玩家不在线（防御）

      const anchor = session.anchor;
      const position = player.location;
      const sameDimension = player.dimension.id === anchor.dimensionId;
      const distance = sameDimension
        ? Math.hypot(position.x - anchor.x, position.y - anchor.y, position.z - anchor.z)
        : Infinity; // 跨维度一律视为超限

      const result = session.engine.update(distance, this.config.maxDistance, TICK_INTERVAL_TICKS * 50);

      if (result.forceReturn) {
        this.returnSoul(player, session, "超出距离，容忍倒计时结束");
        continue;
      }

      player.onScreenDisplay.setActionBar(
        buildSoulHud({
          inRange: result.inRange,
          dist: distance,
          maxDistance: this.config.maxDistance,
          remainingMs: result.remainingMs,
        })
      );

      // 视觉：灵魂光环每帧（隔离失败，不影响其他）；真身侧低频且真身未加载则跳过
      session.run++;
      try {
        spawnSoulGlow(player.dimension, position, 2);
      } catch (e) {
        this.warnParticleOnce(id, e);
      }

      if (session.run % PARTICLE_EVERY === 0) {
        const body = { x: anchor.x, y: anchor.y, z: anchor.z };
        if (isPositionLoaded(player.dimension, body)) {
          try {
            spawnBodyGlow(player.dimension, body, 4);
          } catch (e) {
            this.warnParticleOnce(id, e);
          }
          if (this.config.showLink) {
            try {
              spawnTetherLine(player.dimension, body, position, session.run / PARTICLE_EVERY);
            } catch (e) {
              this.warnParticleOnce(id, e);
            }
          }
        }
      }
    }
  }
}

/** 安全获取维度对象；无效 id 返回 undefined */
function safeDimension(dimensionId: string): import("@minecraft/server").Dimension | undefined {
  try {
    return world.getDimension(dimensionId);
  } catch {
    return undefined;
  }
}

/** 位置所在区块是否已加载（未加载时 spawnParticle/方块访问会抛 LocationInUnloadedChunkError） */
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
