// ─── 自定义事件订阅触发机制 ──────────────────────────────
// 参考 MCBE 原生事件机制（world.afterEvents.xxx.subscribe / unsubscribe），
// 为 addon 内部模块间解耦通信提供纯自定义事件：
//   - 每个事件独立定义（一个 interface = 事件属性），各自持有独立 signal 实例
//   - 三个操作：subscribe（订阅）/ unsubscribe（取消订阅）/ trigger（触发）
//   - CancelableEventSignal：订阅者可置 event.cancel = true 取消本次触发
// 不依赖 @minecraft/server，可在 node 环境直接编译测试。

type EventCallback<T> = (event: T) => void;

/**
 * 普通事件信号：仅通知，订阅者不可取消。
 * 同一回调重复订阅只注册一次；订阅者异常不影响其他订阅者；
 * 回调中 subscribe / unsubscribe 安全（快照遍历）。
 */
export class EventSignal<T> {
  private callbacks = new Set<EventCallback<T>>();

  /** 订阅事件；同一回调重复订阅只注册一次 */
  subscribe(callback: EventCallback<T>): void {
    this.callbacks.add(callback);
  }

  /** 取消订阅；未注册的回调静默忽略 */
  unsubscribe(callback: EventCallback<T>): void {
    this.callbacks.delete(callback);
  }

  /** 同步触发事件，派发给所有订阅者；无订阅者时安全空操作 */
  trigger(event: T): void {
    // 快照遍历：回调中 subscribe / unsubscribe 不影响本次派发
    for (const callback of [...this.callbacks]) {
      try {
        callback(event);
      } catch (e) {
        console.warn("[events] 订阅者回调异常:", e);
      }
    }
  }
}

/** 可取消事件的派发对象：事件属性 + cancel 标志 */
export type CancelableEvent<T> = T & { cancel: boolean };

/**
 * 可取消事件信号：订阅者可置 event.cancel = true 取消本次触发。
 * 所有订阅者都会收到事件（忠实 MCBE beforeEvents 语义），
 * trigger 返回本次触发是否被取消（false = 已取消）。
 */
export class CancelableEventSignal<T> {
  private callbacks = new Set<EventCallback<CancelableEvent<T>>>();

  /** 订阅事件；同一回调重复订阅只注册一次 */
  subscribe(callback: EventCallback<CancelableEvent<T>>): void {
    this.callbacks.add(callback);
  }

  /** 取消订阅；未注册的回调静默忽略 */
  unsubscribe(callback: EventCallback<CancelableEvent<T>>): void {
    this.callbacks.delete(callback);
  }

  /**
   * 同步触发事件。内部构造浅拷贝 { ...event, cancel: false } 派发，
   * 不污染原始数据；任一订阅者置 cancel = true 则返回 false。
   */
  trigger(event: T): boolean {
    const cancelable: CancelableEvent<T> = { ...event, cancel: false };
    for (const callback of [...this.callbacks]) {
      try {
        callback(cancelable);
      } catch (e) {
        console.warn("[events] 订阅者回调异常:", e);
      }
    }
    return !cancelable.cancel;
  }
}