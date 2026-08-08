// 菜单信息元素清单（MenuInfo）：纯数据单测。
// 覆盖：默认全开、isMenuInfoOn 缺省值=开、仓库级/容器级数量、key 唯一。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WAREHOUSE_INFO_ITEMS,
  CONTAINER_INFO_ITEMS,
  ALL_MENU_INFO_ITEMS,
  defaultMenuInfo,
  isMenuInfoOn,
  type MenuInfoKey,
  type ContainerInfoKey,
} from "../scripts/core/data/MenuInfo";

test("MenuInfo: 仓库级/容器级元素非空且默认全开", () => {
  assert.ok(WAREHOUSE_INFO_ITEMS.length > 0);
  assert.ok(CONTAINER_INFO_ITEMS.length > 0);
  const def = defaultMenuInfo();
  for (const item of ALL_MENU_INFO_ITEMS) assert.equal(def[item.key], true, `${item.key} 默认应为开`);
});

test("MenuInfo: isMenuInfoOn 缺省（undefined）→ 默认开（兼容旧档）", () => {
  assert.equal(isMenuInfoOn(undefined, "warehouseId"), true);
  assert.equal(isMenuInfoOn(undefined, "containerFamilyRank"), true);
  const m: Record<string, boolean> = { warehouseId: false };
  assert.equal(isMenuInfoOn(m, "warehouseId"), false);
  assert.equal(isMenuInfoOn(m, "containerCapacity"), true); // 未写 → 仍开
});

test("MenuInfo: key 唯一（仓库级/容器级各自无重复，可作开关键）", () => {
  const wh = WAREHOUSE_INFO_ITEMS.map((i) => i.key);
  const ct = CONTAINER_INFO_ITEMS.map((i) => i.key);
  assert.equal(new Set(wh).size, wh.length);
  assert.equal(new Set(ct).size, ct.length);
  assert.equal(new Set([...wh, ...ct]).size, wh.length + ct.length, "两组 key 不应互相重合");
});

test("MenuInfo: 默认 map 覆盖全部元素 key", () => {
  const def = defaultMenuInfo();
  for (const item of ALL_MENU_INFO_ITEMS) assert.ok(item.key in def);
});