import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Mock @minecraft/server for Node.js runtime ────────────────
// Minecraft Bedrock Script API modules are type-only (no .js shipped),
// so we need a minimal mock for Node.js to load them at runtime.
function setupMinecraftMocks() {
  const mockDir = path.join(__dirname, "..", "tmp", "safety-tests", "node_modules", "@minecraft", "server");
  mkdirSync(mockDir, { recursive: true });
  writeFileSync(
    path.join(mockDir, "index.js"),
    `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.system = {
  currentTick: 0,
  run(callback) { callback(); },
  runInterval(callback) { return 0; },
  setTimeout() {},
  clearRun() {},
};
exports.ItemStack = class ItemStack {
  constructor(typeId, amount, maxAmount) {
    this.typeId = typeId;
    this.amount = amount;
    this.maxAmount = maxAmount ?? 64;
  }
  clone() { return new this.constructor(this.typeId, this.amount, this.maxAmount); }
  isStackableWith(other) { return this.typeId === other.typeId; }
  isStackable() { return true; }
  get keepOnDeath() { return false; }
  get localizationKey() { return ""; }
  get lockMode() { return ""; }
  get nameTag() { return undefined; }
  get localizationKey() { return ""; }
};
exports.Container = class Container {};
exports.Player = class Player {};
exports.Dimension = class Dimension {};
exports.Block = class Block {};
exports.BlockPermutation = class BlockPermutation {};
exports.BlockComponent = class BlockComponent {};
exports.World = class World {};
exports.world = {};
exports.GameMode = { survival: 0, creative: 1, adventure: 2, spectator: 3 };
exports.PlayerPermissionLevel = { visitor: 0, member: 1, operator: 2, custom: 3 };
`
  );
}

function teardownMinecraftMocks() {
  const outputDir = path.join(__dirname, "..", "tmp", "safety-tests");
  if (existsSync(outputDir)) rmSync(outputDir, { recursive: true });
}

// ── Compile ─────────────────────────────────────────────────────
if (existsSync("tmp/safety-tests")) rmSync("tmp/safety-tests", { recursive: true });
mkdirSync("tmp/safety-tests", { recursive: true });

try {
  execSync(
    "npx tsc --target ES2020 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --outDir tmp/safety-tests tests/safety/*.ts scripts/sorting/ContainerSnapshot.ts scripts/sorting/MoveJournal.ts scripts/sorting/SlotOrganizer.ts scripts/util/Logger.ts",
    { stdio: "inherit" }
  );
} catch {
  console.error("TypeScript compilation failed");
  process.exit(1);
}

// ── Setup mocks ─────────────────────────────────────────────────
setupMinecraftMocks();

// ── Test groups ────────────────────────────────────────────────
const groups = [
  { name: "ContainerSnapshot", file: "../tmp/safety-tests/tests/safety/ContainerSnapshot.test.js" },
  { name: "MoveJournal", file: "../tmp/safety-tests/tests/safety/MoveJournal.test.js" },
  { name: "SlotOrganizerRollback", file: "../tmp/safety-tests/tests/safety/SlotOrganizerRollback.test.js" },
];

let anyFailed = false;

for (const group of groups) {
  process.stdout.write(`\n  [${group.name}] running ... `);
  try {
    const mod = await import(group.file);
    const fnName = `run${group.name}Tests`;
    mod[fnName]();
    console.log("PASS");
  } catch (err) {
    console.log("FAIL");
    console.error(`  ${err.message}`);
    anyFailed = true;
  }
}

// ── Teardown ────────────────────────────────────────────────────
teardownMinecraftMocks();

console.log(""); // blank line

if (anyFailed) {
  console.log("safety tests: FAILED");
  process.exit(1);
} else {
  console.log("safety tests: PASSED");
}
