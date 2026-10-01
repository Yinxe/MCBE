// ─── 取消令牌（domain 纯逻辑） ────────────────────────────────────
// 长协程（破坏/导航/钓鱼流程）的取消原语：轮询 cancelled + signal 事件唤醒。
// 可传递/可组合，一次性令牌。

/** 取消令牌：cancel 幂等，signal resolve 后不可重置 */
export class CancelToken {
  private _cancelled = false;
  private _resolveSignal!: () => void;

  /** cancel 时 resolve；协程用 Promise.race([等待, token.signal]) 即醒 */
  readonly signal: Promise<void>;

  constructor() {
    this.signal = new Promise<void>((resolve) => {
      this._resolveSignal = resolve;
    });
  }

  /** 是否已取消（检测点轮询用） */
  get cancelled(): boolean {
    return this._cancelled;
  }

  /** 取消（幂等：多次调用仅首次生效） */
  cancel(): void {
    if (this._cancelled) return;
    this._cancelled = true;
    this._resolveSignal();
  }
}
