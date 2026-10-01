// ─── @minecraft/* 运行时替身（引擎层单测/仿真专用） ──────────────────
// @minecraft/* 只发 d.ts，node --test require 会 MODULE_NOT_FOUND；
// 本模块装解析钩子把这些裸名解析为自动桩。
// 真实世界观测由 WorldProbe 从测试侧注入，仿真不打桩判据。

import Module from "node:module";

/** 自动桩：任意属性/调用/构造都返回自身（`then` 例外——防 await 挂死；
 *  `Symbol.hasInstance` 例外——否则 `e instanceof 桩类` 恒真，引擎里按错误类型
 *  归因的分支（Scanner 的 UnloadedChunksError 判定）会被全部抹平成同一档） */
const autoStub: any = new Proxy(function () {} as any, {
  get: (_t, prop) =>
    prop === "then" || prop === Symbol.toPrimitive || prop === Symbol.hasInstance ? undefined : autoStub,
  apply: () => autoStub,
  construct: () => autoStub,
  has: () => true,
});

/** 需要打桩的裸模块名（本项目 engine/application 的全部外部运行时依赖） */
const STUBBED: readonly string[] = [
  "@minecraft/server",
  "@minecraft/server-gametest",
  "@minecraft/server-ui",
  "@minecraft/math",
  "@yinxe/toolkit",
];

type ResolveHook = {
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
};

const mod = Module as unknown as ResolveHook;
const originalResolve = mod._resolveFilename;
mod._resolveFilename = function (request: string, ...rest: unknown[]): string {
  if (STUBBED.includes(request)) return request;
  return originalResolve.call(this, request, ...rest);
};

const cache = (require as any).cache as Record<string, unknown>;
for (const request of STUBBED) {
  cache[request] = { id: request, filename: request, loaded: true, exports: autoStub, children: [], paths: [] };
}

export {};
