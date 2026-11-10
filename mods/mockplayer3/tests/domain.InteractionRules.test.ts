// ─── 信物手势判据单测（长按=使用物品，蹲下+点击=与方块交互） ──────────
// 三条入口的边界：主菜单＝手持信物长按（不判蹲下）；工作箱绑定＝蹲下+手持信物+点击普通木头箱子。
// 关键回归：手持物必须是"本次交互实际使用的物品"——手持别的工具时不得误开绑定面板。
import test from "node:test";
import assert from "node:assert/strict";

import { isChestBindGesture, isTokenMenuGesture } from "../scripts/domain/InteractionRules";

const TOKEN = "mockplayer:token";
const inHand = { tokenEnabled: true, tokenTypeId: TOKEN, heldTypeId: TOKEN };

test("信物手势·主菜单：手持信物长按即开（不要求蹲下），其余一律不响应", () => {
  assert.equal(isTokenMenuGesture(inHand), true);
  assert.equal(isTokenMenuGesture({ ...inHand, heldTypeId: "" }), false, "空手不响应");
  assert.equal(isTokenMenuGesture({ ...inHand, heldTypeId: "minecraft:stick" }), false, "手持别的物品不响应");
  assert.equal(isTokenMenuGesture({ ...inHand, tokenEnabled: false }), false, "管理员关掉信物即不响应");
  assert.equal(
    isTokenMenuGesture({ ...inHand, tokenTypeId: "minecraft:stick", heldTypeId: "minecraft:stick" }),
    true,
    "信物可配置：配置成什么就要求手持什么"
  );
});

test("信物手势·工作箱绑定：蹲下+手持信物+点击普通木头箱子，三者缺一不开", () => {
  const chest = { ...inHand, sneaking: true, blockTypeId: "minecraft:chest" };
  assert.equal(isChestBindGesture(chest), true);
  assert.equal(
    isChestBindGesture({ ...chest, sneaking: false }),
    false,
    "不蹲下＝点击先去用手里物品，照常开原版箱子界面"
  );
  assert.equal(isChestBindGesture({ ...chest, blockTypeId: "minecraft:trapped_chest" }), false, "陷阱箱不作工作箱");
  assert.equal(isChestBindGesture({ ...chest, blockTypeId: "minecraft:barrel" }), false, "木桶不作工作箱");
  assert.equal(isChestBindGesture({ ...chest, blockTypeId: "minecraft:stone" }), false, "普通方块不响应");
  assert.equal(
    isChestBindGesture({ ...chest, heldTypeId: "minecraft:iron_axe" }),
    false,
    "手持别的工具点箱子不得误开面板（旧实现读快捷栏第 1 格会误判成手持信物）"
  );
  assert.equal(isChestBindGesture({ ...chest, heldTypeId: "" }), false, "空手点箱子照常开箱");
  assert.equal(isChestBindGesture({ ...chest, tokenEnabled: false }), false, "管理员关掉信物即不响应");
});
