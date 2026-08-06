import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isChestType,
  isHopperType,
  isSupportedContainerType,
  SHULKER_BOX_IDS,
} from "../scripts/core/model/ContainerTypes";

test("ContainerTypes: 箱子/陷阱箱判定", () => {
  assert.equal(isChestType("minecraft:chest"), true);
  assert.equal(isChestType("minecraft:trapped_chest"), true);
  assert.equal(isChestType("minecraft:barrel"), false);
  assert.equal(isChestType("minecraft:hopper"), false);
});

test("ContainerTypes: 漏斗判定", () => {
  assert.equal(isHopperType("minecraft:hopper"), true);
  assert.equal(isHopperType("minecraft:chest"), false);
});

test("ContainerTypes: 支持类型全集", () => {
  assert.equal(isSupportedContainerType("minecraft:chest"), true);
  assert.equal(isSupportedContainerType("minecraft:trapped_chest"), true);
  assert.equal(isSupportedContainerType("minecraft:barrel"), true);
  assert.equal(isSupportedContainerType("minecraft:hopper"), true);
  assert.equal(isSupportedContainerType("minecraft:undyed_shulker_box"), true);
  assert.equal(isSupportedContainerType("minecraft:red_shulker_box"), true);
  assert.equal(isSupportedContainerType("minecraft:stone"), false);
  assert.equal(isSupportedContainerType("minecraft:air"), false);
});

test("ContainerTypes: 潜影盒全集含 17 种", () => {
  assert.equal(SHULKER_BOX_IDS.size, 17);
  assert.equal(SHULKER_BOX_IDS.has("minecraft:undyed_shulker_box"), true);
  assert.equal(SHULKER_BOX_IDS.has("minecraft:black_shulker_box"), true);
});
