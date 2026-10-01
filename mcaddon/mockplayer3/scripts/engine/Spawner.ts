// ─── 生成器（生成收口：装置中转、名字仲裁、生成后验名） ──────────────
// 生成走 GameTest 装置中转：test 空间 (0,8,0) 生成 → 立即 teleport 目标点并带身体
// 朝向（F-01：生成体旋转逐 tick 锁回，朝向只能靠 teleport 设置）；
// 装置未就绪回退直生，直生后必 teleport 校正一次（F-02）。
// 重名防护（F-03）：生成前等待名字释放（2t 轮询、120 次上限），无主 "(N)" 幽灵
// disconnect 加速释放（真人绝不动手）；生成后校验 bot.name===期望名，不符即销毁
// 重试一次，仍不符放弃——绝不留 "(2)" 实体。

import { GameMode, system, world } from "@minecraft/server";
import type { Vector3 } from "@minecraft/server";
import { spawnSimulatedPlayer } from "@minecraft/server-gametest";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { BOT_MARKER_TAG } from "../domain/Record";
import { asSimulated } from "./Compat";
import { entityGateway } from "./EntityGateway";
import { globalTest } from "./Rig";

/** 装置中转生成点（test 空间内；只能在测试维度生成，finalize 统一传送目标） */
const RIG_SPAWN_POS = { x: 0, y: 8, z: 0 };

/** 名字释放轮询：每 2t 一次、上限 120 次 ≈12s（F-03：disconnect 后名字释放 ≥20t） */
const NAME_POLL_EVERY_TICKS = 2;
const NAME_POLL_LIMIT = 120;

export interface SpawnRequest {
  botId: number;
  name: string;
  position: Vector3;
  dimensionId: string;
  yaw: number;
  pitch: number;
  /** 在线会话实体 id（仲裁时受保护——同名人若是受保护在线假人=名字被占用） */
  protectedEntityIds: ReadonlySet<string>;
}

export type SpawnOutcome = { ok: true; entityId: string } | { ok: false; reason: string };

function delayTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(() => resolve(), ticks));
}

/** 名字占用扫描：真人同名 / 受保护在线假人同名 / 幽灵计数（副作用=清无主幽灵） */
function inspectName(
  name: string,
  protect: ReadonlySet<string>
): { free: boolean; realTaken: boolean; botTaken: boolean } {
  let free = true;
  let realTaken = false;
  let botTaken = false;
  for (const p of entityGateway.nameBlockers(name)) {
    if (protect.has(p.id)) {
      // 受保护实体占用同名：若是精确同名则是"名字被占用"；"(N)" 幽灵形态不护
      if (p.name === name) botTaken = true;
      continue;
    }
    free = false;
    try {
      if (p.hasTag(BOT_MARKER_TAG)) {
        try {
          asSimulated(p)?.disconnect(); // 无主幽灵：强制释放加速
        } catch {
          /* 实体可能刚消失 */
        }
      } else {
        realTaken = true; // 真人同名（改名撞名边缘场景）不可 disconnect，等待超时兜底
      }
    } catch {
      free = false;
    }
  }
  return { free, realTaken, botTaken };
}

export class Spawner {
  /**
   * 名字仲裁：清幽灵 + 等待释放。等待窗耗尽仍放行——扫描有瞬态盲区，
   * 最终裁决权在生成后验名（真占用引擎必加 "(N)"，由 spawn 销毁重试兜底）；
   * 提前失败会把"最后一刻释放"的合法上线永久挡死。
   * @returns ok=可发起生成；失败仅"名字被占用"（受保护在线假人精确同名）
   */
  async arbitrateName(
    name: string,
    protect: ReadonlySet<string>
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    for (let attempt = 0; attempt < NAME_POLL_LIMIT; attempt++) {
      const seen = inspectName(name, protect);
      if (seen.botTaken) return { ok: false, reason: "名字被占用" };
      if (seen.free && !seen.realTaken) return { ok: true };
      await delayTicks(NAME_POLL_EVERY_TICKS);
    }
    return { ok: true }; // 超时强行生成（真人同名干等到此）——验名兜底在 spawn()
  }

  /**
   * 生成 + 验名 + 校正（上线步骤 4/5 合并执行；失败自清现场）。
   * 成功后 entityGateway 已 prime（botId→名字），调用方经网关/EntityOps 触碰实体。
   */
  async spawn(req: SpawnRequest): Promise<SpawnOutcome> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const bot = this.spawnOnce(req);
      if (!bot) return { ok: false, reason: "生成失败（引擎拒绝或维度不可用）" };
      if (bot.name === req.name) {
        this.finalize(bot, req, attempt === 0);
        entityGateway.prime(req.botId, req.name);
        return { ok: true, entityId: bot.id };
      }
      // 引擎加了 "(N)" 后缀：销毁本只，等名字再干净后重试一次
      try {
        bot.disconnect();
      } catch {
        /* ignore */
      }
      const again = await this.arbitrateName(req.name, req.protectedEntityIds);
      if (!again.ok) return { ok: false, reason: "名字仲裁失败" };
    }
    return { ok: false, reason: "名字仲裁失败" };
  }

  // ─── 私有 ──

  /** 单只生成：装置就绪走 test 中转（传送校正交给 finalize），未就绪直生（F-02） */
  private spawnOnce(req: SpawnRequest): SimulatedPlayer | null {
    try {
      const test = globalTest;
      if (test) return test.spawnSimulatedPlayer(RIG_SPAWN_POS, req.name, GameMode.Survival);
      const dim = world.getDimension(req.dimensionId);
      return spawnSimulatedPlayer(
        { x: req.position.x, y: req.position.y, z: req.position.z, dimension: dim },
        req.name,
        GameMode.Survival
      );
    } catch {
      return null;
    }
  }

  /** 统一收尾：teleport 目标点+身体朝向（F-01；直生时也是"必校正"的 F-02 动作）+ 假人标记 */
  private finalize(bot: SimulatedPlayer, req: SpawnRequest, viaRig: boolean): void {
    try {
      bot.teleport(req.position, {
        dimension: world.getDimension(req.dimensionId),
        rotation: { x: req.pitch, y: req.yaw },
      });
    } catch (e: any) {
      console.warn(
        `[mockplayer3] 生成校正传送失败 ${req.name}: ${e?.message ?? e}（${viaRig ? "装置路径" : "直生路径"}）`
      );
    }
    try {
      if (!bot.hasTag(BOT_MARKER_TAG)) bot.addTag(BOT_MARKER_TAG);
    } catch {
      /* 瞬态失效由后续对账兜底 */
    }
  }
}
