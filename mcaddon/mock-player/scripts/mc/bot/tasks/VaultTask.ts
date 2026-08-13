// ─── 任务：宝库开箱循环（mc/bot/tasks） ───────────────
// 宝库模式 = 基于事件的持续交互循环（用户规格 1.3.10）：
//   scan      搜索半径 15 内最近的宝库（getBlocks 一次查询 + 距离排序）；
//             没找到 → 节流提示 + 定期重扫
//   navigate  持续看向宝库中心 + 一次性下发导航到宝库旁可站立点（绝不重复
//             下发——重复会重置路径把假人钉死）；每 tick 只算距离 + 停滞
//             判定；**距离 < 2 且视线命中的方块也是宝库** → 进入交互
//   interact  识别宝库类型（block state ominous：普通/不详）→ 按类型选候选
//             钥匙（普通=trial_key 优先+不详兜底 / 不详=仅不详钥匙）→
//             ensureMainhand 换到主手 → interactWithBlock → 记录钥匙总量
//             基准 → 进入等待
//   wait      纯事件驱动（无轮询）：钥匙槽 -1 且 -1 后非空 + 总量低于基准
//             → 判定交互成功（vaultFlow 事件订阅调 handle.success()）→
//             任务完成 → vaultFlow 通知附近玩家 + 安全重连 → 重新开任务
//
// ⚠️ 交互成功判定（用户拍板）：不是所有钥匙变化都是交互成功——
//    只考虑「数量被 -1 了」且「-1 后不是空手」+ 交互基准（总量减少），
//    换钥匙/槽间移动/手动拿走绝不误判。
// ⚠️ 不判断宝库是否开过：重连后是新实体，同一宝库可重复开直到钥匙用完。

import { BlockVolume, Vector3 } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import { findStandSpot, isArrived, nearestPoint } from "../../../core/bot/Navigation";
import type { BotTask } from "../../../core/bot/Engine";
import type { MockBot } from "../MockBot";

/** 宝库方块 ID（普通/不详共用同一方块，block state ominous 区分） */
const VAULT_BLOCK = "minecraft:vault";
/** 宝库扫描半径（格，以假人为中心的正方体半边长；用户规格 15） */
const SCAN_RADIUS = 15;
/** 扫描重试间隔（tick）：没找到宝库时定期重扫 */
const SCAN_RETRY_TICK = 40;
/** 到达判定距离（格）：假人可靠近宝库且 r < 2 */
const ARRIVE_DIST = 2;
/** 导航停滞判定（tick）：距离连续无进展超过该时长（≈10 秒）→ 放弃重扫 */
const STALL_TICKS = 200;
/** 交互重试间隔（tick）：无钥匙/交互失败时定期重试 */
const INTERACT_RETRY_TICK = 20;
/** 视线命中判定最大距离（格） */
const VIEW_MAX_DIST = 6;

/** 钥匙类型（宝库类型识别后按优先级选） */
const KEY_CANDIDATES: Record<"normal" | "ominous", string[]> = {
  normal: ["minecraft:trial_key", "minecraft:ominous_trial_key"],
  ominous: ["minecraft:ominous_trial_key"],
};

/** 钥匙中文名（提示用） */
const KEY_LABELS: Record<string, string> = {
  "minecraft:trial_key": "普通钥匙",
  "minecraft:ominous_trial_key": "不详钥匙",
};

/** 任务阶段 */
type VaultPhase = "scan" | "navigate" | "interact" | "wait";

/** 任务句柄（vaultFlow 事件订阅与任务状态互操作） */
export interface VaultTaskHandle {
  /** 标记交互成功（事件判定调用 → 任务 isDone） */
  success(): void;
  /** 交互时的钥匙总量基准（事件判定读） */
  baseline: number | undefined;
  /** 交互时主手钥匙类型（事件负载用） */
  keyType: string;
  /** 目标宝库坐标（日志/通知用） */
  target: Vector3 | undefined;
}

/** 宝库任务选项 */
export interface VaultTaskOptions {
  /** 节流通知回调（没找到宝库/没有钥匙等；由 vaultFlow 注入，默认空） */
  onNotify?: (message: string) => void;
}

/**
 * 宝库开箱循环任务（scan → navigate → interact → wait 事件驱动）。
 * @returns 任务 + 句柄（vaultFlow 用句柄做事件判定与成功标记）
 */
export function vaultTask(bot: MockBot, opts: VaultTaskOptions = {}): { task: BotTask; handle: VaultTaskHandle } {
  let phase: VaultPhase = "scan";
  let successFlag = false;
  let elapsed = 0;
  let scanCounter = 0;
  let interactCounter = 0;
  let stallCount = 0;
  let lastDist = Infinity;
  let navTarget: Vector3 | undefined; // 站立点（导航目标）
  let vaultPos: Vector3 | undefined; // 宝库坐标（看向/交互）

  const handle: VaultTaskHandle = {
    success: (): void => {
      successFlag = true;
    },
    baseline: undefined,
    keyType: "",
    target: undefined,
  };

  /** 钥匙总量（背包+主手，事件判定基准） */
  const countKeyTotal = (): number =>
    bot.countItem("minecraft:trial_key") + bot.countItem("minecraft:ominous_trial_key");

  /** 节流通知（任务自身 20 tick 一次；vaultFlow 可注入更精细的节流） */
  const notify = (message: string): void => {
    if (opts.onNotify) opts.onNotify(message);
  };

  const task: BotTask = {
    id: "vault",
    tick: (): void => {
      elapsed++;
      switch (phase) {
        case "scan":
          scanCounter++;
          // 每 SCAN_RETRY_TICK tick 扫描一次（避免每 tick getBlocks）
          if (scanCounter % SCAN_RETRY_TICK !== 0) return;
          scan();
          break;

        case "navigate":
          navigateTick();
          break;

        case "interact":
          interactCounter++;
          if (interactCounter % INTERACT_RETRY_TICK !== 0) return;
          interact();
          break;

        case "wait":
          // 纯事件驱动：钥匙消耗判定由 vaultFlow 的 playerInventoryItemChange
          // 订阅完成（handle.success() 标记后任务完成）
          break;
      }
    },
    isDone: (): boolean => successFlag,
    cancel: (): void => {
      bot.stopNavigation();
    },
  };

  // ── 阶段实现 ────────────────────────────────────────

  /** scan：搜索半径 15 内最近的宝库 → 找到则进入导航 */
  function scan(): void {
    const sim = bot.getEntity();
    if (!sim) return;
    const found = scanNearestVault(sim);
    if (!found) {
      notify("附近 15 格内没有宝库，请将假人带到宝库附近");
      return; // 继续定期重扫
    }
    // 找宝库旁 1~2 格可站立点（宝库方块本身人走不进去）
    const standSpot = findStandSpotNear(sim, found);
    if (!standSpot) {
      notify("宝库周围没有可站立的位置，请调整假人位置");
      return;
    }
    vaultPos = found;
    navTarget = { x: standSpot.x + 0.5, y: standSpot.y, z: standSpot.z + 0.5 };
    handle.target = found;
    stallCount = 0;
    lastDist = Infinity;
    phase = "navigate";
    // 一次性下发导航（持续导航，绝不重复下发）
    try {
      sim.stopMoving();
      sim.navigateToLocation(navTarget, 1);
    } catch {
      // 导航启动失败：回 scan 重扫
      phase = "scan";
      return;
    }
    console.info(`[MockPlayer] 宝库 ${bot.name} 找到最近宝库 @(${found.x},${found.y},${found.z})，开始导航`);
  }

  /** navigate：持续看向宝库 + 只算距离；r<2 且视线命中宝库 → 交互 */
  function navigateTick(): void {
    const sim = bot.getEntity();
    if (!sim || !vaultPos || !navTarget) {
      phase = "scan";
      return;
    }
    // 持续看向宝库中心（chunkload 降级忽略）
    try {
      sim.lookAt({ x: vaultPos.x + 0.5, y: vaultPos.y + 0.5, z: vaultPos.z + 0.5 });
    } catch {
      /* 降级：交互用 interactWithBlock 直接指定位置 */
    }

    // 距离判定（站立点）；停滞判定：距离无进展累计 STALL_TICKS → 放弃重扫
    const dist = Math.sqrt(
      (sim.location.x - navTarget.x) ** 2 +
      (sim.location.y - navTarget.y) ** 2 +
      (sim.location.z - navTarget.z) ** 2,
    );
    if (dist >= lastDist) {
      stallCount++;
      if (stallCount >= STALL_TICKS) {
        console.info(`[MockPlayer] 宝库 ${bot.name} 导航停滞，重扫`);
        phase = "scan";
        return;
      }
    } else {
      stallCount = 0;
    }
    lastDist = dist;

    // 可靠近宝库（r<2）且视线命中的方块也是宝库 → 进入交互
    if (isArrived(dist, ARRIVE_DIST) && lookingAtVault(sim)) {
      try {
        sim.stopMoving();
      } catch {
        /* ignore */
      }
      console.info(`[MockPlayer] 宝库 ${bot.name} 已靠近宝库且视线命中，开始交互`);
      phase = "interact";
      interactCounter = 0;
    }
  }

  /** interact：识别宝库类型 → 按类型换钥匙 → 交互 → 记录基准 → 等待 */
  function interact(): void {
    const sim = bot.getEntity();
    if (!sim || !vaultPos) {
      phase = "scan";
      return;
    }

    // 识别宝库类型（普通/不详：block state ominous）
    const block = sim.dimension.getBlock(vaultPos);
    if (!block) {
      phase = "scan";
      return;
    }
    const ominous = block.permutation.getState("ominous") as boolean | undefined;
    const candidates = ominous ? KEY_CANDIDATES.ominous : KEY_CANDIDATES.normal;
    const vaultKind = ominous ? "不详宝库" : "普通宝库";
    console.info(`[MockPlayer] 宝库 ${bot.name} 识别为${vaultKind}，候选钥匙 ${candidates.map((c) => KEY_LABELS[c]).join("/")}`);

    // 按优先级确保主手是候选钥匙（没有 → 节流提示等待玩家放入）
    const keyType = bot.ensureMainhand(candidates);
    if (!keyType) {
      const missing = candidates.length > 1 ? "普通钥匙或不详钥匙" : "不详钥匙";
      notify(`手上没有${missing}，请放入背包后重试`);
      return; // 每 INTERACT_RETRY_TICK 重试换钥匙
    }

    // 交互一次（看向后视线命中面，Down 兜底）
    const ok = bot.interactWithBlock(vaultPos);
    if (!ok) {
      notify("与宝库交互未成功，请调整假人位置后重试");
      return;
    }

    // 记录钥匙总量基准：此后总量减少且 -1 后非空 → 判定开箱成功（事件驱动）
    handle.baseline = countKeyTotal();
    handle.keyType = keyType;
    console.info(`[MockPlayer] 宝库 ${bot.name} 交互成功，钥匙总量基准=${handle.baseline}（等待消耗事件判定）`);
    phase = "wait";
  }

  // ── 辅助 ────────────────────────────────────────────

  /** 扫描以假人为中心 SCAN_RADIUS 内最近的宝库（getBlocks 一次查询 + 距离排序） */
  function scanNearestVault(sim: SimulatedPlayer): Vector3 | undefined {
    const c = sim.location;
    try {
      const volume = new BlockVolume(
        { x: Math.floor(c.x) - SCAN_RADIUS, y: Math.max(-64, Math.floor(c.y) - SCAN_RADIUS), z: Math.floor(c.z) - SCAN_RADIUS },
        { x: Math.floor(c.x) + SCAN_RADIUS, y: Math.min(320, Math.floor(c.y) + SCAN_RADIUS), z: Math.floor(c.z) + SCAN_RADIUS },
      );
      const found = sim.dimension.getBlocks(volume, { includeTypes: [VAULT_BLOCK] }, false);
      const points: Vector3[] = [];
      for (const pos of found.getBlockLocationIterator()) {
        points.push(pos);
      }
      return nearestPoint(c, points);
    } catch {
      // 维度/区块读取失败（未加载区块等）——等下一次重扫
      return undefined;
    }
  }

  /** 宝库旁 1~2 格可站立点（格内空气 + 下方有支撑） */
  function findStandSpotNear(sim: SimulatedPlayer, vault: Vector3): Vector3 | undefined {
    return findStandSpot(vault, (pos) => {
      try {
        const here = sim.dimension.getBlock(pos);
        const below = sim.dimension.getBlock({ x: pos.x, y: pos.y - 1, z: pos.z });
        if (!here || !below) return false;
        return here.typeId === "minecraft:air" && below.typeId !== "minecraft:air";
      } catch {
        return false;
      }
    });
  }

  /** 视线命中的方块是否就是目标宝库（用户规格：视线命中也是宝库才算可交互） */
  function lookingAtVault(sim: SimulatedPlayer): boolean {
    try {
      const hit = sim.getBlockFromViewDirection({ maxDistance: VIEW_MAX_DIST });
      return !!hit && hit.block.typeId === VAULT_BLOCK;
    } catch {
      return false;
    }
  }

  return { task, handle };
}
