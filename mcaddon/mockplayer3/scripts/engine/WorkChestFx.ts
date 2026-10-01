// ─── 工作箱视觉/听觉反馈（粒子参数与音效口径照抄 item-route SortEffects） ──
// 粒子 RP identifier：mockplayer:workchest（尺寸/高度/颜色走 molang 变量，同款 v1 光效）。
// 输入闪光金色=与 item-route input 角色同色（R1.0 G0.84 B0.0）；搬运连线天蓝色。
// 音效 random.orb（pitch 0.65 / volume 0.35），向 16 格内玩家显式播报。
// 无玩家在场整批跳过（省引擎粒子调用，口径与 item-route 一致）；
// 所有 spawn/play 逐点 try-catch——粒子生成失败只影响观感，绝不影响搬运流程。

import { MolangVariableMap } from "@minecraft/server";
import type { Vec3 } from "../domain/Coords";
import { blockFloor, dimensionOf } from "./Atomic";

/** RP 粒子标识（particles/mockplayer/workchest.particle.json） */
export const WORKCHEST_PARTICLE = "mockplayer:workchest";

/** 输入闪光音效（item-route 同款：低音量轻滴一声） */
const FX_SOUND = "random.orb";
const FX_PITCH = 0.65;
const FX_VOLUME = 0.35;
/** 音效可闻半径（格） */
const SOUND_RANGE = 16;

/** 箱子（非完整方块）粒子尺寸与高度偏移（item-route CHEST 口径） */
const CHEST_SIZE = 1.0;
const CHEST_OFF_H = -0.475;
/** 粒子贴方块面高度 */
const PARTICLE_Y = 0.455;

/** 输入闪光金色（item-route input 角色同款） */
const FLASH_COLOR = { r: 1.0, g: 0.84, b: 0.0 };
/** 搬运连线天蓝（item-route multi 角色同款，缩小后沿线连点） */
const BEAM_COLOR = { r: 0.53, g: 0.81, b: 0.92 };
const BEAM_SIZE = 0.35;

/** 连线采样步长（格）与单条线点数上限（超上限只画前段，距离极端时观感降级不影响功能） */
const BEAM_STEP = 0.5;
const BEAM_MAX_POINTS = 48;

/** 光效 molang（size/off_h/color_* 变量口径与 item-route roleMolang 一致） */
function makeMolang(color: { r: number; g: number; b: number }, size: number, offH: number): MolangVariableMap {
  const m = new MolangVariableMap();
  m.setFloat("size", size);
  m.setFloat("size_w", size);
  m.setFloat("size_l", size);
  m.setFloat("size_h", size);
  m.setFloat("off_h", offH);
  m.setFloat("color_r", color.r);
  m.setFloat("color_g", color.g);
  m.setFloat("color_b", color.b);
  return m;
}

/** 维度内有无玩家（无玩家不播；判据异常按"有"保守处理也无伤大雅——直接 try 内判） */
function hasPlayers(dimId: string): { dim: ReturnType<typeof dimensionOf>; players: number } {
  const dim = dimensionOf(dimId);
  if (!dim) return { dim: undefined, players: 0 };
  try {
    return { dim, players: dim.getPlayers().length };
  } catch {
    return { dim, players: 0 };
  }
}

/** 向粒子坐标附近玩家显式播放音效（player.playSound 带位置；逐个 try-catch） */
function playSoundNearby(dim: NonNullable<ReturnType<typeof dimensionOf>>, center: Vec3): void {
  try {
    for (const p of dim.getPlayers()) {
      const d = Math.hypot(p.location.x - center.x, p.location.y - center.y, p.location.z - center.z);
      if (d > SOUND_RANGE) continue;
      try {
        p.playSound(FX_SOUND, { location: center, pitch: FX_PITCH, volume: FX_VOLUME });
      } catch {
        /* 玩家瞬态：跳过 */
      }
    }
  } catch {
    /* 玩家列表不可读：不播 */
  }
}

/**
 * 箱子输入闪光：逐占用格（大箱双半）播一次金色光效 + 一声轻滴。
 * 未加载格自动跳过；任何异常都吞掉——搬运结果与光效无关。
 */
export function chestInputFlash(dimId: string, cells: Vec3[]): void {
  const { dim, players } = hasPlayers(dimId);
  if (!dim || players === 0) return;
  const molang = makeMolang(FLASH_COLOR, CHEST_SIZE, CHEST_OFF_H);
  let sounded = false;
  for (const raw of cells) {
    const cell = blockFloor(raw);
    try {
      const block = dim.getBlock(cell);
      if (!block) continue;
      const center: Vec3 = { x: cell.x + 0.5, y: cell.y + PARTICLE_Y, z: cell.z + 0.5 };
      dim.spawnParticle(WORKCHEST_PARTICLE, center, molang);
      if (!sounded) {
        playSoundNearby(dim, center);
        sounded = true;
      }
    } catch {
      continue; // 粒子失败只影响观感
    }
  }
}

/**
 * 假人→工作箱的粒子连线：两点间按 BEAM_STEP 采样天蓝小光点。
 * 全程吞异常；调用方（搬运巡检）每拍重画即可形成"在途"观感。
 */
export function transferBeam(dimId: string, from: Vec3, to: Vec3): void {
  const { dim, players } = hasPlayers(dimId);
  if (!dim || players === 0) return;
  const molang = makeMolang(BEAM_COLOR, BEAM_SIZE, 0);
  const total = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const steps = Math.min(Math.ceil(total / BEAM_STEP), BEAM_MAX_POINTS);
  if (steps <= 0) return;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    try {
      dim.spawnParticle(
        WORKCHEST_PARTICLE,
        { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t },
        molang
      );
    } catch {
      return; // 中途失败即止（多为区块边缘），不影响调用方
    }
  }
}
