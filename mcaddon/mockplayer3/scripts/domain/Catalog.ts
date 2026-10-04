// ─── WorkMode 唯一真源目录（domain 纯逻辑） ─────────────────
// 中文名/前置条件/租约需求/性能分级只写这一份：命令帮助、面板页签、启用联动、调度校验全部由此派生。

import type { LeaseKind } from "./Leases";
import type { WorkMode } from "./Record";
import { HARVEST_KINDS, normalizeHarvestKind } from "./HarvestRules";

/** 性能分级（成本描述，不参与默认启用判定） */
export type ModeTier = "base" | "heavy";

/** 目录项 */
export interface WorkModeSpec {
  id: WorkMode;
  /** 中文名（展示唯一口径） */
  label: string;
  /** 一句话行为说明（帮助渲染） */
  help: string;
  /** 启动前置：能力 start 时必须已就绪的资源 */
  requiresLeases: LeaseKind[];
  /** 持续寻路/定时器/全局监听等高消耗标记（成本说明，非开关） */
  tier: ModeTier;
  /** 实现性功能（未完成验收）：受管理员"实现性功能"总闸约束，关则玩家侧一律不可选 */
  experimental?: boolean;
}

/** 全部模式目录（枚举顺序即 UI 页签顺序） */
export const WORK_MODES: readonly WorkModeSpec[] = [
  { id: "none", label: "空闲", help: "不执行任何自主行为", requiresLeases: [], tier: "base" },
  {
    id: "mine",
    label: "定点挖掘",
    help: "持续挖掉正前方准星命中的方块（不动·不转向）",
    requiresLeases: ["hands", "breaking"],
    tier: "base",
  },
  {
    id: "place",
    label: "定点放置",
    help: "持续把主手方块放置到正前方（空手/无目标低息重探，补货即恢复，永不自动停机）",
    requiresLeases: ["hands"],
    tier: "base",
  },
  {
    id: "attack",
    label: "定点攻击",
    help: "持续向正前方近战挥击（不动·不转向·盲挥）",
    requiresLeases: ["hands", "motion"],
    tier: "base",
  },
  { id: "follow", label: "跟随", help: "跟随指定玩家，距离带 3~128", requiresLeases: ["motion"], tier: "base" },
  {
    id: "fishing",
    label: "自动钓鱼",
    help: "共享点池选点、走到、抛收竿",
    requiresLeases: ["gaze", "hands", "motion"],
    tier: "heavy",
  },
  { id: "wander", label: "闲逛", help: "以当前站位为中心的随机游走与休息", requiresLeases: ["motion"], tier: "heavy" },
  {
    id: "raid",
    label: "劫掠",
    help: "原地常驻施加袭击之兆引发袭击（需在场挂机+村庄+非和平+不祥之瓶；本模式不攻击，胜场不保证）",
    requiresLeases: ["hands"],
    tier: "heavy",
  },
  {
    id: "vault",
    label: "宝库模式",
    help: "扫描并自动寻路开启试炼宝库",
    requiresLeases: ["gaze", "hands", "motion"],
    tier: "heavy",
  },
  {
    id: "custom",
    label: "自定义动作",
    help: "按玩家写好的动作表执行（走到/等待/挖掘/放置/使用物品/攻击/说话/看向/潜行/跳/跳转），可整段循环",
    requiresLeases: ["hands", "motion"],
    tier: "heavy",
    // 归"实现性功能"总闸管辖（未完成实机验收，关则玩家侧不可选）
    experimental: true,
  },
  // 采集模式族：对象即模式——每 CollectorSpec 一个独立工作模式；表序=目录派生 UI 顺序
  // 当前仅原木一种，且归"实现性功能"总闸管辖（未完成验收，关则玩家侧不可选）
  ...HARVEST_KINDS.map((k): WorkModeSpec => ({
    id: `harvest_${k.id}`,
    label: `资源采集(${k.label})`,
    help: `采集${k.label}：寻点→靠近→采集→吸附掉落→换点`,
    requiresLeases: ["hands", "breaking", "motion"],
    tier: "heavy",
    experimental: true,
  })),
];

/** 按 id 取目录项 */
export function modeSpec(id: WorkMode): WorkModeSpec {
  const spec = WORK_MODES.find((m) => m.id === id);
  if (!spec) throw new Error(`工作模式目录缺项: ${id}`);
  return spec;
}

/**
 * 该模式是否归"实现性功能"总闸管辖（未完成验收的实验模式）。
 * @param id - 工作模式 id
 */
export function isExperimentalMode(id: WorkMode): boolean {
  return WORK_MODES.some((m) => m.id === id && m.experimental === true);
}

/**
 * 目录成员判定（读盘边界）：`WorkMode` 类型只约束代码，拦不住落盘数据里
 * 已下架的模式 id；必须过这里才进渲染/切换链，目录外一律回落 none。
 */
export function isKnownMode(id: unknown): id is WorkMode {
  return typeof id === "string" && WORK_MODES.some((m) => m.id === id);
}

/**
 * 落盘 workMode 归一（读盘边界）：目录成员直通，目录外的 id 回落 none；
 * 已落盘的两级写法 `harvest` + `harvestKind` 折成 `harvest_<kind>`，kind 缺失/非法按 wood 兜底。
 */
export function normalizeStoredWorkMode(id: unknown, legacyKind: unknown): WorkMode {
  if (id === "harvest") return `harvest_${normalizeHarvestKind(legacyKind)}`;
  return isKnownMode(id) ? id : "none";
}

/**
 * 默认启用表：目录内全部模式一律默认开，新增模式自动纳入（不再维护第二张表）。
 * 模式该不该跑由假人记录、命令与启动前置条件决定，性能分级只是成本描述；
 * 管理员总闸只在明确要禁用某模式时才落下（管理面板可逐项关回）。
 */
export function defaultEnabledModes(): Record<WorkMode, boolean> {
  const out = {} as Record<WorkMode, boolean>;
  for (const spec of WORK_MODES) out[spec.id] = true;
  return out;
}

/**
 * 中文别名 → 模式 id（命令/面板输入解析，目录派生）。
 * @returns 键含中文名与 id 本身（大小写敏感的 id 原样可用）
 */
export function modeAliasMap(): Record<string, WorkMode> {
  const out: Record<string, WorkMode> = {};
  for (const spec of WORK_MODES) {
    out[spec.id] = spec.id;
    out[spec.label] = spec.id;
  }
  return out;
}
