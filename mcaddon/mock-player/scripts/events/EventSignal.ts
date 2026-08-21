// ─── 事件信号（core 层零依赖实现） ──────────────────────
// 与 @yinxe/toolkit 的 EventSignal 同语义，但保持 core 零依赖：
// toolkit 依赖 @minecraft/server，core 层不能引入（否则无法脱离 mcapi 单测）。
// 订阅/取消订阅/触发 + 订阅者异常隔离（单个订阅者崩溃不影响其他）。

export type EventCallback<T> = (event: T) => void;

export class EventSignal<T> {
  private callbacks = new Set<EventCallback<T>>();

  /** 订阅事件，返回取消订阅函数 */
  subscribe(callback: EventCallback<T>): () => void {
    this.callbacks.add(callback);
    return () => this.unsubscribe(callback);
  }

  unsubscribe(callback: EventCallback<T>): void {
    this.callbacks.delete(callback);
  }

  /** 同步触发事件（快照遍历，订阅者异常隔离） */
  trigger(event: T): void {
    for (const callback of [...this.callbacks]) {
      try {
        callback(event);
      } catch (e) {
        console.warn(`[EventSignal] 订阅者异常: ${e}`);
      }
    }
  }
}
