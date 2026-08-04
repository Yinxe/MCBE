import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWarehouseByName, requireRole, canRunCommand, COMMAND_MIN_ROLE } from "../scripts/mc/commands/auth";
import { MemberService } from "../scripts/core/services/MemberService";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";
import type { Warehouse } from "../scripts/core/model/Warehouse";

function makeWarehouse(members: { playerId: string; role: "owner" | "member" | "visitor" }[]): Warehouse {
  return {
    id: "w1",
    displayName: "主仓库",
    ownerId: "p-owner",
    members,
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 10, z: 10 } },
    settings: createDefaultSettings(),
    containers: new Map(),
  };
}

test("resolveWarehouseByName: 精确匹配显示名 / 无匹配 undefined", () => {
  const ws = [makeWarehouse([])];
  assert.equal(resolveWarehouseByName(ws, "主仓库")?.id, "w1");
  assert.equal(resolveWarehouseByName(ws, "不存在"), undefined);
});

test("requireRole: 权限矩阵 owner>member>visitor", () => {
  const members = new MemberService();
  const wh = makeWarehouse([
    { playerId: "o", role: "owner" },
    { playerId: "m", role: "member" },
    { playerId: "v", role: "visitor" },
  ]);
  // owner 满足一切
  assert.equal(requireRole(members, wh, "o", "owner"), true);
  assert.equal(requireRole(members, wh, "o", "member"), true);
  assert.equal(requireRole(members, wh, "o", "visitor"), true);
  // member 满足 member/visitor，不满足 owner
  assert.equal(requireRole(members, wh, "m", "member"), true);
  assert.equal(requireRole(members, wh, "m", "visitor"), true);
  assert.equal(requireRole(members, wh, "m", "owner"), false);
  // visitor 仅 visitor
  assert.equal(requireRole(members, wh, "v", "visitor"), true);
  assert.equal(requireRole(members, wh, "v", "member"), false);
  // 非成员
  assert.equal(requireRole(members, wh, "ghost", "visitor"), false);
  assert.equal(requireRole(members, wh, "ghost", "owner"), false);
  // 仓库不存在
  assert.equal(requireRole(members, undefined, "o", "owner"), false);
});

test("COMMAND_MIN_ROLE: 矩阵映射正确", () => {
  assert.equal(COMMAND_MIN_ROLE["create"], "any");
  assert.equal(COMMAND_MIN_ROLE["delete"], "owner");
  assert.equal(COMMAND_MIN_ROLE["resize"], "owner");
  assert.equal(COMMAND_MIN_ROLE["rescan"], "member");
  assert.equal(COMMAND_MIN_ROLE["rescan_preview"], "member");
  assert.equal(COMMAND_MIN_ROLE["menu"], "visitor");
  assert.equal(COMMAND_MIN_ROLE["search"], "visitor");
  assert.equal(COMMAND_MIN_ROLE["organize"], "any");
  assert.equal(COMMAND_MIN_ROLE["help"], "any");
});

test("canRunCommand: 权限贯穿（owner 可 delete，member 可 rescan，visitor 可 menu 不可 rescan）", () => {
  const members = new MemberService();
  const wh = makeWarehouse([
    { playerId: "o", role: "owner" },
    { playerId: "m", role: "member" },
    { playerId: "v", role: "visitor" },
  ]);
  assert.equal(canRunCommand(members, wh, "o", "delete"), true);
  assert.equal(canRunCommand(members, wh, "m", "delete"), false);
  assert.equal(canRunCommand(members, wh, "m", "rescan"), true);
  assert.equal(canRunCommand(members, wh, "v", "rescan"), false);
  assert.equal(canRunCommand(members, wh, "v", "menu"), true);
  assert.equal(canRunCommand(members, wh, "v", "search"), true); // search 需要仓库，但矩阵允许 visitor
});