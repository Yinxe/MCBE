// ─── 传送请求簿 ─────────────────────────────────────────────────
//
// 每个目标玩家最多持有一条待处理请求。新请求覆盖旧请求,并返回被覆盖的那条,
// 由调用方负责通知旧请求方。请求只存在于内存,不进存档。

import {
  TELEPORT_REQUEST_TIMEOUT_MS,
  type TeleportRequest,
  type TeleportRequestType,
} from "./types";

/** 新建请求的入参(不含 createdAt)。 */
export interface NewTeleportRequest {
  fromId: string;
  fromName: string;
  toId: string;
  type: TeleportRequestType;
}

/** 放入请求的结果。overwritten 是刚刚被顶掉的那条,可能没有。 */
export interface PutRequestResult {
  request: TeleportRequest;
  overwritten?: TeleportRequest;
}

export class TeleportRequestBook {
  /** 目标玩家 ID → 请求 */
  private requests = new Map<string, TeleportRequest>();

  constructor(
    private readonly timeoutMs: number = TELEPORT_REQUEST_TIMEOUT_MS,
  ) {}

  /** 请求有效期,供调用方安排定时清理。 */
  get timeout(): number {
    return this.timeoutMs;
  }

  /**
   * 放入一条新请求。
   *
   * 同一请求方对同一目标的旧请求会被直接替换且不算「被覆盖」——
   * 重复发送不该给请求方自己发「你的请求被覆盖了」的提示。
   */
  put(input: NewTeleportRequest, now: number = Date.now()): PutRequestResult {
    this.cleanExpired(now);

    const previous = this.requests.get(input.toId);
    const request: TeleportRequest = {
      fromId: input.fromId,
      fromName: input.fromName,
      toId: input.toId,
      type: input.type,
      createdAt: now,
    };
    this.requests.set(input.toId, request);

    const overwritten =
      previous && previous.fromId !== input.fromId ? previous : undefined;
    return { request, overwritten };
  }

  /** 取目标玩家的待处理请求,顺手清掉过期的。 */
  get(playerId: string, now: number = Date.now()): TeleportRequest | undefined {
    this.cleanExpired(now);
    return this.requests.get(playerId);
  }

  /** 删除目标玩家的请求,返回被删掉的那条。 */
  remove(playerId: string): TeleportRequest | undefined {
    const request = this.requests.get(playerId);
    this.requests.delete(playerId);
    return request;
  }

  /** 当前条数,供测试与调试使用。 */
  get size(): number {
    return this.requests.size;
  }

  /** 清掉所有过期请求,返回清掉的条数。 */
  cleanExpired(now: number = Date.now()): number {
    let removed = 0;
    const expiredKeys: string[] = [];
    this.requests.forEach((request, key) => {
      if (now - request.createdAt > this.timeoutMs) expiredKeys.push(key);
    });
    for (const key of expiredKeys) {
      this.requests.delete(key);
      removed += 1;
    }
    return removed;
  }
}

/** 判断一条请求是否已过期。 */
export function isRequestExpired(
  request: TeleportRequest,
  now: number,
  timeoutMs: number,
): boolean {
  return now - request.createdAt > timeoutMs;
}
