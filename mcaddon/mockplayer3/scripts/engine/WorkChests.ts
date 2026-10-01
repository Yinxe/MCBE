// ─── 工作箱注册表（DP 单键 mp:wchest）与箱子探查 ──────────────────
// 注册表 = { 箱id: WorkChestInfo } 的 JSON 单键（条目数量级为个位数，远小于 F-24 上限）。
// 读侧惰性加载进缓存，写侧缓存与 DP 同步落；DP 读写须在 system 上下文（面板提交/巡检均满足）。
// 箱 id 由"维度+箱原点"生成：大箱两半点击都归一到同一原点（chestOrigin 逐轴取最小）。

import { readJson, writeJson, removeKey } from "./Dp";
import type { Vec3 } from "../domain/Coords";
import type { WorkChestInfo } from "../domain/WorkChest";
import { chestOrigin, isPlainChestType, isWorkChestShape, workChestId } from "../domain/WorkChest";
import { blockFloor, dimensionOf } from "./Atomic";

/** 注册表 DP 键 */
const REGISTRY_KEY = "mp:wchest";

/** 箱子探查结论（ok=可作工作箱；not-chest=确定不是普通木头箱子；unreadable=区块/组件读不到） */
export type ChestProbe =
  | { status: "ok"; size: number; origin: Vec3; partner: Vec3 | null; chestId: string }
  | { status: "not-chest" }
  | { status: "unreadable" };

/** 大箱配对搜索的水平 4 邻偏移 */
const H_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** 该格取容器 size（非箱子/未加载/无组件 → undefined） */
function chestContainerSize(dimId: string, cell: Vec3): number | undefined {
  const dim = dimensionOf(dimId);
  if (!dim) return undefined;
  try {
    const block = dim.getBlock(cell);
    if (!block || !isPlainChestType(block.typeId)) return undefined;
    return block.getComponent("minecraft:inventory")?.container?.size;
  } catch {
    return undefined;
  }
}

/**
 * 箱子探查（面板注册工作箱入口用）。
 * size 54=大箱：在水平 4 邻找同为普通箱且容器 54 的伙伴半；伙伴读不到时按
 * 点击格自身作原点（另一半加载后仍会因新原点再建条目——同箱双条目属可容忍的
 * 登记噪声，搬运各自只认自己那条，物品不丢）。
 */
export function probeWorkChest(dimId: string, loc: Vec3): ChestProbe {
  const cell = blockFloor(loc);
  const size = chestContainerSize(dimId, cell);
  if (size === undefined) {
    const dim = dimensionOf(dimId);
    if (!dim) return { status: "not-chest" };
    try {
      const block = dim.getBlock(cell);
      // 方块读到了但不是箱子 → 确定排除；读不到（未加载）→ 瞬态
      if (block) return { status: "not-chest" };
    } catch {
      /* 区块未加载 */
    }
    return { status: "unreadable" };
  }
  if (size <= 27) return { status: "ok", size, origin: cell, partner: null, chestId: workChestId(dimId, cell) };
  for (const [dx, dz] of H_OFFSETS) {
    const partner = { x: cell.x + dx, y: cell.y, z: cell.z + dz };
    if (chestContainerSize(dimId, partner) === 54) {
      const origin = chestOrigin(cell, partner);
      return { status: "ok", size, origin, partner, chestId: workChestId(dimId, origin) };
    }
  }
  return { status: "ok", size, origin: cell, partner: null, chestId: workChestId(dimId, cell) };
}

class WorkChestRegistry {
  private cache: Map<string, WorkChestInfo> | null = null;

  private load(): Map<string, WorkChestInfo> {
    if (this.cache) return this.cache;
    const map = new Map<string, WorkChestInfo>();
    const raw = readJson<Record<string, unknown>>(REGISTRY_KEY) ?? {};
    for (const [id, value] of Object.entries(raw)) {
      if (!isWorkChestShape(value)) {
        console.error(`[mockplayer3] 工作箱注册表条目 ${id} 形状非法已跳过`);
        continue;
      }
      map.set(id, value);
    }
    this.cache = map;
    return map;
  }

  private flush(map: Map<string, WorkChestInfo>): void {
    this.cache = map;
    const raw: Record<string, WorkChestInfo> = {};
    for (const [id, chest] of map) raw[id] = chest;
    writeJson(REGISTRY_KEY, raw);
  }

  /** 全部注册箱（面板展示/巡检查绑定用；调用须在 system 上下文） */
  all(): WorkChestInfo[] {
    return [...this.load().values()];
  }

  get(id: string): WorkChestInfo | undefined {
    return this.load().get(id);
  }

  /** 登记/改名：同 id 整条目覆写（绑定引用 id，覆写不影响已绑记录） */
  upsert(chest: WorkChestInfo): void {
    const map = new Map(this.load());
    map.set(chest.id, chest);
    this.flush(map);
  }

  /** 注销箱（假人绑定不随注销解除——巡检查不到条目按"箱丢失"告警处理） */
  remove(id: string): void {
    if (!this.load().has(id)) return;
    const map = new Map(this.load());
    map.delete(id);
    this.flush(map);
  }

  /** 删除假人时的联动清理入口：按 id 摘条目并返回被摘条目（调用方决定是否解除绑定） */
  take(id: string): WorkChestInfo | undefined {
    const hit = this.get(id);
    if (hit) this.remove(id);
    return hit;
  }
}

/** 进程级单例 */
export const workChests = new WorkChestRegistry();
