// ─── 事件订阅触发机制（core 自实现，与 @yinxe/toolkit 同语义） ──
// 保持 core 零依赖：mc 适配层可自由选择复用 toolkit 版本。
type EventCallback<T> = (event: T) => void;

/**
 * 普通事件信号：仅通知，订阅者不可取消。
 * 同一回调重复订阅只注册一次；订阅者异常不影响其他订阅者。
 */
export class EventSignal<T> {
  private callbacks = new Set<EventCallback<T>>();

  subscribe(callback: EventCallback<T>): void {
    this.callbacks.add(callback);
  }

  unsubscribe(callback: EventCallback<T>): void {
    this.callbacks.delete(callback);
  }

  /** 同步触发；回调中 subscribe/unsubscribe 不影响本次派发（快照遍历） */
  trigger(event: T): void {
    for (const callback of [...this.callbacks]) {
      try {
        callback(event);
      } catch (e) {
        console.warn("[item-route/events] 订阅者回调异常:", e);
      }
    }
  }
}
