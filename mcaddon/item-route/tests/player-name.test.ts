// `.name` bug 回归测试（mc/util/playerName —— 读名三级兜底 + 安全在线枚举）：
// getAllPlayers 某些时刻（模拟玩家进出/半初始化/异常实体）含 undefined 项或字段不全的 Player，
// 裸 `.map(p => p.name)` 会 TypeError / 读到 undefined。此处验证 playerNameOf 逐键兜底 +
// namedPlayers 只放行"取到可靠名字"条目，且返回的 name 是**解析值**（不是裸 p.name）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { playerNameOf, onlinePlayerNames, namedPlayers } from "../scripts/mc/util/playerName";

test("playerNameOf: 真实玩家（name 字段）→ 取 name", () => {
  assert.equal(playerNameOf({ name: "Alex", nameTag: "亚历克斯" }), "Alex");
});

test("playerNameOf: 模拟玩家（name 空但 nameTag 有效）→ 兜底到 nameTag", () => {
  assert.equal(playerNameOf({ name: undefined, playerName: undefined, nameTag: "Bot1" }), "Bot1");
  assert.equal(playerNameOf({ name: "", nameTag: "Bot1" }), "Bot1");
});

test("playerNameOf: 事件负载 playerName 字段可作中间兜底", () => {
  assert.equal(playerNameOf({ name: undefined, playerName: "Alex", nameTag: "" }), "Alex");
});

test("playerNameOf: undefined/null/字段全空 → undefined（拒绝不安全数据）", () => {
  assert.equal(playerNameOf(undefined), undefined);
  assert.equal(playerNameOf(null), undefined);
  assert.equal(playerNameOf({}), undefined);
  assert.equal(playerNameOf({ name: undefined, playerName: undefined, nameTag: undefined }), undefined);
  assert.equal(playerNameOf({ name: 123, nameTag: ["x"] }), undefined);
});

test("playerNameOf: 半初始化实体属性访问抛错 → 兜底到下一键/返回 undefined，绝不外抛", () => {
  const throwingName = {
    get name() {
      throw new Error("半初始化实体");
    },
    playerName: "由playerName兜底",
  };
  assert.equal(playerNameOf(throwingName), "由playerName兜底");
  const allThrow = {
    get name() {
      throw new Error("boom");
    },
    get nameTag() {
      throw new Error("boom");
    },
  };
  assert.equal(playerNameOf(allThrow), undefined);
});

test("onlinePlayerNames: 剔除 undefined/字段不全/半初始化项，留可靠名", () => {
  const names = onlinePlayerNames([
    { name: "Alex" },
    undefined,
    null,
    { name: "Bot1" },
    {},
    { name: "", nameTag: "Bot2" },
  ]);
  assert.deepEqual(names, ["Alex", "Bot1", "Bot2"]);
});

test("namedPlayers: 返回 { player, name }，name 为解析值（兜底场景返回的是解析名而非裸 p.name）", () => {
  const real = { name: "Alex", nameTag: "亚历克斯" };
  const sim = { name: "", nameTag: "Bot1" }; // 裸 p.name 为 "" → 必须用解析值 "Bot1"
  const padded = { playerName: "P", nameTag: "T" };
  const list = namedPlayers([real, undefined, null, sim, padded]);
  assert.deepEqual(
    list.map(({ name }) => name),
    ["Alex", "Bot1", "P"]
  );
  // player 即原对象字节引用（后续读 dimension/location 用同一个对象）
  assert.equal(list[0]?.player, real);
  assert.equal(list[1]?.player, sim);
  assert.ok(list.every((p) => typeof p.name === "string" && p.name.length > 0));
});

test("member-permission 兼容：模拟玩家名与真实玩家名一样可匹配成员表", () => {
  // 成员判定基于解析名（不裸枚举），此处验证两种来源的名都能稳定取到，供 can() 判定
  const real = playerNameOf({ name: "Alex" }) as string;
  const sim = playerNameOf({ name: undefined, nameTag: "Bot1" }) as string;
  const memberSet = new Set(["Alex", "Bot1"]);
  assert.ok(memberSet.has(real));
  assert.ok(memberSet.has(sim));
});