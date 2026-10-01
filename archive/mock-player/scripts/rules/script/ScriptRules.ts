// ─── 编程模式规则（core 层纯逻辑） ────────────────────────
// 职责：模块目录 / 文本规格解析 / 参数校验 / 存档归一化 / 中文描述。
// 零 @minecraft 依赖，可 node 单测。
//
// 模块清单与用户方案（编程模式设计方案 v0.3）对齐，首批只做执行器已支持的
// 12 种；界面「选分类 → 选模块」与命令文本解析共用同一份定义，避免两处漂移。
import { MAX_SCRIPT_STEPS, type ScriptCoord, type ScriptProgram, type ScriptStep } from "../Types";

/** 等待上限（tick）：1 小时 */
export const MAX_WAIT_TICKS = 20 * 3600;
/** 单条攻击次数上限 */
export const MAX_ATTACK_COUNT = 500;
/** 说话文本长度上限 */
export const MAX_SAY_LENGTH = 200;
/** 坐标绝对值上限（世界边界 ±3000 万） */
export const MAX_COORD = 3e7;
/** 循环次数上限（防误填把服务器拖死） */
export const MAX_LOOP_COUNT = 9999;

/** 模块关键词速查（帮助与报错提示共用） */
export const SCRIPT_KEYWORD_HELP =
  "走到 x y z / 等待 秒 / 挖掘 x y z / 挖前方 / 放置 x y z / 使用物品 / 攻击 次数 / 说话 文本 / 看 x y z / 潜行开 / 潜行关 / 跳一下 / 跳转 序号";

// ─── 模块目录（界面与解析同源） ──────────────────────────
/** 参数形态：coord=坐标 / num=数量 / text=文本 / none=无参数 / toggle=开关 */
export type ScriptParamKind = "coord" | "coordOptional" | "num" | "text" | "none";

/** 编程模式模块定义（界面「选分类 → 选模块」直接遍历此表） */
export interface ScriptModuleDef {
  /** 模块 id（界面对外标识；sneak 拆成开/关两条） */
  id: string;
  /** 分类名（方案 v0.3 的九类） */
  cat: string;
  /** 界面显示名 */
  label: string;
  /** 参数形态：coord=必须填坐标 / coordOptional=可留空的坐标 / num=数量 / text=文本 / none=无参数 */
  param: ScriptParamKind;
  /** 写入指令时的 type */
  stepType: ScriptStep["type"];
  /** 固定参数（潜行开/关这类无输入但有固定值的模块） */
  fixed?: { on: boolean };
}

/** 编程模式模块目录（13 项，对应执行器支持的 12 种 type） */
export const SCRIPT_MODULES: readonly ScriptModuleDef[] = [
  { id: "moveTo", cat: "移动", label: "走到坐标", param: "coord", stepType: "moveTo" },
  { id: "wait", cat: "等待", label: "等待 N 秒", param: "num", stepType: "wait" },
  { id: "mine", cat: "方块", label: "挖掘·指定坐标", param: "coord", stepType: "mine" },
  { id: "mineLook", cat: "方块", label: "挖掘·前方（可指定坐标）", param: "coordOptional", stepType: "mineLook" },
  { id: "place", cat: "方块", label: "放置方块", param: "coord", stepType: "place" },
  { id: "useItem", cat: "交互", label: "使用物品一次（可指定坐标）", param: "coordOptional", stepType: "useItem" },
  { id: "attack", cat: "战斗", label: "攻击 N 次", param: "num", stepType: "attack" },
  { id: "look", cat: "姿态", label: "看向坐标", param: "coord", stepType: "look" },
  { id: "sneakOn", cat: "姿态", label: "潜行开（可指定坐标）", param: "coordOptional", stepType: "sneak", fixed: { on: true } },
  { id: "sneakOff", cat: "姿态", label: "潜行关（可指定坐标）", param: "coordOptional", stepType: "sneak", fixed: { on: false } },
  { id: "hop", cat: "姿态", label: "跳一下（可指定坐标）", param: "coordOptional", stepType: "hop" },
  { id: "say", cat: "通信", label: "说话", param: "text", stepType: "say" },
  { id: "jump", cat: "流程", label: "跳转到第 N 条", param: "num", stepType: "jump" },
];

/** 分类名列表（保持定义顺序） */
export const SCRIPT_CATEGORIES: readonly string[] = [
  ...new Set(SCRIPT_MODULES.map((m) => m.cat)),
];

/** 按分类取模块 */
export function modulesOfCategory(cat: string): readonly ScriptModuleDef[] {
  return SCRIPT_MODULES.filter((m) => m.cat === cat);
}

/** 按 id 取模块定义 */
export function moduleById(id: string): ScriptModuleDef | undefined {
  return SCRIPT_MODULES.find((m) => m.id === id);
}

// ─── 基础转换 ────────────────────────────────────────────
/** 数字容错转换：数字 / 数字字符串 → number；非法 → undefined */
function toNum(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** 坐标是否在世界范围内 */
function isValidCoord(v: number): boolean {
  return v >= -MAX_COORD && v <= MAX_COORD;
}

// ─── 循环设置 ────────────────────────────────────────────
/** 循环次数归一化：-1 = 一直；>=1 = N 次（上限 9999）；其余 → 1 */
export function normalizeLoopCountValue(value: unknown): number {
  const n = toNum(value);
  if (n === undefined) return 1;
  const i = Math.trunc(n);
  if (i === -1) return -1;
  if (i >= 1) return Math.min(i, MAX_LOOP_COUNT);
  return 1;
}

/** 循环设置文本输入解析（一直/forever/-1、关/off/一次/1、数字）；非法 → undefined */
export function parseLoopCountInput(input: string): number | undefined {
  const t = input.trim().toLowerCase();
  if (t.length === 0) return undefined;
  if (t === "一直" || t === "forever" || t === "-1") return -1;
  if (t === "关" || t === "off" || t === "一次" || t === "1") return 1;
  const n = toNum(t);
  if (n === undefined) return undefined;
  const i = Math.trunc(n);
  if (i >= 2) return Math.min(i, MAX_LOOP_COUNT);
  if (i === -1) return -1;
  return undefined;
}

/** 循环次数 → 中文（命令 / 界面 / 提示统一走这里） */
export function describeLoopCount(loop: number): string {
  if (loop < 0) return "一直循环";
  if (loop === 1) return "只跑一遍";
  return `循环 ${loop} 次`;
}

// ─── 存档归一化 ──────────────────────────────────────────
/** 解析可选 look 坐标（存在且合法才返回；坐标一律向下取整） */
function parseLook(raw: unknown): ScriptCoord | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const x = toNum(o.x);
  const y = toNum(o.y);
  const z = toNum(o.z);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  if (!isValidCoord(x) || !isValidCoord(y) || !isValidCoord(z)) return undefined;
  return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
}

/** 单条指令归一化（存档读入校验）；非法 → undefined（丢弃该条） */
function normalizeScriptStepCore(raw: unknown): ScriptStep | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const t = o.type;
  if (t === "moveTo" || t === "mine" || t === "place" || t === "look") {
    const x = toNum(o.x);
    const y = toNum(o.y);
    const z = toNum(o.z);
    if (x === undefined || y === undefined || z === undefined) return undefined;
    if (!isValidCoord(x) || !isValidCoord(y) || !isValidCoord(z)) return undefined;
    if (t === "moveTo") return { type: "moveTo", x, y, z };
    if (t === "mine") return { type: "mine", x, y, z };
    if (t === "place") return { type: "place", x, y, z };
    return { type: "look", x, y, z };
  }
  if (t === "wait") {
    const ticks = toNum(o.ticks);
    if (ticks === undefined || ticks < 1) return undefined;
    return { type: "wait", ticks: Math.min(Math.round(ticks), MAX_WAIT_TICKS) };
  }
  if (t === "mineLook") {
    const look = parseLook(o.look);
    return look ? { type: "mineLook", look } : { type: "mineLook" };
  }
  if (t === "useItem") {
    const look = parseLook(o.look);
    return look ? { type: "useItem", look } : { type: "useItem" };
  }
  if (t === "hop") {
    const look = parseLook(o.look);
    return look ? { type: "hop", look } : { type: "hop" };
  }
  if (t === "attack") {
    const count = toNum(o.count);
    if (count === undefined || count < 1) return undefined;
    return { type: "attack", count: Math.min(Math.round(count), MAX_ATTACK_COUNT) };
  }
  if (t === "say") {
    if (typeof o.text !== "string" || o.text.length === 0) return undefined;
    return { type: "say", text: o.text.slice(0, MAX_SAY_LENGTH) };
  }
  if (t === "sneak") {
    if (typeof o.on !== "boolean") return undefined;
    const look = parseLook(o.look);
    return look ? { type: "sneak", on: o.on, look } : { type: "sneak", on: o.on };
  }
  if (t === "jump") {
    const target = toNum(o.target);
    if (target === undefined || target < 1) return undefined;
    return { type: "jump", target: Math.min(Math.round(target), MAX_SCRIPT_STEPS) };
  }
  return undefined;
}
/** 脚本条目归一化（对外唯一入口；统一携带注释字段） */
export function normalizeScriptStep(raw: unknown): ScriptStep | undefined {
  const s = normalizeScriptStepCore(raw);
  if (!s) return undefined;
  const o = raw as Record<string, unknown>;
  const note = typeof o.note === "string" ? o.note.trim() : "";
  if (note.length) s.note = note.slice(0, 100);
  return s;
}
/** 脚本归一化（存档读入 / 命令与界面写入前统一走这里） */
export function normalizeScriptProgram(raw: unknown): ScriptProgram {
  if (!raw || typeof raw !== "object") return { steps: [], loopCount: 1 };
  const o = raw as Record<string, unknown>;
  const steps: ScriptStep[] = [];
  if (Array.isArray(o.steps)) {
    for (const item of o.steps) {
      const s = normalizeScriptStep(item);
      if (s) steps.push(s);
      if (steps.length >= MAX_SCRIPT_STEPS) break;
    }
  }
  return { steps, loopCount: normalizeLoopCountValue(o.loopCount) };
}

// ─── 文本规格解析（命令 add 用） ─────────────────────────
/** 模块关键词（长词优先，避免「挖」抢走「挖前方」） */
const MODULE_KEYWORDS: readonly string[] = [
  "挖前方", "挖前", "使用物品", "跳一下", "潜行开", "潜行关",
  "走到", "等待", "挖掘", "放置", "使用", "攻击", "说话", "看向", "潜行", "跳跃", "跳转", "看",
  "minelook", "minefront", "useitem", "sneakon", "sneakoff",
  "moveto", "move", "wait", "mine", "place", "use", "attack",
  "say", "look", "sneak", "hop", "goto", "jump", "go",
].slice().sort((a, b) => b.length - a.length);

/** 从首个 token 切出关键词与粘连参数（支持「走到100 64 200」连写） */
function extractKeyword(raw: string): { kw: string; rest: string } {
  const lower = raw.toLowerCase();
  for (const k of MODULE_KEYWORDS) {
    if (raw.startsWith(k)) return { kw: k, rest: raw.slice(k.length) };
    if (/^[a-z]+$/.test(k) && lower.startsWith(k)) return { kw: k, rest: raw.slice(k.length) };
  }
  return { kw: raw, rest: "" };
}

/** 文本规格 → 单条指令；失败返回中文 error */
export function parseScriptSpec(spec: string): { step: ScriptStep } | { error: string } {
  const tokens = spec.trim().split(/\s+/).filter((s) => s.length > 0);
  const first = tokens[0];
  if (!first) return { error: "缺少模块关键词" };

  const { kw, rest } = extractKeyword(first);
  const kwLower = kw.toLowerCase();
  const args: string[] = rest.length > 0 ? [rest, ...tokens.slice(1)] : tokens.slice(1);

  /** 解析三个坐标参数（支持 (x,y,z) 与中文逗号） */
  const coord3 = (): { x: number; y: number; z: number } | string => {
    let a0 = args[0];
    let a1 = args[1];
    let a2 = args[2];
    if (a0 !== undefined && a1 === undefined && a2 === undefined && /[，,]/.test(a0)) {
      const parts = a0
        .replace(/[()（）]/g, "")
        .split(/[，,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      a0 = parts[0];
      a1 = parts[1];
      a2 = parts[2];
    }
    const x = toNum(a0);
    const y = toNum(a1);
    const z = toNum(a2);
    if (x === undefined || y === undefined || z === undefined) return "需要 3 个数字参数（x y z）";
    if (!isValidCoord(x) || !isValidCoord(y) || !isValidCoord(z)) return "坐标超出世界范围";
    return { x, y, z };
  };

  if (kw === "走到" || kwLower === "move" || kwLower === "moveto" || kwLower === "go") {
    const c = coord3();
    if (typeof c === "string") return { error: `走到：${c}` };
    return { step: { type: "moveTo", x: c.x, y: c.y, z: c.z } };
  }
  if (kw === "等待" || kwLower === "wait") {
    const sec = toNum(args[0]);
    if (sec === undefined || sec <= 0) return { error: "等待：需要秒数（正数）" };
    const ticks = Math.round(sec * 20);
    if (ticks < 1) return { error: "等待：至少 0.05 秒" };
    if (ticks > MAX_WAIT_TICKS) return { error: "等待：最长为 3600 秒" };
    return { step: { type: "wait", ticks } };
  }
  if (kw === "挖掘" || kwLower === "mine") {
    const c = coord3();
    if (typeof c === "string") return { error: `挖掘：${c}` };
    return { step: { type: "mine", x: c.x, y: c.y, z: c.z } };
  }
  if (kw === "挖前方" || kw === "挖前" || kwLower === "minelook" || kwLower === "minefront") {
    return { step: { type: "mineLook" } };
  }
  if (kw === "放置" || kwLower === "place") {
    const c = coord3();
    if (typeof c === "string") return { error: `放置：${c}` };
    return { step: { type: "place", x: c.x, y: c.y, z: c.z } };
  }
  if (kw === "使用物品" || kw === "使用" || kwLower === "use" || kwLower === "useitem") {
    return { step: { type: "useItem" } };
  }
  if (kw === "攻击" || kwLower === "attack") {
    const n = toNum(args[0]);
    if (n === undefined || n < 1) return { error: "攻击：需要次数（正整数）" };
    const count = Math.round(n);
    if (count < 1 || count > MAX_ATTACK_COUNT) {
      return { error: `攻击：次数需在 1-${MAX_ATTACK_COUNT} 之间` };
    }
    return { step: { type: "attack", count } };
  }
  if (kw === "说话" || kwLower === "say") {
    const text = args.join(" ").trim();
    if (text.length === 0) return { error: "说话：需要文本内容" };
    if (text.length > MAX_SAY_LENGTH) return { error: `说话：文本最长 ${MAX_SAY_LENGTH} 字` };
    return { step: { type: "say", text } };
  }
  if (kw === "看" || kw === "看向" || kwLower === "look") {
    const c = coord3();
    if (typeof c === "string") return { error: `看：${c}` };
    return { step: { type: "look", x: c.x, y: c.y, z: c.z } };
  }
  if (kw === "潜行开" || kwLower === "sneakon") return { step: { type: "sneak", on: true } };
  if (kw === "潜行关" || kwLower === "sneakoff") return { step: { type: "sneak", on: false } };
  if (kw === "潜行" || kwLower === "sneak") {
    const v = (args[0] ?? "").toLowerCase();
    if (v === "开" || v === "on" || v === "true" || v === "1") return { step: { type: "sneak", on: true } };
    if (v === "关" || v === "off" || v === "false" || v === "0") return { step: { type: "sneak", on: false } };
    return { error: "潜行：需要参数 开/关" };
  }
  if (kw === "跳一下" || kw === "跳跃" || kwLower === "hop") return { step: { type: "hop" } };
  if (kw === "跳转" || kwLower === "goto" || kwLower === "jump") {
    const n = toNum(args[0]);
    if (n === undefined || n < 1) return { error: "跳转：需要目标序号（≥1）" };
    const target = Math.round(n);
    if (target < 1 || target > MAX_SCRIPT_STEPS) {
      return { error: `跳转：序号需在 1-${MAX_SCRIPT_STEPS} 之间` };
    }
    return { step: { type: "jump", target } };
  }
  return { error: `未知模块「${kw}」（可用：${SCRIPT_KEYWORD_HELP}）` };
}

// ─── 中文描述 ────────────────────────────────────────────
/** 数字显示：最多两位小数 */
function fmtNum(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** tick → 秒显示 */
function fmtSeconds(ticks: number): string {
  return String(Math.round((ticks / 20) * 10) / 10);
}

/** 坐标 → 显示文本 */
function fmtCoord(c: ScriptCoord): string {
  return `(${fmtNum(c.x)},${fmtNum(c.y)},${fmtNum(c.z)})`;
}

/** 单条指令 → 中文描述（列表 / 日志 / 通知统一走这里） */
export function describeStep(step: ScriptStep): string {
  switch (step.type) {
    case "moveTo":
      return `走到 ${fmtCoord(step)}`;
    case "wait":
      return `等待 ${fmtSeconds(step.ticks)} 秒`;
    case "mine":
      return `挖掘 ${fmtCoord(step)}`;
    case "mineLook":
      return step.look ? `挖掘·对准 ${fmtCoord(step.look)}` : "挖掘前方方块";
    case "place":
      return `放置 ${fmtCoord(step)}`;
    case "useItem":
      return step.look ? `使用物品·对准 ${fmtCoord(step.look)}` : "使用物品";
    case "attack":
      return `攻击 ${step.count} 次`;
    case "say":
      return `说话 "${step.text}"`;
    case "look":
      return `看向 ${fmtCoord(step)}`;
    case "sneak":
      return `${step.on ? "潜行开" : "潜行关"}${step.look ? ` · 对准 ${fmtCoord(step.look)}` : ""}`;
    case "hop":
      return step.look ? `跳一下 · 对准 ${fmtCoord(step.look)}` : "跳一下";
    case "jump":
      return `跳转到第 ${step.target} 条`;
  }
}

/** 把当前脚本压缩成一行文本规格（界面「文本编辑」预填用） */
export function programToSpecText(program: ScriptProgram): string {
  return program.steps
    .map((s) => {
      switch (s.type) {
        case "moveTo":
          return `走到 ${fmtNum(s.x)} ${fmtNum(s.y)} ${fmtNum(s.z)}`;
        case "wait":
          return `等待 ${fmtSeconds(s.ticks)}`;
        case "mine":
          return `挖掘 ${fmtNum(s.x)} ${fmtNum(s.y)} ${fmtNum(s.z)}`;
        case "mineLook":
          return "挖前方";
        case "place":
          return `放置 ${fmtNum(s.x)} ${fmtNum(s.y)} ${fmtNum(s.z)}`;
        case "useItem":
          return "使用物品";
        case "attack":
          return `攻击 ${s.count}`;
        case "say":
          return `说话 ${s.text}`;
        case "look":
          return `看 ${fmtNum(s.x)} ${fmtNum(s.y)} ${fmtNum(s.z)}`;
        case "sneak":
          return s.on ? "潜行开" : "潜行关";
        case "hop":
          return "跳一下";
        case "jump":
          return `跳转 ${s.target}`;
      }
    })
    .join(" ");
}
