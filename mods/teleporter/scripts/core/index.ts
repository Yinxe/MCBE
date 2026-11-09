// ─── core 层对外入口 ────────────────────────────────────────────
//
// 本目录只放纯逻辑:不 import @minecraft/*,不读写存档,不碰界面。
// 因此 tests/tsconfig.json 可以把 core 与 tests 一起编译到 Node 上直接跑。

export * from "./types";
export * from "./config";
export * from "./waypoints";
export * from "./deathPoints";
export * from "./requests";
export * from "./naming";
export * from "./token";
