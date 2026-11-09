// ─── 绑定到 system.run 的执行助手 ────────────────────────────────
//
// 这是模组侧唯一应当引用的入口。核心逻辑在 runSafeCore.ts(可单测),
// 本文件只负责把 system.run 注入进去。

import { system } from "@minecraft/server";
import { createRunSafe, type ErrorHandler } from "./runSafeCore";

const helpers = createRunSafe((callback) => system.run(callback));

/**
 * 把回调推迟到安全上下文执行,并把结果交给调用方。
 *
 * @returns 回调成功时 resolve,同步抛错或返回的 Promise 被拒绝时 reject
 */
export const runSafe = helpers.runSafe;

/**
 * 把回调推迟到安全上下文执行,不返回 Promise。
 *
 * 用于命令注册回调这类无法 await 的位置:错误交给 `onError`,未提供时
 * 写入 console.warn,因此不会变成 unhandled rejection。
 */
export const runSafeDetached = helpers.runSafeDetached;

export type { ErrorHandler };
