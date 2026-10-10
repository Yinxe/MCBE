// ─── schema v2 存储：DP 寻址唯一实现 ────────────────────────────────
// 键空间：mp:nextBotId / mp:bot:<id> / mp:name:<名> / mp:config / mp:store:bind:<id>
//         / mp:legacy:pending:<旧名>（待迁物品标记，值=格数）。
// 键名一律含 botId 不含显示名（改名零迁移，"(2)" 幽灵无从污染键空间）。
// writeRecord/writeConfig 唯一合法调用方=SaveGate（唯一写入口纪律）；
// 绑定表与记录覆写解耦——绑定混进记录 JSON 会被整体覆写丢失。

import { world } from "@minecraft/server";
import type { BotRecord, StorageBinding } from "../domain/Record";
import { isBindingShape, isBotRecordShape } from "../domain/Record";
import { normalizeStoredWorkMode } from "../domain/Catalog";
import type { GlobalConfig } from "../domain/Config";
import { defaultConfig, mergeConfig, storedWorkModePolicy, WORK_MODE_POLICY_V_ALL_ON } from "../domain/Config";
import { readJson, removeKey, writeJson } from "./Dp";

/** 身份计数器键 */
export const NEXT_ID_KEY = "mp:nextBotId";
/** 记录键前缀 */
export const BOT_PREFIX = "mp:bot:";
/** 名字票据键前缀（值=botId） */
export const NAME_PREFIX = "mp:name:";
/** 全局配置键 */
export const CONFIG_KEY = "mp:config";
/** 物品仓绑定表键前缀（独立键，写穿与记录覆写解耦） */
export const BIND_PREFIX = "mp:store:bind:";
/** 旧物品待迁标记键前缀（值=待迁格数）：写不进仓的 v2 物品键，升级/就绪后再导入 */
export const LEGACY_PENDING_PREFIX = "mp:legacy:pending:";

export class RecordStore {
  // ─── 身份 ──

  /** 分配下一个稳定 botId（读-增-写；单线程 tick 模型内无竞态） */
  allocateBotId(): number {
    const cur = world.getDynamicProperty(NEXT_ID_KEY);
    const next = (typeof cur === "number" && cur >= 0 ? Math.floor(cur) : 0) + 1;
    world.setDynamicProperty(NEXT_ID_KEY, next);
    return next;
  }

  // ─── 记录 ──

  /**
   * 读盘边界卫生：类型并集拦不住落盘脏值，目录外 workMode 直进渲染链会抛穿面板——
   * 目录为唯一真源，目录外一律回落 none 并报备；旧两级记录（harvest+harvestKind）
   * 经 normalizeStoredWorkMode 折成 harvest_<kind> 并摘除旧键（幂等）。
   * 新增字段（如 raidVictories）旧档缺失/脏值静默归零，不报备。
   */
  private sanitize(parsed: BotRecord, key: string): BotRecord {
    const raw = parsed as unknown as { harvestKind?: unknown };
    const mode = normalizeStoredWorkMode(parsed.workMode, raw.harvestKind);
    if (mode !== parsed.workMode) {
      console.warn(
        `[mockplayer3] 记录 ${key} 工作模式 "${String(parsed.workMode)}" 已归一为 "${mode}"（旧模式退场/对象即模式）`
      );
      parsed.workMode = mode;
    }
    if ("harvestKind" in parsed) delete raw.harvestKind;
    if (!Number.isInteger(parsed.raidVictories) || parsed.raidVictories < 0) parsed.raidVictories = 0;
    if (typeof parsed.workChestId !== "string" || parsed.workChestId.length === 0) parsed.workChestId = null;
    return parsed;
  }

  /** 读单条记录（形状非法 = 损坏档，按缺失处理并告警） */
  loadRecord(botId: number): BotRecord | undefined {
    const parsed = readJson<BotRecord>(`${BOT_PREFIX}${botId}`);
    if (parsed === undefined) return undefined;
    if (!isBotRecordShape(parsed)) {
      console.error(`[mockplayer3] 记录 ${BOT_PREFIX}${botId} 形状非法已跳过`);
      return undefined;
    }
    return this.sanitize(parsed, `${BOT_PREFIX}${botId}`);
  }

  /**
   * 记录直写（唯一合法调用方=SaveGate，越级即违反唯一写入口纪律）。
   * 超限由 Dp.writeJson 抛编程错误（记录只存纯状态，本应远小于上限，F-24）。
   */
  writeRecord(record: BotRecord): void {
    writeJson(`${BOT_PREFIX}${record.botId}`, record);
  }

  /** 删除记录键（删除流程由管线保证三键齐删） */
  deleteRecord(botId: number): void {
    removeKey(`${BOT_PREFIX}${botId}`);
  }

  /** 前缀枚举全部合法记录（F-28；损坏条目告警跳过） */
  loadAll(): BotRecord[] {
    const out: BotRecord[] = [];
    for (const id of world.getDynamicPropertyIds()) {
      if (!id.startsWith(BOT_PREFIX)) continue;
      const parsed = readJson<BotRecord>(id);
      if (parsed === undefined) {
        console.error(`[mockplayer3] 记录 ${id} 损坏已跳过`);
        continue;
      }
      if (!isBotRecordShape(parsed)) {
        console.error(`[mockplayer3] 记录 ${id} 结构非法已跳过`);
        continue;
      }
      out.push(this.sanitize(parsed, id));
    }
    return out;
  }

  // ─── 名字票据（mp:name:<名> → botId；创建期占位即仲裁票据） ──

  /** 现名索引（规范化名 → botId）——迁移幂等比对/占用仲裁依据 */
  loadNameIndex(): Map<string, number> {
    const index = new Map<string, number>();
    for (const id of world.getDynamicPropertyIds()) {
      if (!id.startsWith(NAME_PREFIX)) continue;
      const v = world.getDynamicProperty(id);
      if (typeof v === "number") index.set(id.slice(NAME_PREFIX.length), v);
    }
    return index;
  }

  /** 查某名字的票据归属（无票 = 未被占用） */
  lookupBotId(name: string): number | undefined {
    const v = world.getDynamicProperty(`${NAME_PREFIX}${name}`);
    return typeof v === "number" ? v : undefined;
  }

  /** 占名票据（创建/改名时写） */
  claimName(name: string, botId: number): void {
    world.setDynamicProperty(`${NAME_PREFIX}${name}`, botId);
  }

  /** 释放名票据（删除/改名旧名） */
  releaseName(name: string): void {
    removeKey(`${NAME_PREFIX}${name}`);
  }

  // ─── 配置 ──

  /** 读全局配置（损坏/缺字段逐字段回退默认；合并纯函数在 domain） */
  loadConfig(): GlobalConfig {
    const raw = readJson(CONFIG_KEY);
    const config = mergeConfig(raw);
    // 旧档整表重置时只报一次性质说明；管理员此后的逐项关闭照旧生效
    if (raw !== undefined && storedWorkModePolicy(raw) < WORK_MODE_POLICY_V_ALL_ON) {
      console.warn("[mockplayer3] 工作模式启用表按新默认整表重置一次：全部模式默认启用（缺59），面板可逐项关回");
    }
    return config;
  }

  /** 配置直写（唯一合法调用方=SaveGate，同 writeRecord 纪律） */
  writeConfig(config: GlobalConfig): void {
    writeJson(CONFIG_KEY, config);
  }

  /** 配置默认值（装配期快照注入用） */
  static defaults(): GlobalConfig {
    return defaultConfig();
  }

  // ─── 绑定表（独立键域；写方=ItemVault 写穿，本类只做存取） ──

  /** 读某假人的槽位绑定表（损坏按缺失） */
  loadBinding(botId: number): StorageBinding | undefined {
    const parsed = readJson<StorageBinding>(`${BIND_PREFIX}${botId}`);
    if (parsed === undefined) return undefined;
    if (!isBindingShape(parsed)) {
      console.error(`[mockplayer3] 绑定表 ${BIND_PREFIX}${botId} 损坏已跳过`);
      return undefined;
    }
    return parsed;
  }

  /** 写穿绑定表（事件驱动，不经 SaveGate——解耦即其存在理由） */
  writeBinding(botId: number, binding: StorageBinding): void {
    writeJson(`${BIND_PREFIX}${botId}`, binding);
  }

  /** 删绑定表（删除假人时随三键齐删） */
  deleteBinding(botId: number): void {
    removeKey(`${BIND_PREFIX}${botId}`);
  }

  /** 全部绑定表 botId（启动对账：与 mp:bot:* 互验，孤儿绑定回收） */
  listBindingBotIds(): number[] {
    const ids: number[] = [];
    for (const id of world.getDynamicPropertyIds()) {
      if (!id.startsWith(BIND_PREFIX)) continue;
      const botId = Number(id.slice(BIND_PREFIX.length));
      if (Number.isInteger(botId) && botId >= 1) ids.push(botId);
    }
    return ids;
  }
}
