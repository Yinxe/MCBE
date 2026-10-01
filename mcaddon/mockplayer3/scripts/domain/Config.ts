// ─── 全局配置（domain 纯逻辑） ───────────────────────────────────
// 单 DP 键 mp:config；读取逐字段与默认合并（损坏或缺字段一律回退）。
// 值语义：配额 0=禁止、UNLIMITED=无限、管理员豁免（Permissions.ts 判定）。

import type { WorkMode } from "./Record";
import { defaultEnabledModes } from "./Catalog";

/** 配额无限标记（UI 滑块"无限"档位映射值） */
export const UNLIMITED_QUOTA = 999;
/** 每玩家默认创建配额 */
export const DEFAULT_CREATE_QUOTA = 5;
/** 每玩家默认同时在线配额 */
export const DEFAULT_ONLINE_QUOTA = 3;
/** 默认菜单信物（木棍） */
export const DEFAULT_TOKEN_ITEM = "minecraft:stick";
/** 上线辅助常加载默认半径（区块，v2 口径"模拟4"） */
export const DEFAULT_AUX_TICKING_RADIUS = 4;

/** 辅助常加载半径合法档位：0=关闭，4/6/8=模拟4/6/8（v2 定案档位） */
export const AUX_RADIUS_CHOICES: readonly number[] = [0, 4, 6, 8];

/** 半径归一：非 0/4/6/8 一律回退 fallback（默认 4） */
export function normalizeAuxTickingRadius(value: unknown, fallback: number = DEFAULT_AUX_TICKING_RADIUS): number {
  return AUX_RADIUS_CHOICES.includes(value as number) ? (value as number) : fallback;
}

/** 圆形档区块足迹判据（与 `tickingarea add circle` 实测口径一致：r=4 实占 49 列） */
export function auxChunkCovered(dx: number, dz: number, radius: number): boolean {
  return dx * dx + dz * dz <= radius * radius;
}

/**
 * 当前启用表策略版本：v1=高消耗模式默认关，v2=目录内全部模式默认启用。
 * 落盘档版本低于它时，整表按新默认重置一次：旧档里"没被管理员碰过"和"被默认表
 * 关掉"记的是同一个 `false`，无从区分，只能整表重刷；写回时带上版本戳，此后面板
 * 里的逐项关闭照旧逐字保留。
 */
export const WORK_MODE_POLICY_V_ALL_ON = 2;

/** 旧启用表策略：无版本戳的落盘档一律按此解释 */
export const WORK_MODE_POLICY_V_HEAVY_OFF = 1;

/**
 * 读出落盘档的启用表策略版本：无戳/非数一律按旧策略解释。
 * 读盘侧（engine/RecordStore）据此判断本次是否发生了整表重置，并记一条日志。
 */
export function storedWorkModePolicy(raw: unknown): number {
  if (typeof raw !== "object" || raw === null) return WORK_MODE_POLICY_V_HEAVY_OFF;
  const v = (raw as Record<string, unknown>).workModePolicyVersion;
  return typeof v === "number" && Number.isFinite(v) ? v : WORK_MODE_POLICY_V_HEAVY_OFF;
}

/**
 * 菜单信物选项（管理员面板下拉唯一真源；typeId=null=关闭物品触发仅命令）。
 * label 含 § 色码，需逐字保持稳定。
 */
export const TOKEN_ITEM_OPTIONS: readonly { label: string; typeId: string | null }[] = [
  { label: "§7无 (仅命令 /mp:menu)", typeId: null },
  { label: "§e木棍 (默认)", typeId: "minecraft:stick" },
  { label: "§e木锄", typeId: "minecraft:wooden_hoe" },
  { label: "§b鹦鹉螺壳", typeId: "minecraft:nautilus_shell" },
  { label: "§6唱片残片5", typeId: "minecraft:disc_fragment_5" },
  { label: "§b下界之星", typeId: "minecraft:nether_star" },
  { label: "§6烈焰粉", typeId: "minecraft:blaze_powder" },
  { label: "§f羽毛", typeId: "minecraft:feather" },
  { label: "§7燧石", typeId: "minecraft:flint" },
  { label: "§6烈焰棒", typeId: "minecraft:blaze_rod" },
  { label: "§b旋风棒", typeId: "minecraft:breeze_rod" },
  { label: "§f箭", typeId: "minecraft:arrow" },
];

/** 双配额（全局默认 + 逐玩家覆盖；覆盖只填需要偏离的字段） */
export interface QuotaConfig {
  create: number;
  online: number;
  perPlayer: Record<string, Partial<{ create: number; online: number }>>;
}

/** 全局配置（管理员面板可改） */
export interface GlobalConfig {
  quotas: QuotaConfig;
  /** 工作模式启用表（缺字段按默认表补） */
  workModeEnabled: Record<WorkMode, boolean>;
  /** 实现性功能总闸：关则 experimental 模式（现仅砍树）对玩家侧一律不可用（默认关，验收后再开） */
  experimentalEnabled: boolean;
  /** 启用表策略版本戳：低于 `WORK_MODE_POLICY_V_ALL_ON` 的落盘档整表重置一次 */
  workModePolicyVersion: number;
  /** 主人下线联动默认值（记录级开关可覆盖） */
  ownerDownOfflineDefault: boolean;
  /** 额外管理员名单（playerKey 口径；OP 之外） */
  adminKeys: string[];
  /** 菜单信物（enabled=false 仅命令入口） */
  tokenItem: { enabled: boolean; typeId: string };
  /** 上线辅助常加载半径（区块；0=关闭，4/6/8=模拟4/6/8，v2 auxTickingRadius 对位） */
  auxTickingRadius: number;
  /** 调试日志开关（默认零日志） */
  debugLog: boolean;
}

/** 默认配置（启动早建；worldLoad 后读 DP 合并覆盖） */
export function defaultConfig(): GlobalConfig {
  return {
    quotas: { create: DEFAULT_CREATE_QUOTA, online: DEFAULT_ONLINE_QUOTA, perPlayer: {} },
    workModeEnabled: defaultEnabledModes(),
    experimentalEnabled: false,
    workModePolicyVersion: WORK_MODE_POLICY_V_ALL_ON,
    ownerDownOfflineDefault: false,
    adminKeys: [],
    tokenItem: { enabled: true, typeId: DEFAULT_TOKEN_ITEM },
    auxTickingRadius: DEFAULT_AUX_TICKING_RADIUS,
    debugLog: false,
  };
}

/**
 * 逐字段与默认合并（未知键忽略、类型不符回退默认——DP 可能被手改坏）。
 * @param raw - DP 读回的 JSON.parse 产物（形状不可信）
 */
export function mergeConfig(raw: unknown): GlobalConfig {
  const d = defaultConfig();
  if (typeof raw !== "object" || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fb: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fb);
  const bool = (v: unknown, fb: boolean): boolean => (typeof v === "boolean" ? v : fb);
  const strArray = (v: unknown, fb: string[]): string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string") ? [...v] : fb;

  const q = (r.quotas ?? {}) as Record<string, unknown>;
  const perPlayerRaw = (q.perPlayer ?? {}) as Record<string, unknown>;
  const perPlayer: QuotaConfig["perPlayer"] = {};
  for (const [key, value] of Object.entries(perPlayerRaw)) {
    if (typeof value !== "object" || value === null) continue;
    const p = value as Record<string, unknown>;
    const entry: Partial<{ create: number; online: number }> = {};
    if (typeof p.create === "number" && Number.isFinite(p.create)) entry.create = Math.max(0, p.create);
    if (typeof p.online === "number" && Number.isFinite(p.online)) entry.online = Math.max(0, p.online);
    if (Object.keys(entry).length > 0) perPlayer[key] = entry;
  }

  const enabledRaw = (r.workModeEnabled ?? {}) as Record<string, unknown>;
  const workModeEnabled = { ...d.workModeEnabled };
  // 版本闸：旧策略档（无戳或戳=1）的整表 false 里混着"默认关"与"管理员关"
  // 两种来源、无法区分，一律按新默认重置；戳达标的档照旧逐字覆盖，管理员关的仍关。
  if (storedWorkModePolicy(r) >= WORK_MODE_POLICY_V_ALL_ON) {
    for (const mode of Object.keys(workModeEnabled) as WorkMode[]) {
      if (typeof enabledRaw[mode] === "boolean") workModeEnabled[mode] = enabledRaw[mode] as boolean;
    }
  }

  const token = (r.tokenItem ?? {}) as Record<string, unknown>;
  return {
    quotas: {
      create: Math.max(0, num(q.create, d.quotas.create)),
      online: Math.max(0, num(q.online, d.quotas.online)),
      perPlayer,
    },
    workModeEnabled,
    experimentalEnabled: bool(r.experimentalEnabled, d.experimentalEnabled),
    /** 恒写当下策略版本：旧档重置后由 SaveGate 落盘带戳，不再重复重置 */
    workModePolicyVersion: WORK_MODE_POLICY_V_ALL_ON,
    ownerDownOfflineDefault: bool(r.ownerDownOfflineDefault, d.ownerDownOfflineDefault),
    adminKeys: strArray(r.adminKeys, d.adminKeys),
    tokenItem: {
      enabled: bool(token.enabled, d.tokenItem.enabled),
      typeId: typeof token.typeId === "string" ? token.typeId : d.tokenItem.typeId,
    },
    auxTickingRadius: normalizeAuxTickingRadius(r.auxTickingRadius, d.auxTickingRadius),
    debugLog: bool(r.debugLog, d.debugLog),
  };
}
