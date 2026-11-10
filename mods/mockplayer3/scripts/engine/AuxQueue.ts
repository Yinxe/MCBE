// ─── 共享上线辅助常加载队列（FIFO，单一共享区 mpa:aux:shared） ──────
// 申请(tickingarea add circle r=4) → 2t 驻留窗 → 卸载 → 完成事件，用完即释、永不独占。
// 约束：enqueue 不阻塞上线流程；批量上线并发入队、串行执行；成功/失败均触发
// 完成回调，创建失败（含容量上限）只警告不降档、不影响假人在线。
// engine 不 import application：完成出口为可注册监听器，未注册时静默。

import { system } from "@minecraft/server";
import type { Vector3 } from "@minecraft/server";
import { SHARED_AUX_NAME, tickingAreas } from "./TickingAreas";

export interface AuxRequest {
  botId: number;
  botName: string;
  ownerKey: string | null;
  location: Vector3;
  dimensionId: string;
  /** 圆档半径（区块，模拟4/6/8，来自配置 auxTickingRadius） */
  radius: number;
}

/** 完成回执（dimId/纯数据坐标，实体句柄不出 engine） */
export interface AuxOutcome extends AuxRequest {
  success: boolean;
  reason?: string;
}

type CompletedListener = (e: AuxOutcome) => void;

let onCompleted: CompletedListener | null = null;

/** 装配期注册完成监听（Composition 唯一调用点） */
export function setAuxCompletedListener(fn: CompletedListener): void {
  onCompleted = fn;
}

const queue: AuxRequest[] = [];
let processing = false;

function delayTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(() => resolve(), ticks));
}

/** 入队（非阻塞；调用方上线流程立即返回） */
export function enqueueAux(req: AuxRequest): void {
  queue.push({ ...req, location: { x: req.location.x, y: req.location.y, z: req.location.z } });
  if (!processing) void processQueue();
}

/** 当前排队数（诊断/mp:test 用） */
export function auxQueueLength(): number {
  return queue.length;
}

// ─── 私有：串行处理（申请→2t→卸载→事件→1t 下一位） ──

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const req = queue.shift()!;
      let success = false;
      let reason: string | undefined;
      try {
        const res = tickingAreas.ensureAuxShared(req.dimensionId, req.location, req.radius);
        if (!res.ok) {
          reason = res.reason;
        } else {
          success = true;
          await delayTicks(2); // 2t 驻留窗，等待区块就绪
          tickingAreas.release(SHARED_AUX_NAME, req.dimensionId);
        }
      } catch (e: any) {
        reason = e?.message ?? String(e);
        tickingAreas.release(SHARED_AUX_NAME, req.dimensionId); // 异常配套销毁
      }
      try {
        onCompleted?.({ ...req, success, reason });
      } catch (e: any) {
        console.warn(`[mockplayer3] 辅助完成监听异常 ${req.botName}: ${e?.message ?? e}`);
      }
      await delayTicks(1); // 卸载与下一位之间隔 1t
    }
  } finally {
    processing = false;
    if (queue.length > 0) void processQueue();
  }
}
