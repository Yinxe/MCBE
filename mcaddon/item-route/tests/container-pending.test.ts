// 待补容器重载决策（core/scheduling/RegistryReconcile.decidePendingAction 纯函数）：
// skip=区块未加载(保留下轮) / remove=已加载且空气**或非受支持容器类型**(真拆/替换) /
// register=已加载、非空气、受支持容器类型(补注册)。
// 这是"容器被跳过注册 → 主循环补注册"简单方案的决策核心，零 MC 依赖可单测。
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePendingAction } from "../scripts/core/scheduling/RegistryReconcile";

test("decidePendingAction: block 读不到(区块未加载) → skip 保留待补，绝不误删", () => {
  assert.equal(decidePendingAction(undefined), "skip");
});

test("decidePendingAction: 已加载且空气 → remove（容器真被拆）", () => {
  assert.equal(decidePendingAction({ isAir: true, typeId: "minecraft:chest" }), "remove");
});

test("decidePendingAction: 已加载、非空气、受支持容器 → register 补注册", () => {
  assert.equal(decidePendingAction({ isAir: false, typeId: "minecraft:chest" }), "register");
  assert.equal(decidePendingAction({ isAir: false, typeId: "minecraft:barrel" }), "register");
});

test("decidePendingAction: 已加载、非空气、但**非受支持容器**（铁砧/杂物等）→ remove（容器被替换）", () => {
  assert.equal(decidePendingAction({ isAir: false, typeId: "minecraft:anvil" }), "remove");
  assert.equal(decidePendingAction({ isAir: false, typeId: "minecraft:dirt" }), "remove");
  assert.equal(decidePendingAction({ isAir: false, typeId: "minecraft:furnace" }), "remove");
});