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
  index.onItemMoved(from, to, "minecraft:stone");
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
    index.restore({
      version: INDEX_VERSION + 1,
      byItem: {},
      containerItems: {},
      singleBindings: {},
      familyContainers: {},
    }),
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

// ── 同族索引（familyContainers）跟随触发点联动 ────────────────────
function familyBox(): InMemoryContainer {
  const c = new InMemoryContainer("mF", "multi", 3);
  c.familyEnabled = true;
  c.setItem(0, new SimpleItemStack("minecraft:white_wool", 5, 64));
  return c;
}

test("ItemIndex: 族桶由内容派生——onContainerChanged 换族则桶迁移", () => {
  const index = new ItemIndex();
  const c = familyBox(); // 白羊毛 → 羊毛族桶
  index.onContainerAdded(c);
  assert.deepEqual(index.lookupFamily("wool"), ["mF"]);
  // 手动改成红石（属于 redstone 族）→ reconcile 重建 → 族桶从 wool 迁到 redstone
  c.setItem(0, new SimpleItemStack("minecraft:redstone", 3, 64));
  index.onContainerChanged(c);
  assert.deepEqual(index.lookupFamily("wool"), []);
  assert.deepEqual(index.lookupFamily("redstone"), ["mF"]);
});

test("ItemIndex: 关闭启族开关 → 从族桶移除（onContainerChanged 重建）", () => {
  const index = new ItemIndex();
  const c = familyBox();
  index.onContainerAdded(c);
  assert.deepEqual(index.lookupFamily("wool"), ["mF"]);
  c.familyEnabled = false;
  index.onContainerChanged(c);
  assert.deepEqual(index.lookupFamily("wool"), []);
});

test("ItemIndex: onContainerRemoved 清理族桶成员资格", () => {
  const index = new ItemIndex();
  const c = familyBox();
  index.onContainerAdded(c);
  assert.deepEqual(index.lookupFamily("wool"), ["mF"]);
  index.onContainerRemoved(c);
  assert.deepEqual(index.lookupFamily("wool"), []);
});

test("ItemIndex: restoreFromEntries 按条目重算族桶（激活加载路径）", () => {
  const index = new ItemIndex();
  const c = familyBox();
  c.setItem(1, new SimpleItemStack("minecraft:white_carpet", 2, 64)); // 地毯族
  const entries = new Map<string, { items: string[]; singleBinding?: string }>([
    [c.id, { items: ["minecraft:white_wool", "minecraft:white_carpet"] }],
  ]);
  assert.equal(index.restoreFromEntries(entries, [c]), true);
  assert.deepEqual(index.lookupFamily("wool"), ["mF"]);
  assert.deepEqual(index.lookupFamily("carpet"), ["mF"]);
});

test("ItemIndex: onItemMoved 路由进启族多物容器 → 增补族桶（同族后续成员感知）", () => {
  const index = new ItemIndex();
  const target = familyBox(); // 已含白羊毛 → 羊毛桶
  index.onContainerAdded(target);
  const input = new InMemoryContainer("in", "input", 3);
  index.onContainerAdded(input);
  // 路由把橙羊毛移动进目标（目标是多物启族容器）→ 族桶幂等
  index.onItemMoved(input, target, "minecraft:orange_wool");
  assert.deepEqual(index.lookupFamily("wool"), ["mF"]);
  // 移动一个不同族物品（红石）进启族容器 → 新增 redstone 桶
  index.onItemMoved(input, target, "minecraft:redstone");
  assert.deepEqual(index.lookupFamily("redstone"), ["mF"]);
});

// ── 通用搜索索引（byItem 含 misc 桶） ────────────────────
test("ItemIndex: lookupSearch 含 misc（全容器通用索引），lookup 路由仍仅 single/multi", () => {
  const index = new ItemIndex();
  const single = new InMemoryContainer("s1", "single", 3);
  single.setItem(0, new SimpleItemStack("minecraft:diamond", 2, 64));
  const multi = new InMemoryContainer("m1", "multi", 3);
  multi.setItem(0, new SimpleItemStack("minecraft:diamond", 3, 64));
  const misc = new InMemoryContainer("x1", "misc", 3);
  misc.setItem(0, new SimpleItemStack("minecraft:diamond", 4, 64));
  index.onContainerAdded(single);
  index.onContainerAdded(multi);
  index.onContainerAdded(misc);
  // 路由只看 single/multi
  assert.deepEqual(index.lookup("minecraft:diamond").single, ["s1"]);
  assert.deepEqual(index.lookup("minecraft:diamond").multi, ["m1"]);
  // 搜索含全部存储容器（含 misc）
  assert.deepEqual(index.lookupSearch("minecraft:diamond").sort(), ["m1", "s1", "x1"]);
});

test("ItemIndex: onContainerRemoved 清 misc 桶（搜索索引同步移除）", () => {
  const index = new ItemIndex();
  const misc = new InMemoryContainer("x1", "misc", 3);
  misc.setItem(0, new SimpleItemStack("minecraft:stone", 2, 64));
  index.onContainerAdded(misc);
  assert.deepEqual(index.lookupSearch("minecraft:stone"), ["x1"]);
  index.onContainerRemoved(misc);
  assert.deepEqual(index.lookupSearch("minecraft:stone"), []);
});
