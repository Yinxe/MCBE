import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWarehouseByName, requireRole, canRunCommand, COMMAND_MIN_ROLE } from "../scripts/mc/commands/auth";
import { MemberService } from "../scripts/core/services/MemberService";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";
import type { Warehouse } from "../scripts/core/model/Warehouse";

function makeWarehouse(members: { playerName: string; role: "owner" | "member" }[]): Warehouse {
  return {
    id: "w1",
    displayName: "主仓库",
    ownerName: "p-owner",
    members,
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 10, z: 10 } },
    settings: createDefaultSettings(),
    containers: new Map(),
    inputs: new Map(),
  };
}

test("resolveWarehouseByName: 精确匹配显示名 / 无匹配 undefined", () => {
  const ws = [makeWarehouse([])];
  assert.equal(resolveWarehouseByName(ws, "主仓库")?.id, "w1");
  assert.equal(resolveWarehouseByName(ws, "不存在"), undefined);
});

test("requireRole: 权限矩阵 owner>member（无访客）", () => {
  const members = new MemberService();
  const wh = makeWarehouse([
    { playerName: "o", role: "owner" },
    { playerName: "m", role: "member" },
  ]);
  // owner 满足一切
  assert.equal(requireRole(members, wh, "o", "owner"), true);
  assert.equal(requireRole(members, wh, "o", "member"), true);
  // member 满足 member，不满足 owner
  assert.equal(requireRole(members, wh, "m", "member"), true);
  assert.equal(requireRole(members, wh, "m", "owner"), false);
  // 非成员
  assert.equal(requireRole(members, wh, "ghost", "member"), false);
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
  assert.equal(COMMAND_MIN_ROLE["menu"], "member");
  assert.equal(COMMAND_MIN_ROLE["search"], "member");
  assert.equal(COMMAND_MIN_ROLE["organize"], "any");
  assert.equal(COMMAND_MIN_ROLE["help"], "any");
});

test("canRunCommand: 权限贯穿（owner 可 delete，member 可 rescan/menu，非成员不可）", () => {
  const members = new MemberService();
  const wh = makeWarehouse([
    { playerName: "o", role: "owner" },
    { playerName: "m", role: "member" },
  ]);
  assert.equal(canRunCommand(members, wh, "o", "delete"), true);
  assert.equal(canRunCommand(members, wh, "m", "delete"), false);
  assert.equal(canRunCommand(members, wh, "m", "rescan"), true);
  assert.equal(canRunCommand(members, wh, "m", "menu"), true);
  assert.equal(canRunCommand(members, wh, "m", "search"), true); // search：member+
  assert.equal(canRunCommand(members, wh, "v", "rescan"), false); // 非成员（原 visitor）不可
});

test("canRunCommand: OP（isAdmin）豁免——非成员管理员可执行 owner 级命令", () => {
  const members = new MemberService();
  const wh = makeWarehouse([{ playerName: "o", role: "owner" }]);
  // 若 OP（isAdmin=true）：即使非成员也能 delete/resize（管理员全权限）
  assert.equal(canRunCommand(members, wh, "admin", "delete", true), true);
  assert.equal(canRunCommand(members, wh, "admin", "resize", true), true);
  assert.equal(canRunCommand(members, wh, "admin", "rescan", true), true);
  // isAdmin=false（普通玩家）→ 仍按成员矩阵
  assert.equal(canRunCommand(members, wh, "admin", "delete", false), false);
  // "any" 命令不受 isAdmin 影响（本就任意）
  assert.equal(canRunCommand(members, wh, "admin", "create", true), true);
});