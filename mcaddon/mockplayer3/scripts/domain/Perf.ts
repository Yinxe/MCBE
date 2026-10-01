// ─── 性能预算（domain） ──
// 单 tick 超过阈值即慢操作：世界读（getBlock/getBlocks/getEntities）与 NBT 读写
// 超过时落一条 console.warn；阈值以下不产生日志。

/** 单 tick 慢操作阈值（ms），超过即视为需要关注的同步世界操作 */
export const SLOW_OP_MS = 50;
