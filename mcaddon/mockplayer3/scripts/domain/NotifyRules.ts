// ─── 通知分级与个人设置（domain 纯逻辑） ──────────────────────────
// 假人私信分 debug < info < warn < error 四档；每玩家持 {enabled, minLevel}，
// enabled=false 任何档都不发，否则只发不低于 minLevel 的档。
// 档位标记用 § 色码直接拼（基岩聊支持），颜色表不另设来源。

/** 通知档位（门限序从低到高） */
export type NotifyLevel = "debug" | "info" | "warn" | "error";

/** 全量档位（命令/面板值表，按门限序） */
export const NOTIFY_LEVELS: readonly NotifyLevel[] = ["debug", "info", "warn", "error"];

/** 档位门限序数（只用于比较） */
const LEVEL_RANK: Readonly<Record<NotifyLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

/** 档位中文名（面板文案与聊天行首标记） */
export const NOTIFY_LEVEL_LABELS: Readonly<Record<NotifyLevel, string>> = {
  debug: "调试",
  info: "信息",
  warn: "警告",
  error: "错误",
};

/** 行首档位标记颜色：灰/青/金/红 */
const NOTIFY_LEVEL_COLORS: Readonly<Record<NotifyLevel, string>> = {
  debug: "§7",
  info: "§b",
  warn: "§6",
  error: "§c",
};

/** 玩家个人通知设置 */
export interface NotifySetting {
  /** 总开关；false=任何档位的假人私信都不发 */
  enabled: boolean;
  /** 最低接收档位；低于此档不发 */
  minLevel: NotifyLevel;
}

/** 未持久化时的缺省：开启 + info（调试档的图表类细节默认不打扰） */
export const DEFAULT_NOTIFY_SETTING: Readonly<NotifySetting> = { enabled: true, minLevel: "info" };

/** 是否合法档位（外部输入/反序列化守卫） */
export function isNotifyLevel(value: unknown): value is NotifyLevel {
  return typeof value === "string" && (NOTIFY_LEVELS as readonly string[]).includes(value);
}

/** 该条通知是否通过玩家门限 */
export function shouldSendNotify(setting: NotifySetting, level: NotifyLevel): boolean {
  return setting.enabled && LEVEL_RANK[level] >= LEVEL_RANK[setting.minLevel];
}

/** 持久化对象反序列化：逐字段兜底（缺失/形状不符取该字段缺省） */
export function parseNotifySetting(raw: unknown): NotifySetting {
  const o = (raw ?? {}) as Partial<NotifySetting>;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : DEFAULT_NOTIFY_SETTING.enabled,
    minLevel: isNotifyLevel(o.minLevel) ? o.minLevel : DEFAULT_NOTIFY_SETTING.minLevel,
  };
}

/** 是否等价缺省（等价时存储侧删键不留冗余） */
export function isDefaultNotifySetting(setting: NotifySetting): boolean {
  return setting.enabled === DEFAULT_NOTIFY_SETTING.enabled && setting.minLevel === DEFAULT_NOTIFY_SETTING.minLevel;
}

/** 聊天行文本：彩色档位标记前置；调用方文本原样保留（可自带 § 色码） */
export function decorateNotify(level: NotifyLevel, text: string): string {
  return `${NOTIFY_LEVEL_COLORS[level]}[${NOTIFY_LEVEL_LABELS[level]}]§r ${text}`;
}
