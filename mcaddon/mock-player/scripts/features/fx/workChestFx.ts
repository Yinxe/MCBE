// ─── 工作箱粒子特效（合并自 v3 WorkChestFx，纯表现层） ──────
// 用途：物品入容器时的金色闪光 + 搬运光束（钓鱼自动存入容器等场景）。
// 只做视觉与音效，不影响任何逻辑；16 格内没有玩家时直接跳过（省性能）。
import { MolangVariableMap, world } from "@minecraft/server";
import type { Dimension } from "@minecraft/server";

/** 粒子 id（RP：particles/mockplayer/workchest.particle.json） */
const PARTICLE_ID = "mockplayer:workchest";
/** 音效 id 与参数（沿用 v3 原值） */
const SOUND_ID = "random.orb";
const SOUND_PITCH = 0.65;
const SOUND_VOLUME = 0.35;
/** 声音可听半径（格） */
const SOUND_RANGE = 16;
/** 闪光参数（金色） */
const FLASH_COLOR = { r: 1, g: 0.84, b: 0 };
const FLASH_SIZE = 1;
const FLASH_OFF_H = -0.475;
const FLASH_Y = 0.455;
/** 光束参数（淡蓝） */
const BEAM_COLOR = { r: 0.53, g: 0.81, b: 0.92 };
const BEAM_SIZE = 0.35;
const BEAM_STEP = 0.5;
const BEAM_MAX_POINTS = 48;

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** 构造带颜色的 Molang 变量（对齐 workchest 粒子定义里的变量名） */
function makeMolang(c: { r: number; g: number; b: number }, size: number, offH: number): MolangVariableMap {
  const m = new MolangVariableMap();
  m.setFloat("size", size);
  m.setFloat("size_w", size);
  m.setFloat("size_l", size);
  m.setFloat("size_h", size);
  m.setFloat("off_h", offH);
  m.setFloat("color_r", c.r);
  m.setFloat("color_g", c.g);
  m.setFloat("color_b", c.b);
  return m;
}

/** 取维度（失败返回 undefined） */
function dimensionOf(id: string): Dimension | undefined {
  try {
    return world.getDimension(id);
  } catch {
    return undefined;
  }
}

/** 该维度 16 格内是否有玩家（没有就不播，省性能） */
function hasPlayersNear(dim: Dimension, center: Vec3Like): boolean {
  try {
    for (const p of dim.getPlayers()) {
      const d = Math.hypot(p.location.x - center.x, p.location.y - center.y, p.location.z - center.z);
      if (d <= SOUND_RANGE) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** 向附近玩家播放音效（失败静默） */
function playSoundNear(dim: Dimension, center: Vec3Like): void {
  try {
    for (const p of dim.getPlayers()) {
      const d = Math.hypot(p.location.x - center.x, p.location.y - center.y, p.location.z - center.z);
      if (d > SOUND_RANGE) continue;
      try {
        p.playSound(SOUND_ID, { location: center, pitch: SOUND_PITCH, volume: SOUND_VOLUME });
      } catch {
        /* 单个玩家失败不中断 */
      }
    }
  } catch {
    /* 忽略 */
  }
}

/** 容器闪光：物品入箱时在箱子位置播金色闪光 + 音效（16 格内无玩家则跳过） */
export function playChestFlash(dimensionId: string, cell: Vec3Like): void {
  const dim = dimensionOf(dimensionId);
  if (!dim) return;
  const center = { x: cell.x + 0.5, y: cell.y + FLASH_Y, z: cell.z + 0.5 };
  if (!hasPlayersNear(dim, center)) return;
  try {
    dim.spawnParticle(PARTICLE_ID, center, makeMolang(FLASH_COLOR, FLASH_SIZE, FLASH_OFF_H));
    playSoundNear(dim, center);
  } catch {
    /* 粒子失败不影响主流程 */
  }
}

/** 搬运光束：从 from 到 to 画一条淡蓝点线（同维度调用；16 格内无玩家则跳过） */
export function playTransferBeam(dimensionId: string, from: Vec3Like, to: Vec3Like): void {
  const dim = dimensionOf(dimensionId);
  if (!dim) return;
  if (!hasPlayersNear(dim, from)) return;
  const total = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const steps = Math.min(Math.ceil(total / BEAM_STEP), BEAM_MAX_POINTS);
  if (steps <= 0) return;
  const molang = makeMolang(BEAM_COLOR, BEAM_SIZE, 0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    try {
      dim.spawnParticle(
        PARTICLE_ID,
        { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t },
        molang,
      );
    } catch {
      return;
    }
  }
}