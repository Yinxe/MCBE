// ─── 自定义动作：动作表模型与文本规格（domain 纯逻辑） ──────────────────
// 一段动作表 = 有序动作 + 整段循环设置 + 失败策略；动作共 12 种动作。
// 三种输入源共用同一份归一化：命令文本规格、面板文本编辑、存档读回——
// 解析与校验只写在这里，界面与命令不得各自解释（防两处漂移）。

// ─── 上限（防误填把服务器拖死） ────────────────────────────────────

/** 动作表条数上限 */
export const MAX_ACTIONS = 256;
/** 动作备注长度上限 */
export const MAX_NOTE_LENGTH = 100;
/** 等待动作上限（tick，1 小时） */
export const MAX_WAIT_TICKS = 20 * 3600;
/** 单条攻击次数上限 */
export const MAX_ATTACK_COUNT = 500;
/** 说话文本长度上限 */
export const MAX_SAY_LENGTH = 200;
/** 坐标绝对值上限（世界边界 ±3000 万） */
export const MAX_COORD = 3e7;
/** 整段循环次数上限 */
export const MAX_LOOP_COUNT = 9999;
/** 连续纯跳转上限（超过判死循环并停机） */
export const JUMP_STREAK_LIMIT = 40;
/** 文本规格多条分隔符（面板/命令里一行写完一段动作表用） */
export const ACTION_SPEC_SEPARATOR = "|";

// ─── 模型 ────────────────────────────────────────────────────────

/** 动作坐标（整数方块坐标；输入一律向下取整） */
export interface ActionCoord {
  x: number;
  y: number;
  z: number;
}

/** 失败策略：停下并报告（缺省）或跳过该条继续 */
export type ActionFailPolicy = "stop" | "skip";

/**
 * 单条动作。带可选 `look` 的动作（挖前方/使用物品/潜行/跳）填了就先转向该点再动作。
 * @property note - 人读备注（列表里显示在最前，不参与执行）
 */
export type ActionStep = (
  | { type: "moveTo"; x: number; y: number; z: number }
  | { type: "mine"; x: number; y: number; z: number }
  | { type: "place"; x: number; y: number; z: number }
  | { type: "look"; x: number; y: number; z: number }
  | { type: "wait"; ticks: number }
  | { type: "mineLook"; look?: ActionCoord }
  | { type: "useItem"; look?: ActionCoord }
  | { type: "hop"; look?: ActionCoord }
  | { type: "attack"; count: number }
  | { type: "say"; text: string }
  | { type: "sneak"; on: boolean; look?: ActionCoord }
  | { type: "jump"; target: number }
) & { note?: string };

/** 一段动作表 */
export interface ActionProgram {
  /** 动作序列（执行顺序即数组顺序） */
  steps: ActionStep[];
  /** 整段循环：-1=一直；1=只跑一遍；N=循环 N 次 */
  loopCount: number;
  /** 单条失败怎么办（缺省 stop） */
  onFail: ActionFailPolicy;
}

/** 空动作表（只跑一遍、失败即停） */
export function createEmptyActions(): ActionProgram {
  return { steps: [], loopCount: 1, onFail: "stop" };
}

// ─── 动作类型目录（面板与文本解析同源） ──────────────────────────────

/** 参数形态：coord=必填坐标 / coordOptional=可空坐标 / num=数量 / text=文本 / none=无参 */
export type ActionParamKind = "coord" | "coordOptional" | "num" | "text" | "none";

/** 动作类型定义（面板「选动作类型 → 填参数」遍历此表） */
export interface ActionTypeDef {
  /** 动作类型 id（面板对外标识） */
  id: string;
  /** 分类名（面板下拉前缀） */
  cat: string;
  /** 中文显示名 */
  label: string;
  /** 参数形态 */
  param: ActionParamKind;
  /** 写入的动作 type */
  stepType: ActionStep["type"];
  /** 固定参数（潜行开/关这种无输入但有固定值的动作类型） */
  fixed?: { on: boolean };
  /** 该动作类型的文本规格关键词（面板参数 → 文本 → 动作 的唯一桥梁） */
  kw: string;
  /** 参数填写提示（面板 tooltip） */
  hint: string;
}

/** 动作类型目录（13 项 → 12 种动作类型） */
export const ACTION_TYPES: readonly ActionTypeDef[] = [
  {
    id: "moveTo",
    cat: "移动",
    label: "走到坐标",
    kw: "走到",
    param: "coord",
    stepType: "moveTo",
    hint: "x y z（超过 16 格会自动分段走）",
  },
  { id: "wait", cat: "等待", label: "等待 N 秒", kw: "等待", param: "num", stepType: "wait", hint: "秒数，最大 3600" },
  {
    id: "mine",
    cat: "方块",
    label: "挖掘·指定坐标",
    kw: "挖掘",
    param: "coord",
    stepType: "mine",
    hint: "x y z（6 格内，技术方块拒绝）",
  },
  {
    id: "mineLook",
    cat: "方块",
    label: "挖掘·前方",
    kw: "挖前方",
    param: "coordOptional",
    stepType: "mineLook",
    hint: "可留空；填 x y z 就先转向再挖",
  },
  {
    id: "place",
    cat: "方块",
    label: "放置方块",
    kw: "放置",
    param: "coord",
    stepType: "place",
    hint: "x y z（主手需为可放置方块）",
  },
  {
    id: "useItem",
    cat: "交互",
    label: "使用物品一次",
    kw: "使用物品",
    param: "coordOptional",
    stepType: "useItem",
    hint: "可留空；填 x y z 就先转向再用",
  },
  {
    id: "attack",
    cat: "战斗",
    label: "攻击 N 次",
    kw: "攻击",
    param: "num",
    stepType: "attack",
    hint: "次数，最大 500",
  },
  { id: "look", cat: "姿态", label: "看向坐标", kw: "看", param: "coord", stepType: "look", hint: "x y z" },
  {
    id: "sneakOn",
    cat: "姿态",
    label: "潜行开",
    kw: "潜行开",
    param: "coordOptional",
    stepType: "sneak",
    fixed: { on: true },
    hint: "可留空；填 x y z 就先转向再潜行",
  },
  {
    id: "sneakOff",
    cat: "姿态",
    label: "潜行关",
    kw: "潜行关",
    param: "coordOptional",
    stepType: "sneak",
    fixed: { on: false },
    hint: "可留空；填 x y z 就先转向再站起",
  },
  {
    id: "hop",
    cat: "姿态",
    label: "跳一下",
    kw: "跳一下",
    param: "coordOptional",
    stepType: "hop",
    hint: "可留空；填 x y z 就先转向再跳",
  },
  {
    id: "say",
    cat: "通信",
    label: "说话",
    kw: "说话",
    param: "text",
    stepType: "say",
    hint: `文本，最大 ${MAX_SAY_LENGTH} 字`,
  },
  {
    id: "jump",
    cat: "流程",
    label: "跳转到第 N 条",
    kw: "跳转",
    param: "num",
    stepType: "jump",
    hint: `序号 1-${MAX_ACTIONS}（向后跳＝自定义循环）`,
  },
];

/** 分类名（保持目录顺序） */
export const ACTION_CATEGORIES: readonly string[] = [...new Set(ACTION_TYPES.map((m) => m.cat))];

/** 按 id 取动作类型定义 */
export function actionTypeById(id: string): ActionTypeDef | undefined {
  return ACTION_TYPES.find((m) => m.id === id);
}

/** 关键词速查（帮助与报错共用） */
export const ACTION_KEYWORD_HELP =
  `走到 x y z ${ACTION_SPEC_SEPARATOR} 等待 秒 ${ACTION_SPEC_SEPARATOR} 挖掘 x y z ${ACTION_SPEC_SEPARATOR} 挖前方 ` +
  `${ACTION_SPEC_SEPARATOR} 放置 x y z ${ACTION_SPEC_SEPARATOR} 使用物品 ${ACTION_SPEC_SEPARATOR} 攻击 次数 ` +
  `${ACTION_SPEC_SEPARATOR} 说话 文本 ${ACTION_SPEC_SEPARATOR} 看 x y z ${ACTION_SPEC_SEPARATOR} 潜行开 ` +
  `${ACTION_SPEC_SEPARATOR} 潜行关 ${ACTION_SPEC_SEPARATOR} 跳一下 ${ACTION_SPEC_SEPARATOR} 跳转 序号`;

// ─── 基础转换 ────────────────────────────────────────────────────

/** 数字容错转换：数字/数字字符串 → number；非法 undefined */
function toNum(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function validCoordValue(v: number): boolean {
  return v >= -MAX_COORD && v <= MAX_COORD;
}

function parseCoord(raw: unknown): ActionCoord | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const x = toNum(o.x);
  const y = toNum(o.y);
  const z = toNum(o.z);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  if (!validCoordValue(x) || !validCoordValue(y) || !validCoordValue(z)) return undefined;
  return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
}

// ─── 循环与失败策略 ──────────────────────────────────────────────

/** 循环次数归一化：-1=一直；≥1=N 次（上限内）；其余 → 1 */
export function normalizeLoopCount(value: unknown): number {
  const n = toNum(value);
  if (n === undefined) return 1;
  const i = Math.trunc(n);
  if (i === -1) return -1;
  if (i >= 1) return Math.min(i, MAX_LOOP_COUNT);
  return 1;
}

/** 循环次数文本解析（一直/forever/-1、一次/关/off/1、数字）；非法 undefined */
export function parseLoopCountInput(input: string): number | undefined {
  const t = input.trim().toLowerCase();
  if (t.length === 0) return undefined;
  if (t === "一直" || t === "forever" || t === "-1") return -1;
  if (t === "一次" || t === "只跑一遍" || t === "关" || t === "off" || t === "1") return 1;
  const n = toNum(t);
  if (n === undefined) return undefined;
  const i = Math.trunc(n);
  if (i === -1) return -1;
  if (i >= 2) return Math.min(i, MAX_LOOP_COUNT);
  return undefined;
}

/** 循环次数 → 中文 */
export function describeLoopCount(loop: number): string {
  if (loop < 0) return "一直循环";
  if (loop === 1) return "只跑一遍";
  return `循环 ${loop} 次`;
}

/** 失败策略归一化（缺省 stop） */
export function normalizeFailPolicy(value: unknown): ActionFailPolicy {
  return value === "skip" ? "skip" : "stop";
}

/** 失败策略文本解析（停/停下/stop、跳过/skip/继续） */
export function parseFailPolicyInput(input: string): ActionFailPolicy | undefined {
  const t = input.trim().toLowerCase();
  if (t === "停" || t === "停下" || t === "停止" || t === "stop") return "stop";
  if (t === "跳过" || t === "继续" || t === "skip") return "skip";
  return undefined;
}

/** 失败策略 → 中文 */
export function describeFailPolicy(policy: ActionFailPolicy): string {
  return policy === "skip" ? "单条失败就跳过" : "单条失败就停下";
}

// ─── 存档归一化 ──────────────────────────────────────────────────

/** 单条动作归一化；非法 → undefined（该条丢弃） */
function normalizeActionCore(raw: unknown): ActionStep | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const t = o.type;
  if (t === "moveTo" || t === "mine" || t === "place" || t === "look") {
    const c = parseCoord(o);
    if (!c) return undefined;
    return t === "moveTo"
      ? { type: "moveTo", ...c }
      : t === "mine"
        ? { type: "mine", ...c }
        : t === "place"
          ? { type: "place", ...c }
          : { type: "look", ...c };
  }
  if (t === "wait") {
    const ticks = toNum(o.ticks);
    if (ticks === undefined || ticks < 1) return undefined;
    return { type: "wait", ticks: Math.min(Math.round(ticks), MAX_WAIT_TICKS) };
  }
  if (t === "mineLook" || t === "useItem" || t === "hop") {
    const look = parseCoord(o.look);
    if (t === "mineLook") return look ? { type: "mineLook", look } : { type: "mineLook" };
    if (t === "useItem") return look ? { type: "useItem", look } : { type: "useItem" };
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
    const look = parseCoord(o.look);
    return look ? { type: "sneak", on: o.on, look } : { type: "sneak", on: o.on };
  }
  if (t === "jump") {
    const target = toNum(o.target);
    if (target === undefined || target < 1) return undefined;
    return { type: "jump", target: Math.min(Math.round(target), MAX_ACTIONS) };
  }
  return undefined;
}

/**
 * 单条动作归一化（对外唯一入口）。
 * @param raw - 存档/命令/面板来的原始值
 * @returns 规范化动作；非法 undefined
 */
export function normalizeAction(raw: unknown): ActionStep | undefined {
  const step = normalizeActionCore(raw);
  if (!step) return undefined;
  const note = (raw as Record<string, unknown>).note;
  if (typeof note === "string" && note.trim().length > 0) step.note = note.trim().slice(0, MAX_NOTE_LENGTH);
  return step;
}

/**
 * 整段动作表归一化（存档读入边界）。
 * @param raw - DP 读回的原始值
 * @returns 规范化动作表（坏条目丢弃、超上限截断）
 */
export function normalizeActions(raw: unknown): ActionProgram {
  if (!raw || typeof raw !== "object") return createEmptyActions();
  const o = raw as Record<string, unknown>;
  const steps: ActionStep[] = [];
  if (Array.isArray(o.steps)) {
    for (const item of o.steps) {
      const step = normalizeAction(item);
      if (step) steps.push(step);
      if (steps.length >= MAX_ACTIONS) break;
    }
  }
  return { steps, loopCount: normalizeLoopCount(o.loopCount), onFail: normalizeFailPolicy(o.onFail) };
}

// ─── 文本规格解析（命令与面板共用） ──────────────────────────────

/** 动作类型关键词（长词优先，「挖前方」不被「挖」抢走） */
const MODULE_KEYWORDS: readonly string[] = [
  "挖前方",
  "挖前",
  "使用物品",
  "跳一下",
  "潜行开",
  "潜行关",
  "走到",
  "等待",
  "挖掘",
  "放置",
  "使用",
  "攻击",
  "说话",
  "看向",
  "潜行",
  "跳跃",
  "跳转",
  "看",
  "minelook",
  "minefront",
  "useitem",
  "sneakon",
  "sneakoff",
  "moveto",
  "move",
  "wait",
  "mine",
  "place",
  "use",
  "attack",
  "say",
  "look",
  "sneak",
  "hop",
  "goto",
  "jump",
  "go",
]
  .slice()
  .sort((a, b) => b.length - a.length);

/** 从首个 token 切出关键词与粘连参数（支持「走到100 64 200」连写） */
function extractKeyword(raw: string): { kw: string; rest: string } {
  const lower = raw.toLowerCase();
  for (const k of MODULE_KEYWORDS) {
    if (raw.startsWith(k)) return { kw: k, rest: raw.slice(k.length) };
    if (/^[a-z]+$/.test(k) && lower.startsWith(k)) return { kw: k, rest: raw.slice(k.length) };
  }
  return { kw: raw, rest: "" };
}

/**
 * 单条文本规格 → 动作。
 * @param spec - 形如「走到 10 64 20」「等待 2」「跳转 3」
 * @returns 动作或中文错误
 */
export function parseActionSpec(spec: string): { step: ActionStep } | { error: string } {
  const tokens = spec
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);
  const first = tokens[0];
  if (!first) return { error: "缺少动作类型关键词" };
  const { kw, rest } = extractKeyword(first);
  const kwLower = kw.toLowerCase();
  const args: string[] = rest.length > 0 ? [rest, ...tokens.slice(1)] : tokens.slice(1);

  /** 解析三个坐标参数（支持 x,y,z 与 (x,y,z)） */
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
    if (!validCoordValue(x) || !validCoordValue(y) || !validCoordValue(z)) return "坐标超出世界范围";
    return { x, y, z };
  };

  if (kw === "走到" || kwLower === "move" || kwLower === "moveto" || kwLower === "go") {
    const c = coord3();
    return typeof c === "string" ? { error: `走到：${c}` } : { step: { type: "moveTo", x: c.x, y: c.y, z: c.z } };
  }
  if (kw === "等待" || kwLower === "wait") {
    const sec = toNum(args[0]);
    if (sec === undefined || sec <= 0) return { error: "等待：需要秒数（正数）" };
    const ticks = Math.round(sec * 20);
    if (ticks < 1) return { error: "等待：至少 0.05 秒" };
    if (ticks > MAX_WAIT_TICKS) return { error: `等待：最长为 ${MAX_WAIT_TICKS / 20} 秒` };
    return { step: { type: "wait", ticks } };
  }
  if (kw === "挖掘" || kwLower === "mine") {
    const c = coord3();
    return typeof c === "string" ? { error: `挖掘：${c}` } : { step: { type: "mine", x: c.x, y: c.y, z: c.z } };
  }
  /** 可空坐标：给了 3 个数字就当 look，否则留空 */
  const optionalLook = (): ActionCoord | undefined | string => {
    if (args.filter((a) => a !== undefined && a.length > 0).length === 0) return undefined;
    const c = coord3();
    return typeof c === "string" ? c : c;
  };
  if (kw === "挖前方" || kw === "挖前" || kwLower === "minelook" || kwLower === "minefront") {
    const look = optionalLook();
    if (typeof look === "string") return { error: `挖前方：${look}` };
    return look ? { step: { type: "mineLook", look } } : { step: { type: "mineLook" } };
  }
  if (kw === "放置" || kwLower === "place") {
    const c = coord3();
    return typeof c === "string" ? { error: `放置：${c}` } : { step: { type: "place", x: c.x, y: c.y, z: c.z } };
  }
  if (kw === "使用物品" || kw === "使用" || kwLower === "use" || kwLower === "useitem") {
    const look = optionalLook();
    if (typeof look === "string") return { error: `使用物品：${look}` };
    return look ? { step: { type: "useItem", look } } : { step: { type: "useItem" } };
  }
  if (kw === "攻击" || kwLower === "attack") {
    const n = toNum(args[0]);
    if (n === undefined || n < 1) return { error: "攻击：需要次数（正整数）" };
    const count = Math.round(n);
    if (count > MAX_ATTACK_COUNT) return { error: `攻击：次数需在 1-${MAX_ATTACK_COUNT} 之间` };
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
    return typeof c === "string" ? { error: `看：${c}` } : { step: { type: "look", x: c.x, y: c.y, z: c.z } };
  }
  if (kw === "潜行开" || kwLower === "sneakon" || kw === "潜行关" || kwLower === "sneakoff") {
    const on = kw === "潜行开" || kwLower === "sneakon";
    const look = optionalLook();
    if (typeof look === "string") return { error: `潜行：${look}` };
    return look ? { step: { type: "sneak", on, look } } : { step: { type: "sneak", on } };
  }
  if (kw === "潜行" || kwLower === "sneak") {
    const v = (args[0] ?? "").toLowerCase();
    if (v === "开" || v === "on" || v === "true" || v === "1") return { step: { type: "sneak", on: true } };
    if (v === "关" || v === "off" || v === "false" || v === "0") return { step: { type: "sneak", on: false } };
    return { error: "潜行：需要参数 开/关" };
  }
  if (kw === "跳一下" || kw === "跳跃" || kwLower === "hop") {
    const look = optionalLook();
    if (typeof look === "string") return { error: `跳一下：${look}` };
    return look ? { step: { type: "hop", look } } : { step: { type: "hop" } };
  }
  if (kw === "跳转" || kwLower === "goto" || kwLower === "jump") {
    const n = toNum(args[0]);
    if (n === undefined || n < 1) return { error: "跳转：需要目标序号（≥1）" };
    const target = Math.round(n);
    if (target > MAX_ACTIONS) return { error: `跳转：序号需在 1-${MAX_ACTIONS} 之间` };
    return { step: { type: "jump", target } };
  }
  return { error: `未知动作类型「${kw}」（可用：${ACTION_KEYWORD_HELP}）` };
}

/** 多步文本规格解析结果：逐条成功/失败（面板与命令都要能指出第几条错在哪） */
export interface ActionsSpecResult {
  steps: ActionStep[];
  /** 失败明细（人读：`第 N 条：原因`） */
  errors: string[];
}

/**
 * 多步文本规格 → 动作序列（`|` 或换行分隔；空段忽略）。
 * @param text - 整段文本
 * @returns 成功动作 + 失败明细（不因一条错就丢整段）
 */
export function parseActionsSpec(text: string): ActionsSpecResult {
  // 换行与分隔符都算条目边界（面板一行写完、命令一次粘贴都支持）
  const parts = text
    .split(/[\n\r|]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const steps: ActionStep[] = [];
  const errors: string[] = [];
  parts.forEach((part, i) => {
    if (steps.length >= MAX_ACTIONS) {
      errors.push(`第 ${i + 1} 条：超过 ${MAX_ACTIONS} 条上限`);
      return;
    }
    const r = parseActionSpec(part);
    if ("error" in r) errors.push(`第 ${i + 1} 条：${r.error}`);
    else steps.push(r.step);
  });
  return { steps, errors };
}

// ─── 中文描述 ────────────────────────────────────────────────────

function fmtNum(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function fmtSeconds(ticks: number): string {
  return String(Math.round((ticks / 20) * 10) / 10);
}

function fmtCoord(c: ActionCoord): string {
  return `(${fmtNum(c.x)},${fmtNum(c.y)},${fmtNum(c.z)})`;
}

/**
 * 单条动作 → 中文描述（列表/日志/通知统一走这里）。
 * @param step - 动作
 * @param index - 序号（1 起；给了就在前面加序号）
 */
export function describeAction(step: ActionStep, index?: number): string {
  const body = ((): string => {
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
        return `说话「${step.text}」`;
      case "look":
        return `看向 ${fmtCoord(step)}`;
      case "sneak":
        return `${step.on ? "潜行开" : "潜行关"}${step.look ? ` · 对准 ${fmtCoord(step.look)}` : ""}`;
      case "hop":
        return step.look ? `跳一下 · 对准 ${fmtCoord(step.look)}` : "跳一下";
      case "jump":
        return `跳转到第 ${step.target} 条`;
    }
  })();
  const head = index === undefined ? "" : `${index}. `;
  return step.note ? `${head}${body} §7(${step.note})` : `${head}${body}`;
}

/** 把动作表压成一行文本规格（面板文本编辑预填用；与 parseActionSpec 互为逆运算） */
export function actionsToSpecText(program: ActionProgram): string {
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
          return s.look ? `挖前方 ${fmtNum(s.look.x)} ${fmtNum(s.look.y)} ${fmtNum(s.look.z)}` : "挖前方";
        case "place":
          return `放置 ${fmtNum(s.x)} ${fmtNum(s.y)} ${fmtNum(s.z)}`;
        case "useItem":
          return s.look ? `使用物品 ${fmtNum(s.look.x)} ${fmtNum(s.look.y)} ${fmtNum(s.look.z)}` : "使用物品";
        case "attack":
          return `攻击 ${s.count}`;
        case "say":
          return `说话 ${s.text}`;
        case "look":
          return `看 ${fmtNum(s.x)} ${fmtNum(s.y)} ${fmtNum(s.z)}`;
        case "sneak": {
          const base = s.on ? "潜行开" : "潜行关";
          return s.look ? `${base} ${fmtNum(s.look.x)} ${fmtNum(s.look.y)} ${fmtNum(s.look.z)}` : base;
        }
        case "hop":
          return s.look ? `跳一下 ${fmtNum(s.look.x)} ${fmtNum(s.look.y)} ${fmtNum(s.look.z)}` : "跳一下";
        case "jump":
          return `跳转 ${s.target}`;
      }
    })
    .join(` ${ACTION_SPEC_SEPARATOR} `);
}

/**
 * 单动作类型面板参数文本 → 动作（面板「选动作类型 + 填参数」入口）。
 * @param def - 动作类型定义
 * @param args - 参数文本（按 def.hint 的形态；可空动作类型留空即无坐标）
 * @returns 动作或中文错误
 */
export function actionFromType(def: ActionTypeDef, args: string): { step: ActionStep } | { error: string } {
  const trimmed = args.trim();
  return parseActionSpec(trimmed.length === 0 ? def.kw : `${def.kw} ${trimmed}`);
}

/** 动作 → 该动作类型的面板参数回填文本（编辑既有条目时预填） */
export function actionArgsOf(step: ActionStep): string {
  switch (step.type) {
    case "moveTo":
    case "mine":
    case "place":
    case "look":
      return `${fmtNum(step.x)} ${fmtNum(step.y)} ${fmtNum(step.z)}`;
    case "wait":
      return fmtSeconds(step.ticks);
    case "mineLook":
    case "useItem":
    case "hop":
      return step.look ? `${fmtNum(step.look.x)} ${fmtNum(step.look.y)} ${fmtNum(step.look.z)}` : "";
    case "attack":
      return String(step.count);
    case "say":
      return step.text;
    case "sneak":
      return step.look ? `${fmtNum(step.look.x)} ${fmtNum(step.look.y)} ${fmtNum(step.look.z)}` : "";
    case "jump":
      return String(step.target);
  }
}
