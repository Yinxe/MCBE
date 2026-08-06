import { test } from "node:test";
import assert from "node:assert/strict";
import { ItemIndex, INDEX_VERSION } from "../scripts/core/index/ItemIndex";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";

function stoneMulti() {
  const c = new InMemoryContainer("m1", "multi", 3);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  return c;
}

test("ItemIndex: onContainerAdded 后 lookup O(1) 命中", () => {
  const index = new ItemIndex();
  index.onContainerAdded(stoneMulti());
  const got = index.lookup("minecraft:stone");
  assert.deepEqual(got.multi, ["m1"]);
  assert.deepEqual(index.lookup("minecraft:dirt"), { single: [], multi: [] });
});

test("ItemIndex: 单物容器绑定由 deriveBinding 推导并缓存", () => {
  const index = new ItemIndex();
  const single = new InMemoryContainer("s1", "single", 3);
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  index.onContainerAdded(single);
  assert.deepEqual(index.lookup("minecraft:stone").single, ["s1"]);
  assert.equal(index.getBinding("s1"), "minecraft:stone");
});

test("ItemIndex: onContainerRoleChanged 迁移条目", () => {
  const index = new ItemIndex();
  const c = stoneMulti();
  index.onContainerAdded(c);
  c.role = "single"; // 槽内 stone 变为绑定
  index.onContainerRoleChanged(c, "multi");
  assert.deepEqual(index.lookup("minecraft:stone").multi, []);
  assert.deepEqual(index.lookup("minecraft:stone").single, ["m1"]);
});

test("ItemIndex: onContainerRemoved 清理全部条目", () => {
  const index = new ItemIndex();
  const c = stoneMulti();
  index.onContainerAdded(c);
  index.onContainerRemoved(c);
  assert.deepEqual(index.lookup("minecraft:stone"), { single: [], multi: [] });
});

test("ItemIndex: reconcile 容器实际为空 → 移除全部条目", () => {
  const index = new ItemIndex();
  const c = stoneMulti();
  index.onContainerAdded(c);
  c.setItem(0, undefined); // 玩家手动清空（无事件）
  index.reconcile(c); // 按真实内容重建：空 → 条目清空
  assert.deepEqual(index.lookup("minecraft:stone").multi, []);
});

test("ItemIndex: reconcile 单物绑定漂移 → 修复", () => {
  const index = new ItemIndex();
  const single = new InMemoryContainer("s1", "single", 3);
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  index.onContainerAdded(single);
  single.setItem(0, new SimpleItemStack("minecraft:dirt", 5, 64)); // 首槽被替换
  index.reconcile(single); // 绑定修复（stone 已无 → 移除；dirt 加入）
  assert.deepEqual(index.lookup("minecraft:stone").single, []);
  assert.deepEqual(index.lookup("minecraft:dirt").single, ["s1"]);
  assert.equal(index.getBinding("s1"), "minecraft:dirt");
});

test("ItemIndex: onItemMoved 轻量更新目标侧", () => {
  const index = new ItemIndex();
  const from = new InMemoryContainer("in", "input", 3);
  from.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const to = stoneMulti();
  index.onContainerAdded(from);
  index.onContainerAdded(to);
  index.onItemMoved(from.id, to.id, "minecraft:stone");
  assert.deepEqual(index.lookup("minecraft:stone").multi, ["m1"]);
});

test("ItemIndex: serialize/restore 往返一致", () => {
  const index = new ItemIndex();
  const c = stoneMulti();
  const single = new InMemoryContainer("s1", "single", 3);
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  index.onContainerAdded(c);
  index.onContainerAdded(single);
  const snapshot = index.serialize();
  const index2 = new ItemIndex();
  assert.equal(index2.restore(snapshot), true);
  assert.deepEqual(index2.lookup("minecraft:stone"), { single: ["s1"], multi: ["m1"] });
});

test("ItemIndex: restore 版本不匹配返回 false", () => {
  const index = new ItemIndex();
  assert.equal(
    index.restore({ version: INDEX_VERSION + 1, byItem: {}, containerItems: {}, singleBindings: {} }),
    false
  );
});

test("ItemIndex: selfHeal 扫描存储容器找 hasItem 并重建条目（漏索引兜底）", () => {
  const index = new ItemIndex();
  const m1 = new InMemoryContainer("m1", "multi", 4);
  m1.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  index.onContainerAdded(m1); // 索引只记录 stone
  // 用户手动放入 diamond（无交互信号 → 索引不知情）
  m1.setItem(1, new SimpleItemStack("minecraft:diamond", 2, 64));
  assert.deepEqual(index.lookup("minecraft:diamond"), { single: [], multi: [] }); // miss
  // 自愈：扫描存储容器找 diamond → 重建 m1 条目
  index.selfHeal(new SimpleItemStack("minecraft:diamond", 2, 64), [m1]);
  assert.deepEqual(index.lookup("minecraft:diamond"), { single: [], multi: ["m1"] }); // 自愈命中
  // stone 条目不受影响
  assert.deepEqual(index.lookup("minecraft:stone"), { single: [], multi: ["m1"] });
});

test("ItemIndex: selfHeal 跳过 input/misc 容器（非路由候选）", () => {
  const index = new ItemIndex();
  const input = new InMemoryContainer("in", "input", 4);
  input.setItem(0, new SimpleItemStack("minecraft:diamond", 2, 64));
  const misc = new InMemoryContainer("mx", "misc", 4);
  misc.setItem(0, new SimpleItemStack("minecraft:diamond", 2, 64));
  index.onContainerAdded(input);
  index.onContainerAdded(misc);
  index.selfHeal(new SimpleItemStack("minecraft:diamond", 2, 64), [input, misc]);
  assert.deepEqual(index.lookup("minecraft:diamond"), { single: [], multi: [] }); // 都跳过
});
