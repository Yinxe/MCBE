// ─── GameTest 装置（注册永续 GameTest，为假人提供区块常加载） ──────────
// 几何为实测结论，勿凭直觉改：结构方块必须正好在 0,0,0（强加载假人扭头正常的前提）；
// 物化规律＝执行位置 x/z + (0,3)、y = 地面 + 1，故执行位置 (0,-1,-3) + y=-1 草坪恰好命中。
// 两步初始化（registerCustomDimension 只能在 startup 事件内调用，事件外必抛）：
// 1. startup 事件 registerTestDimension 注册自定义测试维度（结果不可靠，不据此判定）；
// 2. worldLoad 后 initTestField：校验测试结构（createEmpty 当前引擎必抛，勿删 BP structures/）
//    → 校验维度（无效回退 normal）→ ticking area 常加载装置区块 → getBlock 探 0,0,0：
//    在→命令方块位 gametest runthis 复用（失败则清空 0,0,0±8 范围后重建）；不在→y=-1 建 5x5 草坪后 run 物化。
// 探测必须用 getBlock（世界初期命令不可用）；初始化结束即移除，之后由运行中的 GameTest 常驻。

import { BlockPermutation, system, world, type Dimension, type StartupEvent } from "@minecraft/server";
import { register, Test } from "@minecraft/server-gametest";

/**
 * 测试维度：自定义 void 维度（registerCustomDimension 注册；管理员可经 /mp:enter 进入调试）。
 * 维度名沿用 mockplayer 基线名——世界存档中已有同名维度时直接复用，不再另建；
 * 木桶仓区 regionId 含维度名，与本常量必须保持一致（见 ItemVault STORAGE_REGION）。
 */
export const TEST_DIMENSION = "mockplayer:test";

/** 装置几何（实测：结构方块必须位于 0,0,0，假人扭头才完全正常） */
const RIG_STRUCT_POS = { x: 0, y: 0, z: 0 }; // 结构方块（监测点）
const RIG_RUN_POS = { x: 0, y: -1, z: -3 }; // gametest run 物化执行位置
const RIG_CMDBLOCK_POS = { x: 1, y: 0, z: -1 }; // 命令方块（runthis 执行位置）
const PAD_CENTER = { x: 0, y: -1, z: 0 }; // 草坪中心（y=-1 层，结构方块正下方）
const PAD_RADIUS = 2; // 5x5 草坪

/** /mp:enter 传送落点（草坪上装置旁空地；结构方块 0,0,0、命令方块 1,0,-1 均避开） */
export const TEST_FIELD_TELEPORT = { x: -0.5, y: 0, z: -0.5 };

export let globalTest: Test | null = null;

// GameTest 注册标识与 BP structures/mockplayer/void.mcstructure 沿用 v2 基线名：
// 存档中既有装置命令方块内写死 "gametest run mockplayer:keepalive" 字面，同名才跑得通 runthis 复用。
const CLASS = "mockplayer";
const NAME = "keepalive";
const STRUCTURE_ID = `${CLASS}:void`;

/** 注册后等待 GameTest 系统就绪（过早 run 实测装置不生成；register→40t 时序勿改） */
const GAMETEST_READY_DELAY_TICKS = 40;
/** 装置物化失败重试次数 / 重试间隔（tick） */
const MATERIALIZE_RETRY = 3;
const MATERIALIZE_RETRY_DELAY_TICKS = 20;

// ─── 公开入口 ──

/**
 * 测试装置是否已就绪（GameTest 运行中，区块常驻）。
 * @returns 就绪返回 true
 */
export function isTestFieldReady(): boolean {
  return globalTest !== null;
}

/**
 * 注册自定义测试维度（引擎约束：只能在 startup 事件中调用，事件外必抛）。
 * 注册结果不可靠，装置存在与否由 initTestField 探测结构方块判定。
 */
export function registerTestDimension(event: StartupEvent): void {
  try {
    event.dimensionRegistry.registerCustomDimension(TEST_DIMENSION);
    console.info(`[mockplayer3] 自定义测试维度注册成功：${TEST_DIMENSION}`);
  } catch (e: any) {
    // 防单错误阻断 startup（维度已存在等）
    console.info(`[mockplayer3] 自定义测试维度注册返回：${e?.message ?? e}`);
  }
}

/**
 * 初始化 GameTest 上下文：注册永续测试并启动。
 * 需在 registerTestDimension（startup）之后调用。
 * @returns GameTest 是否就绪（true=可用，false=回退 normal）
 */
export function initTestField(): Promise<boolean> {
  return new Promise((resolve) => {
    system.run(async () => {
      try {
        // 测试结构随 BP structures/ 注册进世界存储；缺失说明包体损坏，直接返回不再注册。
        // createEmpty 当前引擎必抛 EngineError，不作兜底。
        if (!world.structureManager.get(STRUCTURE_ID)) {
          console.error(
            `[mockplayer3] 世界结构 ${STRUCTURE_ID} 缺失（BP structures/mockplayer3/void.mcstructure 未随包加载？），装置初始化中止`
          );
          resolve(false);
          return;
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
          console.info("[mockplayer3] GameTest 上下文就绪");
        })
          .maxTicks(2_000_000_000)
          .structureName(STRUCTURE_ID);

        // 等待 GameTest 系统就绪（注册后立即 run 装置不生成）
        await delayTicks(GAMETEST_READY_DELAY_TICKS);

        // 5. 启动测试（常加载装置区块 → 监测结构方块 → 复用/物化）
        const started = await startGameTest();
        if (!started) {
          globalTest = null;
          console.error("[mockplayer3] GameTest 启动失败，GameTest 不可用（chunkload 回退 normal）");
          resolve(false);
        } else {
          resolve(true);
        }
      } catch (e: any) {
        globalTest = null;
        console.error(`[mockplayer3] GameTest 初始化失败: ${e?.message ?? e}`);
        resolve(false);
      }
    });
  });
}

// ─── 私有方法 ──────────────────────────────────────────────

/** 延迟 N tick（promise 风格） */
function delayTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => {
    system.runTimeout(() => resolve(), ticks);
  });
}

/**
 * 维度校验并启动测试：getDimension 不抛=有效；无效回退 normal。
 * ticking area 常加载装置区块（createTickingArea 的 Promise 在全部区块加载
 * 完成后才 resolve）→ 监测 0,0,0 结构方块：在→runthis 复用（不重物化、无叠加，
 * 失败则重建）；不在→草坪+gametest run 物化。初始化结束即移除 ticking area。
 * @returns 测试是否已启动
 */
async function startGameTest(): Promise<boolean> {
  // 维度有效性判据：getDimension 不抛
  let dim: Dimension;
  try {
    dim = world.getDimension(TEST_DIMENSION);
  } catch {
    console.warn("[mockplayer3] 测试维度无效（注册失败），chunkload 回退 normal");
    return false;
  }

  // 常加载装置区块：必须申请 4 个区块列 (-1,-1)..(0,0)——草坪 5x5 范围
  // x/z=-2..2 含负坐标区块，只加载 (0,0) 单列会让草坪落在未加载区块致创建失败。
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
    console.warn(`[mockplayer3] 常加载装置区块失败：${e?.message ?? e}`);
    return false;
  }

  try {
    // 监测 0,0,0 结构方块：装置是否已物化且位置正确
    if (rigExists(dim)) {
      if (tryRunThis(dim)) {
        console.info("[mockplayer3] GameTest 启动成功（runthis 复用装置）");
        return true;
      }
      console.warn("[mockplayer3] gametest runthis 失败（装置可能损坏），清空装置范围后重建");
      return initializeRig(dim, true);
    }
    console.info("[mockplayer3] 结构方块 0,0,0 缺失，初始化测试结构（草坪 + 物化）");
    return initializeRig(dim);
  } finally {
    // 初始化结束即移除常加载区块（测试运行后由 GameTest 保持常驻）
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
 * @param dim - 测试维度
 * @param clearFirst - 是否先清空装置范围（runthis 失败路：残留装置会顶撞物化）
 * @returns 装置是否已物化且测试已启动
 */
async function initializeRig(dim: Dimension, clearFirst = false): Promise<boolean> {
  if (clearFirst) clearRigArea(dim);
  buildGrassPad(dim);
  for (let attempt = 1; attempt <= MATERIALIZE_RETRY; attempt++) {
    if (materializeRig(dim)) {
      return true;
    }
    console.warn(
      `[mockplayer3] 装置物化第 ${attempt}/${MATERIALIZE_RETRY} 次失败，${MATERIALIZE_RETRY_DELAY_TICKS}tick 后重试`
    );
    await delayTicks(MATERIALIZE_RETRY_DELAY_TICKS);
  }
  return false;
}

/**
 * 清空以 0,0,0 为中心的 17×17×17 范围（±8 格）为空气——runthis 失败后重建前
 * 移除残留的结构方块/命令方块/旧草坪，防旧装置顶撞新物化。
 * 同步逐格 setAir，仅重建路触发（低频），启动日志会有一次 Watchdog spike 记录。
 */
function clearRigArea(dim: Dimension): void {
  const R = 8;
  for (let x = -R; x <= R; x++) {
    for (let y = -R; y <= R; y++) {
      for (let z = -R; z <= R; z++) {
        try {
          dim.getBlock({ x, y, z })?.setType("minecraft:air");
        } catch {
          // 单格失败（卸载/越界）跳过，不中断清扫
        }
      }
    }
  }
  console.info("[mockplayer3] 装置范围 0,0,0±8 已清空，重建测试结构");
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

/** 装置是否已物化且位置正确（结构方块在 0,0,0；世界初期命令不可用，用 getBlock 探测） */
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
      `execute positioned ${RIG_CMDBLOCK_POS.x} ${RIG_CMDBLOCK_POS.y} ${RIG_CMDBLOCK_POS.z} run gametest runthis`
    );
    if (run.successCount <= 0) console.warn(`[mockplayer3] runthis 未成功：successCount=${run.successCount}`);
    return run.successCount > 0;
  } catch (e: any) {
    console.warn(`[mockplayer3] runthis 抛错：${e?.message ?? e}`);
    return false;
  }
}

/**
 * gametest run 一步物化+启动测试；(0,-1,-3) 执行 + y=-1 草坪 → 结构方块落在 0,0,0。
 * @returns 命令成功执行（装置已物化且测试已启动）与否
 */
function materializeRig(dimension: Dimension): boolean {
  try {
    const run = dimension.runCommand(
      `execute positioned ${RIG_RUN_POS.x} ${RIG_RUN_POS.y} ${RIG_RUN_POS.z} run gametest run ${CLASS}:${NAME}`
    );
    if (run.successCount <= 0) console.warn(`[mockplayer3] gametest run 未成功：successCount=${run.successCount}`);
    return run.successCount > 0;
  } catch (e: any) {
    console.warn(`[mockplayer3] gametest run 抛错：${e?.message ?? e}`);
    return false;
  }
}
