import test from "node:test";
import assert from "node:assert/strict";
import { transferIn, transferOut, type TransferPort } from "../src/core/transfer";

/**
 * 内存世界替身：源槽 / 目标槽 / 区域（Map 模拟木桶槽位，nextFree 模拟水印）。
 * 物品用字符串代指（不透明引用），验证的是传输编排的原子语义。
 */
function makeWorld() {
  const state = {
    source: undefined as unknown | undefined,
    dest: undefined as unknown | undefined,
  };
  const region = new Map<number, unknown>();
  let nextFree = 0;
  const port: TransferPort = {
    readSource: () => state.source,
    store: (item) => {
      region.set(nextFree, item);
      return nextFree++;
    },
    take: (slotId) => {
      const item = region.get(slotId);
      region.delete(slotId);
      return item;
    },
    writeDest: (item) => {
      state.dest = item;
      return true;
    },
    clearSource: () => {
      state.source = undefined;
      return true;
    },
  };
  return { state, region, port };
}

test("transferIn：源槽 → 区域成功，源槽清空，返回 slotId", () => {
  const { state, region, port } = makeWorld();
  state.source = "sword";
  const r = transferIn(port);
  assert.deepEqual(r, { ok: true, slotId: 0 });
  assert.equal(state.source, undefined);
  assert.equal(region.get(0), "sword");
});

test("transferIn：源槽为空 → fail empty，无副作用", () => {
  const { state, region, port } = makeWorld();
  const r = transferIn(port);
  assert.deepEqual(r, { ok: false, reason: "empty" });
  assert.equal(state.source, undefined);
  assert.equal(region.size, 0);
});

test("transferIn：区域满 → fail full，源槽保持原样", () => {
  const { state, port } = makeWorld();
  state.source = "sword";
  const fullPort: TransferPort = { ...port, store: () => null };
  const r = transferIn(fullPort);
  assert.deepEqual(r, { ok: false, reason: "full" });
  assert.equal(state.source, "sword"); // 未动源槽
});

test("transferIn：清空源槽失败 → 回滚，源槽还原、区域槽释放", () => {
  const state = { source: "sword" as unknown | undefined };
  let stored: unknown | undefined;
  let taken = 0;
  const port: TransferPort = {
    readSource: () => state.source,
    store: (item) => {
      stored = item;
      return 7;
    },
    take: (slotId) => {
      assert.equal(slotId, 7);
      taken += 1;
      const s = stored;
      stored = undefined;
      return s;
    },
    writeDest: (item) => {
      state.source = item;
      return true;
    },
    clearSource: () => false, // 模拟清空失败
  };
  const r = transferIn(port);
  assert.deepEqual(r, { ok: false, reason: "io" });
  assert.equal(state.source, "sword"); // 源槽还原
  assert.equal(stored, undefined); // 区域槽已释放
  assert.equal(taken, 1);
});

test("transferIn：清空失败且还原也失败 → 物品重存区域，不丢失", () => {
  const state = { source: "sword" as unknown | undefined };
  let stored: unknown | undefined;
  let storeCalls = 0;
  const port: TransferPort = {
    readSource: () => state.source,
    store: (item) => {
      storeCalls += 1;
      stored = item;
      return 7 + storeCalls;
    },
    take: () => {
      const s = stored;
      stored = undefined;
      return s;
    },
    writeDest: () => false, // 源槽写不回
    clearSource: () => false,
  };
  const r = transferIn(port);
  assert.deepEqual(r, { ok: false, reason: "io" });
  assert.equal(storeCalls, 2); // 首次存入 + 回滚重存
  assert.equal(stored, "sword"); // 物品留在区域
});

test("transferOut：目标写入成功，物品到达目标槽、区域槽回收", () => {
  const { state, region, port } = makeWorld();
  region.set(3, "bow");
  const r = transferOut(port, 3);
  assert.deepEqual(r, { ok: true });
  assert.equal(state.dest, "bow");
  assert.equal(region.get(3), undefined);
});

test("transferOut：区域槽空 → fail empty", () => {
  const { port } = makeWorld();
  const r = transferOut(port, 5);
  assert.deepEqual(r, { ok: false, reason: "empty" });
});

test("transferOut：目标写入失败 → 回滚重存区域，返回新 slotId，物品不丢", () => {
  const { region } = makeWorld();
  region.set(0, "bow");
  let storeCalls = 0;
  const port: TransferPort = {
    readSource: () => undefined,
    store: (item) => {
      storeCalls += 1;
      region.set(10, item); // 重存到新槽
      return 10;
    },
    take: (slotId) => {
      const item = region.get(slotId);
      region.delete(slotId);
      return item;
    },
    writeDest: () => false, // 目标写失败
    clearSource: () => true,
  };
  const r = transferOut(port, 0);
  assert.deepEqual(r, { ok: false, slotId: 10, reason: "io" });
  assert.equal(region.get(10), "bow"); // 物品仍在区域
  assert.equal(region.get(0), undefined);
  assert.equal(storeCalls, 1);
});
