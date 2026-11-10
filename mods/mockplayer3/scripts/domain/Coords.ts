// ─── 几何与坐标解析（domain 纯逻辑） ──────────────────────────────
// 本地向量类型（domain 零 @minecraft）+ 坐标串解析（面板文本输入用：
// ~ 相对/全角容错——命令层参数已是原生 Param.Location，引擎负责展开）。

/** 三维向量（数值接口；engine 层与 @minecraft/server 的 Vector3 互转） */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 二维角向量（pitch/yaw 等） */
export interface Vec2 {
  x: number;
  y: number;
}

// ─── 纯几何工具 ──

/** 水平距离（忽略 Y；导航到达判定用，F-14） */
export function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** 三维欧氏距离 */
export function distance3d(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** 方块取整坐标（location → BlockShape：负半轴正确向下取整） */
export function toBlockLocation(p: Vec3): Vec3 {
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

/** 区块坐标（floor/16） */
export function toChunkLocation(p: Vec3): Vec2 {
  return { x: Math.floor(p.x / 16), y: Math.floor(p.z / 16) };
}

/** 从 yaw（度）导出水平朝向单位向量（bedrock yaw：0=+Z? 采用 -sin/-cos 常规） */
export function yawToDirection(yawDeg: number): { x: number; z: number } {
  const r = (yawDeg * Math.PI) / 180;
  return { x: -Math.sin(r), z: Math.cos(r) };
}

// ─── 坐标串解析（面板文本输入；F-22 容错全集） ──

/** 坐标解析结果：三数值或 null（非法）；~ 相对量以 origin 展开 */
export interface ParsedCoord {
  x: number;
  y: number;
  z: number;
}

const FULLWIDTH_SPACE = "\u3000";

/**
 * 解析 "x y z" / "~ ~ ~" / "~10 ~-3 ~" 风格坐标串。
 * 容错：括号包裹、中英文逗号、全角空格、parseFloat 宽容尾缀（"64x"→64）。
 * @param raw - 命令参数原文
 * @param origin - ~ 展开的基准坐标（执行者位置）
 * @returns 解析结果；非法返回中文错误串（轻校验策略）
 */
export function parseCoordString(raw: string, origin: Vec3): { value?: ParsedCoord; error?: string } {
  let normalized = raw
    .trim()
    .replace(/^[([【]/, "")
    .replace(/[)\]】]$/, "");
  normalized = normalized.replace(/[，,]/g, " ").replace(new RegExp(FULLWIDTH_SPACE, "g"), " ").trim();
  if (!normalized) return { error: "坐标不能为空" };
  const parts = normalized.split(/\s+/);
  if (parts.length !== 3) return { error: "坐标需为三个分量（如 ~ ~ ~ 或 100 64 -200）" };
  const bases = [origin.x, origin.y, origin.z];
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const token = parts[i]!;
    const isRelative = token.startsWith("~");
    const body = isRelative ? token.slice(1) : token;
    const num = body === "" ? 0 : parseFloat(body);
    if (!Number.isFinite(num)) return { error: `坐标分量 ${token} 不是合法数字` };
    out.push(isRelative ? bases[i]! + num : num);
  }
  return { value: { x: out[0]!, y: out[1]!, z: out[2]! } };
}
