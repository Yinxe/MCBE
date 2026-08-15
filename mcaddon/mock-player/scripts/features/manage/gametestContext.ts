// ─── GameTest 上下文管理（mc 层 bootstrap） ────────────
//
// 注册一个永续 GameTest，提供 test.spawnSimulatedPlayer 的区块常加载能力。
// 只被 spawnMode.ts 的 chunkload 模式使用。
//
// ⚠️ 装置几何（实测）：GameTest 物化测试结构时自动放置结构方块 + 命令方块，
//    **结构方块必须正好位于 0,0,0**（强加载假人扭头完全正常的前提）。
//    物化规律：结构方块 = 执行位置 x/z + (0,3)，y = 地面 + 1。
//    → 执行位置 (0,-1,-3) + y=-1 草坪地面 → 结构方块 (0,0,0)，
//    命令方块相对偏移 (1,0,-1) → (1,0,-1)。
//
// 维度注册与装置初始化分两步（registerCustomDimension 运行时约束只能在
// startup 事件中调用——事件外调用抛 "cannot register custom dimension ...
// outside of startup event"）：
//   1. registerTestDimension() —— main.ts startup 事件中调用：注册自定义测试
//      维度（注册结果不可靠，不据此判定）。
//   2. initGameTestContext() —— worldLoad 后 system.run 中调用：注册永续
//      GameTest 并按装置实际存在情况启动测试：
//      - getDimension 验证维度有效（无效回退 normal）；
//      - ticking area 常加载装置区块（**4 个区块列** (-1,-1)..(0,0)：草坪
//        中心 0,-1,0 的 5x5（x/z=-2..2）含负坐标区块；初始化结束即移除，
//        之后由运行中的 GameTest 保持区块常驻）；
//      - getBlock 监测 **0,0,0 结构方块**：
//        - 在 → 命令方块位置 `gametest runthis` 复用（不重新物化、无叠加）；
//          runthis 失败（装置损坏）→ 重建装置；
//        - 不在 → 初始化测试结构：y=-1 层建 5x5 草坪（供 GameTest 找地面）
//          → (0,-1,-3) 处 `gametest run` 物化（结构方块落在 0,0,0）。
//      ⚠️ 探测用 getBlock（Script API）而非 testforblock 命令——世界初期
//      命令不可用；ticking area 保证探测时区块已加载。

/** 测试维度：自定义 void 维度（registerCustomDimension 注册；管理员可经传送门进入调试） */
export const TEST_DIMENSION = "mockplayer:test";

/** 装置几何（结构方块必须位于 0,0,0，强加载假人扭头才完全正常） */
const RIG_STRUCT_POS = { x: 0, y: 0, z: 0 }; // 结构方块（监测点）
const RIG_RUN_POS = { x: 0, y: -1, z: -3 }; // gametest run 物化执行位置
const RIG_CMDBLOCK_POS = { x: 1, y: 0, z: -1 }; // 命令方块（runthis 执行位置）
const PAD_CENTER = { x: 0, y: -1, z: 0 }; // 草坪中心（y=-1 层，结构方块正下方）
const PAD_RADIUS = 2; // 5x5 草坪

import {
  BlockPermutation,
  StructureSaveMode,
  system,
  world,
  type Dimension,
  type StartupEvent,
} from "@minecraft/server";
import { register, Test } from "@minecraft/server-gametest";

export let globalTest: Test | null = null;

const CLASS = "mockplayer";
const NAME = "keepalive";
const STRUCTURE_ID = `${CLASS}:void`;

/** 注册 GameTest 后等待系统就绪的延迟（tick；过早 run 会失败——实测装置不生成） */
const GAMETEST_READY_DELAY_TICKS = 40;
/** 装置物化失败重试次数 / 重试间隔（tick） */
const MATERIALIZE_RETRY = 3;
const MATERIALIZE_RETRY_DELAY_TICKS = 20;

/** 延迟 N tick（promise 风格） */
function delayTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => {
    system.runTimeout(() => resolve(), ticks);
  });
}

/**
 * 注册自定义测试维度（**必须在 startup 事件中调用**，运行时约束）。
 * 装置存在情况由 initGameTestContext 在 worldLoad 后探测（getBlock 结构方块），
 * 此处仅确保维度被注册（注册结果不可靠，不据此判定）。
 */
export function registerTestDimension(event: StartupEvent): void {
  try {
    event.dimensionRegistry.registerCustomDimension(TEST_DIMENSION);
    console.info("[MockPlayer] 自定义测试维度注册成功：mockplayer:test");
  } catch (e: any) {
    // 防单错误阻断 startup（维度已存在等）
    console.info(`[MockPlayer] 自定义测试维度注册返回：${e?.message ?? e}`);
  }
}

/**
 * 初始化 GameTest 上下文：注册永续测试并启动。
 * 需在 registerTestDimension（startup）之后调用。
 */
export function initGameTestContext(): void {
  system.run(async () => {
    try {
      // 1. 创建空结构
      if (!world.structureManager.get(STRUCTURE_ID)) {
        world.structureManager.createEmpty(STRUCTURE_ID, { x: 1, y: 1, z: 1 }, StructureSaveMode.World);
      }

      // 2. 保存当前游戏规则（GameTest 启动时会篡改它们）
      const savedTick = world.gameRules.randomTickSpeed;
      const savedDay = world.gameRules.doDayLightCycle;
      const savedMob = world.gameRules.doMobSpawning;

      // 3. 注册永续 GameTest（回调在测试启动时触发）
      register(CLASS, NAME, (test: Test) => {
        globalTest = test;
        // 立即恢复游戏规则
        world.gameRules.randomTickSpeed = savedTick;
        world.gameRules.doDayLightCycle = savedDay;
        world.gameRules.doMobSpawning = savedMob;
        console.info("[MockPlayer] GameTest 上下文就绪");
      })
        .maxTicks(2_000_000_000)
        .structureName(STRUCTURE_ID);

      // 4. 等待 GameTest 系统就绪（注册后立即 run 会失败——实测装置不生成）
      await delayTicks(GAMETEST_READY_DELAY_TICKS);

      // 5. 启动测试（常加载装置区块 → 监测结构方块 → 复用/初始化，见 startGameTest）
      const started = await startGameTest();
      if (!started) {
        globalTest = null;
        console.error("[MockPlayer] GameTest 启动失败，GameTest 不可用（chunkload 回退 normal）");
      }
    } catch (e: any) {
      globalTest = null;
      console.error(`[MockPlayer] GameTest 初始化失败: ${e?.message ?? e}`);
    }
  });
}

// ─── 私有方法 ──────────────────────────────────────────────

/**
 * 验证测试维度有效性并启动测试：
 * 1. 维度有效（getDimension 不抛）→ **常加载装置区块**（ticking area 申请
 *    4 个区块列 (-1,-1)..(0,0)，覆盖草坪负坐标部分 + 装置 0,0,0；初始化
 *    结束即移除，之后由 GameTest 保持常驻）→ **监测 0,0,0 结构方块**（结构
 *    方块必须位于 0,0,0 扭头才正常）：
 *    - 在 → runthis 复用（不重新物化、无叠加）；runthis 失败 → 重建装置；
 *    - 不在 → 初始化测试结构：y=-1 层建 5x5 草坪（供 GameTest 找地面）
 *      → (0,-1,-3) 处 gametest run 物化（结构方块落在 0,0,0）。
 * 2. 维度无效（注册失败）→ 回退 normal。
 * @returns 测试是否已启动
 */
async function startGameTest(): Promise<boolean> {
  // 1. 验证测试维度是否有效（注册成功与否的可靠判据：getDimension 不抛）
  let dim: Dimension;
  try {
    dim = world.getDimension(TEST_DIMENSION);
  } catch {
    console.warn("[MockPlayer] 测试维度无效（注册失败），chunkload 回退 normal");
    return false;
  }

  // 2. 常加载装置区块（getBlock/物化需区块已加载；createTickingArea 的
  //    Promise 在所有区块加载完成后 resolve）。
  //    ⚠️ 申请 **4 个区块列**（(-1,-1) (-1,0) (0,-1) (0,0)）：草坪中心
  //    0,-1,0 的 5x5 范围 x/z=-2..2 含负坐标（属于负区块），0,0,0 单点
  //    只加载 (0,0) 区块列，草坪会落在未加载区块 → 创建失败。
  const areaId = `${TEST_DIMENSION}_rig`;
  try {
    world.tickingAreaManager.removeTickingArea(areaId); // 清残留，防同名冲突
  } catch {
    // 不存在，忽略
  }
  try {
    await world.tickingAreaManager.createTickingArea(areaId, {
      dimension: dim,
      from: { x: -16, y: 0, z: -16 },
      to: { x: 15, y: 0, z: 15 },
    });
  } catch (e: any) {
    console.warn(`[MockPlayer] 常加载装置区块失败：${e?.message ?? e}`);
    return false;
  }

  try {
    // 3. 监测 0,0,0 结构方块（装置是否已物化且位置正确）
    if (rigExists(dim)) {
      if (tryRunThis(dim)) {
        console.info("[MockPlayer] GameTest 启动成功（runthis 复用装置）");
        return true;
      }
      console.warn("[MockPlayer] gametest runthis 失败（装置可能损坏），重建装置");
      return initializeRig(dim);
    }
    console.info("[MockPlayer] 结构方块 0,0,0 缺失，初始化测试结构（草坪 + 物化）");
    return initializeRig(dim);
  } finally {
    // 4. 初始化结束即移除常加载区块（装置物化/测试运行后由 GameTest 保持区块常驻）
    try {
      world.tickingAreaManager.removeTickingArea(areaId);
    } catch {
      // 移除失败不阻塞（下次 worldLoad 创建前会先清残留）
    }
  }
}

/**
 * 初始化/重建测试装置（promise 风格）：先在 y=-1 层建 5x5 草坪（供 GameTest
 * 找地面），再在 (0,-1,-3) 执行 gametest run 物化（结构方块落在 0,0,0）。
 * 物化失败自动延迟重试（GameTest 系统可能未完全就绪）。
 * @returns 装置是否已物化且测试已启动
 */
async function initializeRig(dim: Dimension): Promise<boolean> {
  buildGrassPad(dim);
  for (let attempt = 1; attempt <= MATERIALIZE_RETRY; attempt++) {
    if (materializeRig(dim)) {
      return true;
    }
    console.warn(
      `[MockPlayer] 装置物化第 ${attempt}/${MATERIALIZE_RETRY} 次失败，${MATERIALIZE_RETRY_DELAY_TICKS}tick 后重试`
    );
    await delayTicks(MATERIALIZE_RETRY_DELAY_TICKS);
  }
  return false;
}

/**
 * 在 y=-1 层建 5x5 草坪（中心 0,-1,0，结构方块正下方）——GameTest 物化时
 * 找地面的支撑，让结构方块正好落在 0,0,0。
 */
function buildGrassPad(dim: Dimension): void {
  const perm = BlockPermutation.resolve("minecraft:grass_block");
  const { x: cx, y: py, z: cz } = PAD_CENTER;
  for (let x = cx - PAD_RADIUS; x <= cx + PAD_RADIUS; x++) {
    for (let z = cz - PAD_RADIUS; z <= cz + PAD_RADIUS; z++) {
      dim.getBlock({ x, y: py, z })?.setPermutation(perm);
    }
  }
}

/**
 * 探测装置是否已物化且位置正确（结构方块在 0,0,0；
 * 用 getBlock 而非 testforblock 命令——世界初期命令探测不可用）。
 */
function rigExists(dim: Dimension): boolean {
  try {
    return dim.getBlock(RIG_STRUCT_POS)?.typeId === "minecraft:structure_block";
  } catch {
    // 区块未加载等
    return false;
  }
}

/**
 * 在命令方块位置执行 gametest runthis 复用装置启动测试。
 * @returns 命令成功执行（测试已启动）与否
 */
function tryRunThis(dimension: Dimension): boolean {
  try {
    const run = dimension.runCommand(
      `execute positioned ${RIG_CMDBLOCK_POS.x} ${RIG_CMDBLOCK_POS.y} ${RIG_CMDBLOCK_POS.z} run gametest runthis`,
    );
    return run.successCount > 0;
  } catch {
    // 命令无效/执行失败
    return false;
  }
}

/**
 * 物化测试装置（gametest run 一步「物化 + 启动测试」）。
 * 在 (0,-1,-3) 执行 + y=-1 草坪地面 → 结构方块落在 0,0,0。
 * @returns 命令成功执行（装置已物化且测试已启动）与否
 */
function materializeRig(dimension: Dimension): boolean {
  try {
    const run = dimension.runCommand(
      `execute positioned ${RIG_RUN_POS.x} ${RIG_RUN_POS.y} ${RIG_RUN_POS.z} run gametest run ${CLASS}:${NAME}`,
    );
    return run.successCount > 0;
  } catch {
    // 命令无效/执行失败
    return false;
  }
}
