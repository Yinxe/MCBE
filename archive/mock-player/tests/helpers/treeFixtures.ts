// ─── 树判定测试共享工具 ────────────────────────────────
// MockWorld：内存三维方块地图（typeId 存储，provider 走 classifyTreeBlock——
// 与 mc 层真实接入路径一致）。树型构造器按 Minecraft 中文 Wiki"树木/结构"
// 数据搭建（树干高度/树冠层位/斜干分叉/2×2 大树等）。

import { classifyTreeBlock, type CellKindFn, type TreeLog } from "../../scripts/rules/tree/TreeRules";

/** 内存三维方块地图（缺省空气；provider 复用 classifyTreeBlock） */
export class MockWorld {
  private cells = new Map<string, string>();

  /** 放置方块（typeId；"air" 亦可显式放置） */
  set(x: number, y: number, z: number, typeId: string): void {
    this.cells.set(`${x},${y},${z}`, typeId);
  }

  /** 读取方块 typeId（缺省空气） */
  typeAt(x: number, y: number, z: number): string {
    return this.cells.get(`${x},${y},${z}`) ?? "minecraft:air";
  }

  /** 复制本世界全部方块到目标世界（带偏移；多树场景拼装用） */
  cloneInto(target: MockWorld, dx: number, dy: number, dz: number): void {
    for (const [key, typeId] of this.cells) {
      const [x = 0, y = 0, z = 0] = key.split(",").map(Number);
      target.set(x + dx, y + dy, z + dz, typeId);
    }
  }

  /** 区域方块查询（与 mc 层同一分类入口） */
  readonly provider: CellKindFn = (x, y, z) => classifyTreeBlock(this.typeAt(x, y, z));

  // ── 常用方块快捷放置 ──

  /** 原木（grass 地面场景统一用 oak） */
  log(x: number, y: number, z: number, woodId = "oak"): void {
    this.set(x, y, z, "minecraft:log");
  }

  /** 树叶 */
  leaf(x: number, y: number, z: number): void {
    this.set(x, y, z, "minecraft:oak_leaves");
  }

  /** 自然地面（草方块） */
  ground(x: number, y: number, z: number): void {
    this.set(x, y, z, "minecraft:grass_block");
  }

  /** 藤蔓（自然附属） */
  vine(x: number, y: number, z: number): void {
    this.set(x, y, z, "minecraft:vine");
  }

  /** 石头（异物） */
  stone(x: number, y: number, z: number): void {
    this.set(x, y, z, "minecraft:stone");
  }

  /** 木板（异物） */
  planks(x: number, y: number, z: number): void {
    this.set(x, y, z, "minecraft:oak_planks");
  }
}

// ─── 场景构造器 ────────────────────────────────────────
// 惯例：地面层 y=0，树干 y=1..H。返回原木点列表（TreeLog[]，woodId 默认 oak）。

/** 铺自然地面（|x|,|z| ≤ radius 的正方形，y=0） */
export function layGround(world: MockWorld, radius: number): void {
  for (let x = -radius; x <= radius; x++) {
    for (let z = -radius; z <= radius; z++) {
      world.ground(x, 0, z);
    }
  }
}

/** 在 (cx,cz) 周围放一层 r 半径（切比雪夫）正方形树叶（跳过原木格） */
export function leafDisk(world: MockWorld, cx: number, y: number, cz: number, r: number, skip: ReadonlySet<string>): void {
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (skip.has(`${cx + dx},${cz + dz}`)) continue;
      world.leaf(cx + dx, y, cz + dz);
    }
  }
}

/** 收集树干原木（记录 world + 返回 TreeLog 列表） */
export function trunk(world: MockWorld, cells: [number, number, number][], woodId = "oak"): TreeLog[] {
  const logs: TreeLog[] = [];
  for (const [x = 0, y = 0, z = 0] of cells) {
    world.log(x, y, z, woodId);
    logs.push({ x, y, z, woodId });
  }
  return logs;
}

/** 1×1 垂直原木柱（自 y=1 起 h 格） */
export function column(cx: number, cz: number, h: number): [number, number, number][] {
  const cells: [number, number, number][] = [];
  for (let y = 1; y <= h; y++) cells.push([cx, y, cz]);
  return cells;
}

// ── 小树场景 ──

/** 普通橡树：树干 5 格，树冠第 2 层起（wiki：树冠最低可触及地面），r2/r2/r2/r1 */
export function buildOak(ground = true): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  if (ground) layGround(world, 6);
  const logs = trunk(world, column(0, 0, 5));
  const skip = new Set(["0,0"]);
  leafDisk(world, 0, 2, 0, 2, skip);
  leafDisk(world, 0, 3, 0, 2, skip);
  leafDisk(world, 0, 4, 0, 2, skip);
  leafDisk(world, 0, 5, 0, 1, skip);
  return { world, logs };
}

/** 云杉（锥形树冠贴树干）：树干 7 格，树叶第 2 层至第 8 层逐层收窄 */
export function buildSpruce(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 6);
  const logs = trunk(world, column(0, 0, 7), "spruce");
  const skip = new Set(["0,0"]);
  leafDisk(world, 0, 2, 0, 2, skip);
  leafDisk(world, 0, 3, 0, 2, skip);
  leafDisk(world, 0, 4, 0, 2, skip);
  leafDisk(world, 0, 5, 0, 1, skip);
  leafDisk(world, 0, 6, 0, 1, skip);
  leafDisk(world, 0, 7, 0, 1, skip);
  leafDisk(world, 0, 8, 0, 1, skip);
  return { world, logs };
}

/** 松树（稀疏顶冠）：树干 7 格，仅顶部 ~11 片叶（wiki：树叶 10+） */
export function buildPine(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 6);
  const logs = trunk(world, column(0, 0, 7), "spruce");
  for (const [dx = 0, dz = 0] of [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
    [1, 1],
  ]) {
    world.leaf(dx, 6, dz);
    world.leaf(dx, 7, dz);
  }
  world.leaf(0, 8, 0);
  return { world, logs };
}

/** 白桦：树干 5 格，树冠第 3 层至第 6 层 */
export function buildBirch(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 6);
  const logs = trunk(world, column(0, 0, 5), "birch");
  const skip = new Set(["0,0"]);
  leafDisk(world, 0, 3, 0, 2, skip);
  leafDisk(world, 0, 4, 0, 2, skip);
  leafDisk(world, 0, 5, 0, 1, skip);
  leafDisk(world, 0, 6, 0, 1, skip);
  return { world, logs };
}

/** 金合欢：斜干（每层 +1 x）+ 顶部分叉（y6 双块）+ 宽扁树冠 7×7×2（wiki：树干弯曲分叉） */
export function buildAcacia(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 8);
  const logs = trunk(
    world,
    [
      [0, 1, 0],
      [1, 2, 0],
      [2, 3, 0],
      [3, 4, 0],
      [4, 5, 0],
      [5, 6, 0],
      [5, 6, 1],
    ],
    "acacia"
  );
  const skip = new Set(["5,0", "5,1"]);
  leafDisk(world, 5, 7, 0, 3, skip);
  leafDisk(world, 5, 8, 0, 3, skip);
  return { world, logs };
}

/** 红树：树干 5 格 + 泥/水地基 + 根部 mangrove_roots（wiki：红树根+浅水；
 *  实测红树根在树干正下方——支撑检查须认自然附属） */
export function buildMangrove(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  for (let x = -5; x <= 5; x++) {
    for (let z = -5; z <= 5; z++) {
      world.set(x, 0, z, "minecraft:water");
    }
  }
  const logs = trunk(world, column(0, 0, 5), "mangrove");
  world.set(0, 0, 0, "minecraft:mangrove_roots"); // 树干正下方 = 根（实测形态）
  for (const [dx = 0, dz = 0] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    world.set(dx, 1, dz, "minecraft:mangrove_roots");
    world.set(dx, 2, dz, "minecraft:mangrove_roots");
  }
  const skip = new Set(["0,0"]);
  leafDisk(world, 0, 3, 0, 2, skip);
  leafDisk(world, 0, 4, 0, 2, skip);
  leafDisk(world, 0, 5, 0, 2, skip);
  leafDisk(world, 0, 6, 0, 1, skip);
  return { world, logs };
}

/** 雨林大树：2×2 树干 6 格 + 顶部枝干原木（横向）+ 大树冠——A 因子须经
 *  枝干原木连通（实测雨林 2×2 jungle A=0.62 被误杀） */
export function buildJungleBigBranched(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 8);
  const cells: [number, number, number][] = [];
  for (let y = 1; y <= 6; y++) {
    cells.push([0, y, 0], [1, y, 0], [0, y, 1], [1, y, 1]);
  }
  // 枝干层（y5-6 外扩，断链残留——区域内原木仍是 A 连通骨架）
  cells.push([2, 5, 0], [2, 6, 0], [-1, 5, 0], [0, 6, -1]);
  const logs = trunk(world, cells, "jungle");
  const skip = new Set(["0,0", "1,0", "0,1", "1,1", "2,0", "-1,0", "0,-1"]);
  leafDisk(world, 0, 5, 0, 3, skip);
  leafDisk(world, 0, 6, 0, 3, skip);
  leafDisk(world, 0, 7, 0, 3, skip);
  leafDisk(world, 0, 8, 0, 2, skip);
  return { world, logs };
}

/** 双生橡树（2×1）：两棵 1×1 树干相距 1 格，树冠合并——按单棵小树处理 */
export function buildDoubleOak(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 6);
  const logs = [...trunk(world, column(0, 0, 5)), ...trunk(world, column(1, 0, 5))];
  const skip = new Set(["0,0", "1,0"]);
  leafDisk(world, 0, 2, 0, 2, skip);
  leafDisk(world, 0, 3, 0, 2, skip);
  leafDisk(world, 0, 4, 0, 2, skip);
  leafDisk(world, 0, 5, 0, 2, skip);
  return { world, logs };
}

/** 悬崖边橡树：底部层半边空气（G 软因子容错场景） */
export function buildCliffOak(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  for (let x = -6; x <= 0; x++) {
    for (let z = -6; z <= 6; z++) {
      world.ground(x, 0, z);
    }
  }
  const logs = trunk(world, column(0, 0, 5));
  const skip = new Set(["0,0"]);
  leafDisk(world, 0, 2, 0, 2, skip);
  leafDisk(world, 0, 3, 0, 2, skip);
  leafDisk(world, 0, 4, 0, 2, skip);
  leafDisk(world, 0, 5, 0, 1, skip);
  return { world, logs };
}

/** 真实森林地表：橡树 + 9 株植被环绕（草/花/蕨/菌/树苗/郁金香——游戏实测教训：植被不算异物） */
export function buildOakCluttered(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 6);
  const logs = trunk(world, column(0, 0, 5));
  const skip = new Set(["0,0"]);
  leafDisk(world, 0, 2, 0, 2, skip);
  leafDisk(world, 0, 3, 0, 2, skip);
  leafDisk(world, 0, 4, 0, 2, skip);
  leafDisk(world, 0, 5, 0, 1, skip);
  const plants: [string, number, number, number][] = [
    ["minecraft:short_grass", 1, 1, 0],
    ["minecraft:short_grass", -1, 1, 1],
    ["minecraft:short_grass", 2, 1, 1],
    ["minecraft:dandelion", 1, 1, 1],
    ["minecraft:poppy", -1, 1, 0],
    ["minecraft:fern", 2, 1, 0],
    ["minecraft:brown_mushroom", 0, 1, 2],
    ["minecraft:oak_sapling", -2, 1, 2],
    ["minecraft:red_tulip", 2, 1, 2],
  ];
  for (const [id = "", x = 0, y = 0, z = 0] of plants) world.set(x, y, z, id);
  return { world, logs };
}

/** 密集森林三棵交叉：1 格间距三角形密植（高 5/6/4）+ 树冠交融 → 合并为一棵小树资源 */
export function buildDenseTriple(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 7);
  const logs = [
    ...trunk(world, column(0, 0, 5)),
    ...trunk(world, column(1, 0, 6)),
    ...trunk(world, column(0, 1, 4)),
  ];
  const skip = new Set(["0,0", "1,0", "0,1"]);
  leafDisk(world, 0, 2, 0, 2, skip);
  leafDisk(world, 0, 3, 0, 2, skip);
  leafDisk(world, 0, 4, 0, 2, skip);
  leafDisk(world, 1, 3, 0, 2, skip);
  leafDisk(world, 1, 4, 0, 2, skip);
  leafDisk(world, 1, 5, 0, 2, skip);
  leafDisk(world, 0, 3, 1, 2, skip);
  leafDisk(world, 0, 4, 1, 2, skip);
  return { world, logs };
}

/** 1×4 原木矮墙（每层 4 块直线，高 3）→ 小树候选产生但无树冠拒绝（评估层兜底） */
export function buildLogWall(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 6);
  const cells: [number, number, number][] = [];
  for (let y = 1; y <= 3; y++) {
    for (let x = 0; x <= 3; x++) cells.push([x, y, 0]);
  }
  const logs = trunk(world, cells);
  return { world, logs };
}

// ── 大树场景 ──

/** 深色橡树：2×2 树干 6 格 + 第 5 层加宽（断链）+ 宽树冠 7×7×4（wiki：第 4-5 层加宽） */
export function buildDarkOak(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 8);
  const logs = trunk(
    world,
    [
      [0, 1, 0],
      [1, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [0, 2, 0],
      [1, 2, 0],
      [0, 2, 1],
      [1, 2, 1],
      [0, 3, 0],
      [1, 3, 0],
      [0, 3, 1],
      [1, 3, 1],
      [0, 4, 0],
      [1, 4, 0],
      [0, 4, 1],
      [1, 4, 1],
      [0, 5, 0],
      [1, 5, 0],
      [0, 5, 1],
      [1, 5, 1],
      [0, 6, 0],
      [1, 6, 0],
      [0, 6, 1],
      [1, 6, 1],
      // 第 6 层加宽（2×2 四角外扩 4 块）——断链残留
      [2, 6, 0],
      [2, 6, 1],
      [-1, 6, 0],
      [0, 6, -1],
    ],
    "dark_oak"
  );
  const skip = new Set(["0,0", "1,0", "0,1", "1,1", "2,0", "2,1", "-1,0", "0,-1"]);
  leafDisk(world, 0, 6, 0, 3, skip);
  leafDisk(world, 0, 7, 0, 3, skip);
  leafDisk(world, 0, 8, 0, 3, skip);
  leafDisk(world, 0, 9, 0, 2, skip);
  return { world, logs };
}

/** 大型云杉：2×2 树干 20 格 + 锥形大树冠（第 8 层起） */
export function buildMegaSpruce(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 6);
  const cells: [number, number, number][] = [];
  for (let y = 1; y <= 20; y++) {
    cells.push([0, y, 0], [1, y, 0], [0, y, 1], [1, y, 1]);
  }
  const logs = trunk(world, cells, "spruce");
  const skip = new Set(["0,0", "1,0", "0,1", "1,1"]);
  leafDisk(world, 0, 8, 0, 3, skip);
  leafDisk(world, 0, 11, 0, 2, skip);
  leafDisk(world, 0, 14, 0, 2, skip);
  leafDisk(world, 0, 17, 0, 1, skip);
  leafDisk(world, 0, 20, 0, 1, skip);
  leafDisk(world, 0, 22, 0, 1, skip);
  return { world, logs };
}

/** 大型松树：2×2 树干 20 格 + 顶部稀疏叶（第 19-22 层，wiki：树叶 75+） */
export function buildMegaPine(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 6);
  const cells: [number, number, number][] = [];
  for (let y = 1; y <= 20; y++) {
    cells.push([0, y, 0], [1, y, 0], [0, y, 1], [1, y, 1]);
  }
  const logs = trunk(world, cells, "spruce");
  for (let y = 19; y <= 20; y++) {
    for (const [dx = 0, dz = 0] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
      [2, 0],
      [-1, 0],
      [0, 2],
      [0, -1],
      [2, 2],
      [-1, 2],
    ]) {
      world.leaf(dx, y, dz);
    }
  }
  world.leaf(0, 22, 0);
  return { world, logs };
}

/** 大型丛林树：2×2 树干 9 格 + 藤蔓 + 树冠（第 10-12 层，宽 9-10 格） */
export function buildJungleBig(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 8);
  const cells: [number, number, number][] = [];
  for (let y = 1; y <= 9; y++) {
    cells.push([0, y, 0], [1, y, 0], [0, y, 1], [1, y, 1]);
  }
  const logs = trunk(world, cells, "jungle");
  for (let y = 2; y <= 9; y++) {
    world.vine(2, y, 0);
    world.vine(-1, y, 0);
  }
  const skip = new Set(["0,0", "1,0", "0,1", "1,1"]);
  leafDisk(world, 0, 10, 0, 4, skip);
  leafDisk(world, 0, 11, 0, 4, skip);
  leafDisk(world, 0, 12, 0, 4, skip);
  return { world, logs };
}

// ── 拒绝场景 ──

/** 装饰柱 + 3×3 单层叶板（1 格柱+2 高——伞状装饰） */
export function buildDecorPillar3x3(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 4);
  const logs = trunk(world, column(0, 0, 2));
  leafDisk(world, 0, 3, 0, 1, new Set(["0,0"]));
  return { world, logs };
}

/** 装饰柱 + 5×5×2 双层叶板（4 格柱——长成树样的临界场景） */
export function buildDecorPillar5x5x2(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 5);
  const logs = trunk(world, column(0, 0, 4));
  const skip = new Set(["0,0"]);
  leafDisk(world, 0, 5, 0, 2, skip);
  leafDisk(world, 0, 6, 0, 2, skip);
  return { world, logs };
}

/** 原木柱（5 格高，无树冠） */
export function buildLogPillar(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 4);
  const logs = trunk(world, column(0, 0, 5));
  return { world, logs };
}

/** 悬空橡树（脚下无地面——残缺/装饰，等衰变） */
export function buildFloatingOak(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  const logs = trunk(world, column(0, 0, 5));
  const skip = new Set(["0,0"]);
  leafDisk(world, 0, 2, 0, 2, skip);
  leafDisk(world, 0, 3, 0, 2, skip);
  leafDisk(world, 0, 4, 0, 2, skip);
  leafDisk(world, 0, 5, 0, 1, skip);
  return { world, logs };
}

/** 圆石埋树干：橡树 + 树干下部被圆石围住（圆石 = 建筑方块，仍算异物；
 *  天然石头/泥土围堆 = 地形已不算异物——山坡真树场景，见 buildSlopeOak） */
export function buildBuriedTrunk(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 6);
  const logs = trunk(world, column(0, 0, 5));
  const cobbleCells: [number, number, number][] = [
    [1, 1, 0],
    [-1, 1, 0],
    [0, 1, 1],
    [0, 1, -1],
    [1, 2, 0],
    [-1, 2, 0],
    [0, 2, 1],
    [0, 2, -1],
    [1, 3, 0],
    [-1, 3, 0],
    [0, 3, 1],
    [0, 3, -1],
    [1, 1, 1],
    [-1, 1, -1],
  ];
  for (const [x = 0, y = 0, z = 0] of cobbleCells) world.set(x, y, z, "minecraft:cobblestone");
  const skip = new Set(["0,0"]);
  leafDisk(world, 0, 4, 0, 2, skip);
  leafDisk(world, 0, 5, 0, 2, skip);
  leafDisk(world, 0, 6, 0, 1, skip);
  return { world, logs };
}

/** 山坡橡树：橡树 + 坡面草方块/泥土在原木同层（地形——不算异物，游戏实测场景） */
export function buildSlopeOak(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 6);
  const logs = trunk(world, column(0, 0, 5));
  // 东坡坡面：y1-y2 的草方块/泥土（在原木同层 = 地形，非埋堆）
  for (const [x = 0, z = 0] of [
    [1, 0],
    [2, 0],
    [1, 1],
    [2, 1],
    [1, -1],
    [2, -1],
  ]) {
    world.set(x, 0, z, "minecraft:dirt");
    world.ground(x, 1, z);
  }
  world.ground(1, 2, 0);
  world.ground(2, 2, 0);
  world.ground(1, 2, 1);
  const skip = new Set(["0,0"]);
  leafDisk(world, 0, 2, 0, 2, skip);
  leafDisk(world, 0, 3, 0, 2, skip);
  leafDisk(world, 0, 4, 0, 2, skip);
  leafDisk(world, 0, 5, 0, 1, skip);
  return { world, logs };
}

/** 橡树 + 侧上方独立叶簇（窗口边缘、与树冠隔 2 格——邻树树冠混入场景：
 *  A 因子"主干连通团 ≥50% = 1"，不惩罚窗口截断） */
export function buildOakWithDetachedCap(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 6);
  const logs = trunk(world, column(0, 0, 5));
  const skip = new Set(["0,0"]);
  leafDisk(world, 0, 2, 0, 1, skip); // 主干树冠 r1 ×2 层（16 叶）
  leafDisk(world, 0, 3, 0, 1, skip);
  leafDisk(world, 3, 5, 0, 1, new Set(["3,0"])); // 独立叶簇（窗口内 6 叶，隔 2 格不连通）
  leafDisk(world, 3, 6, 0, 1, new Set(["3,0"]));
  return { world, logs };
}

/** 村庄小屋一角：柱 + 平铺树叶屋顶 + 木板墙（异物 → F 击杀） */
export function buildVillageHut(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 7);
  const logs = trunk(world, column(0, 0, 4));
  for (let y = 1; y <= 4; y++) {
    for (const [dx = 0, dz = 0] of [
      [1, 0],
      [2, 0],
      [-1, 0],
      [-2, 0],
      [0, 1],
      [0, 2],
      [0, -1],
      [0, -2],
    ]) {
      world.planks(dx, y, dz);
    }
  }
  const skip = new Set(["0,0", "1,0", "2,0", "-1,0", "-2,0", "0,1", "0,2", "0,-1", "0,-2"]);
  leafDisk(world, 0, 5, 0, 3, skip);
  leafDisk(world, 0, 6, 0, 3, skip);
  return { world, logs };
}

/** 3×3 原木小屋 + 树叶屋顶（超 2×2 横截面 → 提取整体丢弃，绝不砍建筑） */
export function buildLogCabin(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 7);
  const logs = trunk(
    world,
    [
      [0, 1, 0],
      [1, 1, 0],
      [2, 1, 0],
      [0, 1, 1],
      [2, 1, 1],
      [0, 1, 2],
      [1, 1, 2],
      [2, 1, 2],
      [0, 2, 0],
      [1, 2, 0],
      [2, 2, 0],
      [0, 2, 1],
      [2, 2, 1],
      [0, 2, 2],
      [1, 2, 2],
      [2, 2, 2],
      [0, 3, 0],
      [1, 3, 0],
      [2, 3, 0],
      [0, 3, 1],
      [2, 3, 1],
      [0, 3, 2],
      [1, 3, 2],
      [2, 3, 2],
    ],
    "oak"
  );
  const skip = new Set(["0,0", "1,0", "2,0", "0,1", "2,1", "0,2", "1,2", "2,2"]);
  leafDisk(world, 0, 4, 0, 2, skip);
  leafDisk(world, 0, 5, 0, 2, skip);
  return { world, logs };
}

/** 大树无树冠（2×2 柱） */
export function buildBigNoCanopy(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 5);
  const cells: [number, number, number][] = [];
  for (let y = 1; y <= 6; y++) {
    cells.push([0, y, 0], [1, y, 0], [0, y, 1], [1, y, 1]);
  }
  const logs = trunk(world, cells, "dark_oak");
  return { world, logs };
}

/** 大树 + 石顶（2×2 柱上盖石头——无树叶） */
export function buildBigStoneTop(): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 5);
  const cells: [number, number, number][] = [];
  for (let y = 1; y <= 6; y++) {
    cells.push([0, y, 0], [1, y, 0], [0, y, 1], [1, y, 1]);
  }
  const logs = trunk(world, cells, "dark_oak");
  world.stone(0, 7, 0);
  world.stone(1, 7, 0);
  world.stone(0, 7, 1);
  world.stone(1, 7, 1);
  return { world, logs };
}
