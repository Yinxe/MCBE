// ─── 玩家对象守卫的单元测试（纯核，不加载游戏运行时） ──
//
// 测试对象：`createPlayerGuard`（playerGuardCore.ts）。实例判定谓词由测试注入，
// 因此无需加载 `@minecraft/server`。
//
// 覆盖：可用性判定、假人判别（getGameMode 抛错/缺失/返回 undefined）、
// 名字三级兜底、安全枚举、单玩家调用隔离。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlayerGuard, type GuardedPlayer } from "../src/playerGuardCore";

/** 假 Player 基类：所有测试对象都由此派生，使注入的 instanceof 谓词成立 */
class FakePlayer implements GuardedPlayer {
  id = "player-1";
  dimension: unknown = { id: "minecraft:overworld" };
  location: unknown = { x: 1, y: 64, z: 2 };
  name: unknown = "Alice";
  playerName: unknown;
  nameTag: unknown;
  getGameMode?: () => unknown = () => "survival";

  constructor(fields: Record<string, unknown> = {}) {
    Object.assign(this, fields);
  }
}

const guard = createPlayerGuard<FakePlayer>((p) => p instanceof FakePlayer);

/** 构造一个"完整真人"：id/dimension/location 可读，getGameMode 返回生存模式 */
function realPlayer(overrides: Record<string, unknown> = {}): FakePlayer {
  return new FakePlayer(overrides);
}

/** 构造一个"假人"：getGameMode 抛错（跨任意假人模组的可靠特征） */
function simulatedPlayer(overrides: Record<string, unknown> = {}): FakePlayer {
  return new FakePlayer({
    id: "bot-1",
    name: "Bot",
    getGameMode: () => {
      throw new Error("SimulatedPlayer does not implement getGameMode");
    },
    ...overrides,
  });
}

test("isUsablePlayer: 拒绝 undefined / null / 非 Player 对象", () => {
  assert.equal(guard.isUsablePlayer(undefined), false);
  assert.equal(guard.isUsablePlayer(null), false);
  assert.equal(guard.isUsablePlayer({}), false);
  assert.equal(guard.isUsablePlayer("Alice"), false);
});

test("isUsablePlayer: 拒绝半初始化实体（缺 id / dimension / location）", () => {
  assert.equal(guard.isUsablePlayer(realPlayer({ id: undefined })), false);
  assert.equal(guard.isUsablePlayer(realPlayer({ id: "" })), false);
  assert.equal(guard.isUsablePlayer(realPlayer({ dimension: undefined })), false);
  assert.equal(guard.isUsablePlayer(realPlayer({ location: undefined })), false);
});

test("isUsablePlayer: 属性访问抛错的对象视为不可用", () => {
  const broken = new FakePlayer();
  Object.defineProperty(broken, "id", {
    get(): string {
      throw new Error("entity removed");
    },
  });
  assert.equal(guard.isUsablePlayer(broken), false);
});

test("isUsablePlayer: 完整真人对象判定为可用", () => {
  assert.equal(guard.isUsablePlayer(realPlayer()), true);
});

test("isSimulatedPlayer: getGameMode 抛错 → 判为假人", () => {
  assert.equal(guard.isSimulatedPlayer(simulatedPlayer()), true);
});

test("isSimulatedPlayer: getGameMode 返回 undefined → 判为假人", () => {
  assert.equal(guard.isSimulatedPlayer(realPlayer({ getGameMode: () => undefined })), true);
});

test("isSimulatedPlayer: getGameMode 缺失 → 判为假人", () => {
  assert.equal(guard.isSimulatedPlayer(realPlayer({ getGameMode: undefined })), true);
});

test("isSimulatedPlayer: 真人返回 false；不可用对象返回 false", () => {
  assert.equal(guard.isSimulatedPlayer(realPlayer()), false);
  assert.equal(guard.isSimulatedPlayer(undefined), false);
});

test("isRealPlayer: 可用且非假人才为真", () => {
  assert.equal(guard.isRealPlayer(realPlayer()), true);
  assert.equal(guard.isRealPlayer(simulatedPlayer()), false);
  assert.equal(guard.isRealPlayer(undefined), false);
});

test("playerNameOf: name → playerName → nameTag 三级兜底", () => {
  assert.equal(guard.playerNameOf({ name: "Alice" }), "Alice");
  assert.equal(guard.playerNameOf({ playerName: "Bob" }), "Bob");
  assert.equal(guard.playerNameOf({ nameTag: "Charlie" }), "Charlie");
  // name 为空串 → 回退到下一级
  assert.equal(guard.playerNameOf({ name: "", playerName: "Bob" }), "Bob");
  // 全部缺失 → undefined
  assert.equal(guard.playerNameOf({}), undefined);
  assert.equal(guard.playerNameOf(undefined), undefined);
});

test("playerNameOf: 某键访问抛错时继续尝试下一级兜底", () => {
  const p: Record<string, unknown> = { nameTag: "Fallback" };
  Object.defineProperty(p, "name", {
    get(): string {
      throw new Error("half-initialized");
    },
  });
  assert.equal(guard.playerNameOf(p), "Fallback");
});

test("safePlayers: 丢弃 undefined 项与半初始化实体，保留真假人", () => {
  // 半初始化：缺 dimension/location（刚召唤、实体未完全就绪）
  const halfInit = new FakePlayer({ id: "half", dimension: undefined, location: undefined });
  const list = [realPlayer(), undefined, simulatedPlayer(), halfInit];
  const out = guard.safePlayers(list);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((x) => x.name),
    ["Alice", "Bot"],
  );
});

test("safePlayers: realOnly 只保留真人", () => {
  const out = guard.safePlayers([realPlayer(), simulatedPlayer()], { realOnly: true });
  assert.equal(out.length, 1);
  assert.equal(out[0]?.name, "Alice");
});

test("safePlayers: 取不到名字的项被跳过（避免调用方裸读 name）", () => {
  const anonymous = realPlayer({ name: undefined, nameTag: undefined, playerName: undefined });
  assert.equal(guard.safePlayers([anonymous]).length, 0);
});

test("safePlayers: 集合本身迭代即抛错时返回空数组", () => {
  const brokenIterable: Iterable<unknown> = {
    [Symbol.iterator](): Iterator<unknown> {
      throw new Error("world removed");
    },
  };
  assert.deepEqual(guard.safePlayers(brokenIterable), []);
});

test("safePlayerCall: 正常执行返回结果", () => {
  assert.equal(guard.safePlayerCall(realPlayer(), (p) => p.name), "Alice");
});

test("safePlayerCall: 回调抛错时吞掉异常返回 undefined", () => {
  const got = guard.safePlayerCall(realPlayer(), () => {
    throw new Error("boom");
  });
  assert.equal(got, undefined);
});

test("safePlayerCall: requireReal 时假人不执行", () => {
  let called = false;
  const got = guard.safePlayerCall(
    simulatedPlayer(),
    () => {
      called = true;
      return 1;
    },
    { requireReal: true },
  );
  assert.equal(got, undefined);
  assert.equal(called, false);
});

test("safePlayerCall: 不可用对象不执行回调", () => {
  let called = false;
  guard.safePlayerCall(undefined, () => {
    called = true;
  });
  assert.equal(called, false);
});
