// ─── 游戏脚本运行时全局（QuickJS 注入，非 Node 环境） ───
declare var console: {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
