// ─── 传送信物判定的单元测试 ─────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { isTeleportToken, TOKEN_LORE, TOKEN_TYPE_ID } from "../scripts/core/token";

test("普通纸不是信物", () => {
  assert.equal(isTeleportToken({ typeId: "minecraft:paper", lore: [] }), false);
});

test("带标记行的纸是信物", () => {
  assert.equal(isTeleportToken({ typeId: TOKEN_TYPE_ID, lore: [TOKEN_LORE] }), true);
});

test("标记行之外还有别的描述行时仍可识别", () => {
  assert.equal(isTeleportToken({ typeId: TOKEN_TYPE_ID, lore: ["§7第一行", TOKEN_LORE, "§7第三行"] }), true);
});

test("类型不对时即使描述相同也不是信物", () => {
  assert.equal(isTeleportToken({ typeId: "minecraft:map", lore: [TOKEN_LORE] }), false);
});

test("描述行只是包含标记文本时不算匹配", () => {
  assert.equal(isTeleportToken({ typeId: TOKEN_TYPE_ID, lore: [`前缀${TOKEN_LORE}`] }), false);
});
