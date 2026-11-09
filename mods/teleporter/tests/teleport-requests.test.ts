// ─── 传送请求簿的单元测试 ───────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { isRequestExpired, TeleportRequestBook } from "../scripts/core/requests";
import { TELEPORT_REQUEST_TIMEOUT_MS } from "../scripts/core/types";

test("放入请求后可取出", () => {
  const book = new TeleportRequestBook();
  book.put({ fromId: "a", fromName: "甲", toId: "b", type: "tpa" }, 1000);

  const request = book.get("b", 1000);
  assert.equal(request?.fromName, "甲");
  assert.equal(request?.type, "tpa");
  assert.equal(request?.createdAt, 1000);
});

test("没有请求时返回 undefined", () => {
  const book = new TeleportRequestBook();
  assert.equal(book.get("b", 1000), undefined);
});

test("新请求覆盖旧请求,并返回被顶掉的那条", () => {
  const book = new TeleportRequestBook();
  book.put({ fromId: "a", fromName: "甲", toId: "c", type: "tpa" }, 1000);
  const result = book.put({ fromId: "b", fromName: "乙", toId: "c", type: "tphere" }, 2000);

  assert.equal(result.overwritten?.fromName, "甲");
  assert.equal(book.get("c", 2000)?.fromName, "乙");
  assert.equal(book.size, 1);
});

test("同一请求方重复发送不算被覆盖", () => {
  const book = new TeleportRequestBook();
  book.put({ fromId: "a", fromName: "甲", toId: "c", type: "tpa" }, 1000);
  const result = book.put({ fromId: "a", fromName: "甲", toId: "c", type: "tphere" }, 2000);

  assert.equal(result.overwritten, undefined);
  assert.equal(book.get("c", 2000)?.type, "tphere");
});

test("每个目标各持一条请求", () => {
  const book = new TeleportRequestBook();
  book.put({ fromId: "a", fromName: "甲", toId: "b", type: "tpa" }, 1000);
  book.put({ fromId: "a", fromName: "甲", toId: "c", type: "tpa" }, 1000);

  assert.equal(book.size, 2);
  assert.equal(book.get("b", 1000)?.toId, "b");
  assert.equal(book.get("c", 1000)?.toId, "c");
});

test("恰好等于超时时长仍有效", () => {
  const book = new TeleportRequestBook();
  book.put({ fromId: "a", fromName: "甲", toId: "b", type: "tpa" }, 1000);

  assert.ok(book.get("b", 1000 + TELEPORT_REQUEST_TIMEOUT_MS));
});

test("超过超时时长后失效", () => {
  const book = new TeleportRequestBook();
  book.put({ fromId: "a", fromName: "甲", toId: "b", type: "tpa" }, 1000);

  assert.equal(book.get("b", 1001 + TELEPORT_REQUEST_TIMEOUT_MS), undefined);
  assert.equal(book.size, 0);
});

test("读取时惰性清理过期请求", () => {
  const book = new TeleportRequestBook();
  book.put({ fromId: "a", fromName: "甲", toId: "b", type: "tpa" }, 1000);
  book.put({ fromId: "a", fromName: "甲", toId: "c", type: "tpa" }, 1000);

  // 只读 c,但 b 也已过期
  book.get("c", 1001 + TELEPORT_REQUEST_TIMEOUT_MS);
  assert.equal(book.size, 0);
});

test("删除返回被删掉的请求", () => {
  const book = new TeleportRequestBook();
  book.put({ fromId: "a", fromName: "甲", toId: "b", type: "tpa" }, 1000);

  assert.equal(book.remove("b")?.fromName, "甲");
  assert.equal(book.remove("b"), undefined);
});

test("isRequestExpired 的边界", () => {
  const request = { fromId: "a", fromName: "甲", toId: "b", type: "tpa" as const, createdAt: 1000 };
  assert.equal(isRequestExpired(request, 1000 + TELEPORT_REQUEST_TIMEOUT_MS, TELEPORT_REQUEST_TIMEOUT_MS), false);
  assert.equal(isRequestExpired(request, 1001 + TELEPORT_REQUEST_TIMEOUT_MS, TELEPORT_REQUEST_TIMEOUT_MS), true);
});
