// ─── 类型化假人事件总线 ────────────────────────────────────────────
// 事件只作通知、不驱动管线；负载全为纯数据，跨层不传 @minecraft 句柄；
// 订阅方异常隔离，不得瘫痪发布方。

import type { EquipSlotName, WorkMode } from "../domain/Record";
import type { ClaimInfo } from "../engine/Hooks";

/** 下线原因（诊断/通知分级） */
export type OfflineCause = "command" | "death" | "ownerLeave" | "reconnect" | "abnormal";

/** 事件 → 负载形状（唯一真源；新增事件在此登记） */
export interface BotEventMap {
  botOnline: { botId: number; name: string; ownerKey: string | null };
  botOffline: { botId: number; name: string; cause: OfflineCause };
  botDeath: { botId: number; name: string; autoRespawn: boolean };
  botRespawn: { botId: number; name: string };
  /** 自动重生尝试失败（reject=引擎拒绝调用，tail=复活流程后半段失效） */
  botRespawnFailed: { botId: number; name: string; stage: "reject" | "tail"; reason: string };
  botDeleted: { botId: number; name: string };
  botWorkModeChanged: { botId: number; name: string; from: WorkMode; to: WorkMode };
  /** 原子写库存成功回读后发布（供面板刷新） */
  botInventoryChanged: { botId: number; name: string };
  /** 桥原生库存槽位变化（假人限定，只带摘要）；钓鱼战利品收集以本事件优先于快照 diff */
  botSlotChanged: {
    botId: number;
    name: string;
    slot: number;
    item?: { typeId: string; amount: number; enchantments: { id: string; level: number }[] };
  };
  /** 装备槽写入成功回读后发布（无原生事件的补偿领域事件，F-10） */
  botEquipSlotChanged: { botId: number; name: string; slot: EquipSlotName };
  /** 投掷物认主/绑定变化（真人认领时 botId=undefined） */
  botProjectileClaimed: ClaimInfo;
  /** 工具守护换械/收损完成（播报文案已成型） */
  botToolGuardFired: { botId: number; name: string; message: string };
  /** 假人获得状态效果（桥内限定假人实体；劫掠循环的驱动源） */
  botEffectAdded: { botId: number; name: string; typeId: string; amplifier: number };
  /** 共享辅助常加载完成（成功失败均发布；创建失败只警告不影响在线） */
  auxCompleted: {
    botId: number;
    name: string;
    ownerKey: string | null;
    dimId: string;
    location: { x: number; y: number; z: number };
    /** 圆档半径（区块，模拟4/6/8） */
    radius: number;
    success: boolean;
    reason?: string;
  };
}

export type BotEventType = keyof BotEventMap;

type Handler<K extends BotEventType> = (payload: BotEventMap[K]) => void;

export class BotEventBus {
  private readonly handlers = new Map<BotEventType, Set<Handler<BotEventType>>>();

  /** 订阅；@returns 退订函数 */
  on<K extends BotEventType>(type: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const wrapped = handler as Handler<BotEventType>;
    set.add(wrapped);
    return () => {
      set!.delete(wrapped);
    };
  }

  /** 发布（单订阅者抛穿只留日志，不影响其余订阅与发布方） */
  emit<K extends BotEventType>(type: K, payload: BotEventMap[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (e: any) {
        console.error(
          `[mockplayer3] 事件订阅者异常 ${type} bot=${(payload as { botId: number }).botId}: ${e?.message ?? e}`
        );
      }
    }
  }
}
