// ─── 共享常加载队列（单例，全假人排队共用一个常加载区域） ─────
// 设计：所有假人上线后不直接持有常加载，而是异步排队到此队列，
// 队列按 FIFO 依次在各自位置 申请 -> 2t -> 卸载，申请与释放成功后异步触发 auxCompleted 事件通知主人。
// 关键约束：
//   - 上线流程不被阻塞：enqueue 后立即返回，上线已成功
//   - 单一共享名 mockplayer:aux:shared，满 49 区块循环复用，用完即释，永不独占
//   - 批量上线时并发入队，串行执行，互不干预
//   - 成功/失败均触发事件，失败不影响 BOT 正常在线
//   - 创建/销毁严格配套：通过 TickingAreaService 统一追踪，指令创建的指令销毁，Manager 创建的 Manager 销毁

import { system, type Dimension, type Vector3 } from "@minecraft/server";
import { LifecycleEvents } from "../LifecycleEvents";
import { configStore } from "../../bootstrap/context";

const SHARED_AUX_NAME = "mockplayer:aux:shared";

interface AuxRequest {
  botName: string;
  ownerName?: string;
  location: Vector3;
  dimension: Dimension;
  enqueueAt: number;
}

const queue: AuxRequest[] = [];
let processing = false;

function delayTicks(ticks: number): Promise<void> {
  return new Promise(resolve => system.runTimeout(resolve, ticks));
}

/** 入队（非阻塞，调用方 onAfterOnline 直接返回） */
export function enqueueAuxRequest(botName: string, ownerName: string | undefined, location: Vector3, dimension: Dimension): void {
  const radius = (()=>{ try { return configStore.getAuxTickingRadius(); } catch { return 4; } })();
  if (radius === 0) {
    console.info(`[SharedAux] 已关闭(半径0)，跳过 ${botName} 辅助申请`);
    try {
      LifecycleEvents.auxCompleted.trigger({ botName, ownerName, dimension: dimension.id, location, success: false, reason: "辅助已关闭(半径0)", fallback: false });
    } catch {}
    return;
  }
  queue.push({ botName, ownerName, location: { ...location }, dimension, enqueueAt: Date.now() });
  console.info(`[SharedAux] 入队 ${botName} @ ${dimension.id} ${Math.floor(location.x)},${Math.floor(location.z)} r=${radius} 队列长度=${queue.length}`);
  if (!processing) void processQueue();
}

/** 串行处理队列（单线程，逐个申请→采样→卸载→事件） */
async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const req = queue.shift()!;
      const waitMs = Date.now() - req.enqueueAt;
      if (waitMs > 1000) console.info(`[SharedAux] 处理排队 ${req.botName} 等待${waitMs}ms`);

      let success = false;
      let reason: string | undefined;
      let fallback = false;

      try {
        const { createCircleWithFallback, removeTickingArea } = await import("../../features/manage/tickingArea/TickingAreaService");
        const radius = (()=>{ try { return configStore.getAuxTickingRadius(); } catch { return 4; } })();
        if (radius === 0) {
          success = false; reason = "辅助已关闭";
          console.info(`[SharedAux] 跳过 ${req.botName} 半径0`);
        } else {
          const res = await createCircleWithFallback(req.location, req.dimension, SHARED_AUX_NAME, radius);
          if (!res.ok) {
            success = false;
            reason = (res as any).reason ?? "未知原因";
            console.warn(`[SharedAux] 申请失败 ${req.botName}: ${reason}`);
          } else {
            success = true;
            fallback = !!(res as any).fallback;
            console.info(`[SharedAux] 申请成功 ${req.botName} @ ${req.dimension.id} ${Math.floor(req.location.x)},${Math.floor(req.location.z)} ${fallback ? "(回退单区块)" : "(Sim4 r=4)"} via ${(res as any).kind}`);
            await delayTicks(2);
            try {
              const rm = await removeTickingArea(SHARED_AUX_NAME, req.dimension);
              if ((rm as any).ok) console.info(`[SharedAux] 已释放 ${SHARED_AUX_NAME} for ${req.botName} via配套销毁`);
              else console.warn(`[SharedAux] 释放异常 ${req.botName}: ${(rm as any).reason}`);
            } catch (e: any) {
              const err = e as any;
              console.warn(`[SharedAux] 释放异常 ${req.botName}: ${err?.message ?? String(err)}`);
            }
          }
        }
      } catch (e: any) {
        const err = e as any;
        success = false;
        reason = err?.message ?? String(err);
        console.warn(`[SharedAux] 处理异常 ${req.botName}: ${reason}`);
        try {
          const { removeTickingArea } = await import("../../features/manage/tickingArea/TickingAreaService");
          await removeTickingArea(SHARED_AUX_NAME, req.dimension).catch(()=>{});
        } catch {}
      }

      try {
        LifecycleEvents.auxCompleted.trigger({
          botName: req.botName,
          ownerName: req.ownerName,
          dimension: req.dimension.id,
          location: req.location,
          success,
          reason,
          fallback,
        });
      } catch (e: any) {
        const err = e as any;
        console.warn(`[SharedAux] 事件触发失败 ${req.botName}: ${err?.message ?? String(err)}`);
      }

      await delayTicks(1);
    }
  } finally {
    processing = false;
    if (queue.length > 0) void processQueue();
  }
}

/** 供测试/诊断：当前队列长度 */
export function getQueueLength(): number { return queue.length; }
/** 供测试：是否正在处理 */
export function isProcessing(): boolean { return processing; }
/** 清空队列（仅测试用） */
export function clearQueue(): void { queue.length = 0; }
