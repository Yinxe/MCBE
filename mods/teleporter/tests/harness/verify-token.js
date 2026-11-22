// 验证信物创建与迁移:mock 掉 @minecraft/server 的 ItemStack / Container
const path = require("path");
const esbuild = require("/home/yinxin/coding/mc-toolchain/node_modules/esbuild");
const MOD = "/home/yinxin/coding/mc-toolchain/mods/teleporter";

const out = "/tmp/token-bundle.js";
esbuild.buildSync({
  entryPoints: [path.join(MOD, "scripts/mc/token.ts")],
  bundle: true, platform: "node", format: "cjs", outfile: out,
  external: ["@minecraft/server"],
  logLevel: "error",
});

// mock
const Module = require("module");
const orig = Module._resolveFilename;
const mockPath = "/tmp/token-mock.js";
require("fs").writeFileSync(mockPath, `
const ItemLockMode = { none: "none", slot: "slot", inventory: "inventory" };
class ItemStack {
  constructor(type, amount) {
    this.typeId = type; this.amount = amount || 1;
    this._lore = []; this.nameTag = undefined;
    this.keepOnDeath = false; this.lockMode = undefined;
  }
  setLore(l) { this._lore = l; }
  getLore() { return this._lore; }
}
module.exports = { ItemStack, ItemLockMode };
`);
Module._resolveFilename = function (req, ...rest) {
  if (req === "@minecraft/server") return mockPath;
  return orig.call(this, req, ...rest);
};

const { createTeleportToken, hasTeleportToken, removeLegacyTokens, ensureTeleportToken } = require(out);
const { ItemStack } = require(mockPath);

let fails = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  if (!ok) fails++;
  console.log(`  ${ok ? "✓" : "✗"} ${n}: ${JSON.stringify(a)}${ok ? "" : ` (期望 ${JSON.stringify(e)})`}`);
};

console.log("\n[1] 创建的信物是磁石指针");
const t = createTeleportToken();
check("typeId", t.typeId, "minecraft:lodestone_compass");
check("nameTag", t.nameTag, "§b传送磁石");
check("lore", t.getLore(), ["§b右键打开传送菜单"]);
check("keepOnDeath", t.keepOnDeath, true);
check("lockMode", t.lockMode, "inventory");

console.log("\n[2] 背包扫描与旧信物清理");
function mkContainer(items) {
  const arr = items.slice();
  return {
    size: 36,
    getItem: (i) => arr[i],
    setItem: (i, v) => { arr[i] = v; },
    _arr: arr,
  };
}
const legacy = new ItemStack("minecraft:paper", 1);
legacy.setLore(["§b右键打开传送菜单"]);
const plainPaper = new ItemStack("minecraft:paper", 1);
const realCompass = new ItemStack("minecraft:lodestone_compass", 1);

const c1 = mkContainer([legacy, plainPaper, null]);
check("旧纸信物不算有效信物", hasTeleportToken(c1), false);
check("清掉的旧信物数", removeLegacyTokens(c1), 1);
check("普通纸未被误删", c1._arr[1] !== undefined, true);
check("旧信物槽已空", c1._arr[0], undefined);

console.log("\n[3] 补发:清旧 + 发新");
const c2 = mkContainer([legacy, null, null]);
const msgs = [];
const fakePlayer = {
  getComponent: () => ({ container: c2 }),
  sendMessage: (m) => msgs.push(m),
};
check("补发返回 true", ensureTeleportToken(fakePlayer), true);
check("新信物类型", c2._arr[0] ? c2._arr[0].typeId : null, "minecraft:lodestone_compass");
checkTrue("旧纸已被清掉", c2._arr.filter(x => x && x.typeId === "minecraft:paper").length === 0);

console.log("\n[4] 已有新信物时不重复发");
const c3 = mkContainer([createTeleportToken(), null]);
check("返回 false", ensureTeleportToken({ getComponent: () => ({ container: c3 }), sendMessage: () => {} }), false);

function checkTrue(n, cond) { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗"} ${n}`); }
console.log(fails === 0 ? "\n全部通过 ✓" : `\n${fails} 项失败 ✗`);
process.exit(fails === 0 ? 0 : 1);
