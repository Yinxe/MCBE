// ─── 传送信物判定的单元测试 ─────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTeleportToken,
  TOKEN_LORE,
  TOKEN_TYPE_ID,
} from "../scripts/core/token";

test("普通指南针不是信物", () => {
  assert.equal(
    isTeleportToken({ typeId: "minecraft:compass", lore: [] }),
    false,
  );
});

test("带标记行的磁石指针是信物", () => {
  assert.equal(
    isTeleportToken({ typeId: TOKEN_TYPE_ID, lore: [TOKEN_LORE] }),
    true,
  );
});

test("标记行之外还有别的描述行时仍可识别", () => {
  assert.equal(
    isTeleportToken({
      typeId: TOKEN_TYPE_ID,
      lore: ["§7第一行", TOKEN_LORE, "§7第三行"],
    }),
    true,
  );
});

test("类型不对时即使描述相同也不是信物", () => {
  assert.equal(
    isTeleportToken({ typeId: "minecraft:map", lore: [TOKEN_LORE] }),
    false,
  );
});

test("旧的纸信物不再被识别", () => {
  // 迁移:改版前发出去的是纸做的信物,现在必须失效,
  // 否则老存档里会留下两套入口
  assert.equal(
    isTeleportToken({ typeId: "minecraft:paper", lore: [TOKEN_LORE] }),
    false,
  );
});

test("描述行只是包含标记文本时不算匹配", () => {
  assert.equal(
    isTeleportToken({ typeId: TOKEN_TYPE_ID, lore: [`前缀${TOKEN_LORE}`] }),
    false,
  );
});

// ─── 改版迁移:纸信物 → 磁石指针 ────────────────────────────────

test("信物类型是磁石指针", () => {
  assert.equal(TOKEN_TYPE_ID, "minecraft:lodestone_compass");
});

test("普通磁石指针(无描述行)不会被当成信物", () => {
  // 玩家自己合成的磁石指针不该打开传送菜单
  assert.equal(
    isTeleportToken({ typeId: "minecraft:lodestone_compass", lore: [] }),
    false,
  );
  assert.equal(
    isTeleportToken({
      typeId: "minecraft:lodestone_compass",
      lore: ["§7某人的磁石"],
    }),
    false,
  );
});
