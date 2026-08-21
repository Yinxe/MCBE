// ─── 模组全局配置：默认配额/逐玩家配额/管理员名单 ──────
// 单键 `mockplayer:config` 存 ModConfig JSON，内存缓存一份副本；
// setter 写穿透落盘；getter 读内存。
// ⚠️ 早执行安全：构造时只建默认值不读 DP；持久化值须 Phase 4 `refresh()` 读取合并。

import { world } from "@minecraft/server";
import { createDefaultConfig, DEFAULT_MENU_TRIGGER_ITEM } from "../../rules/Types";
import type { ModConfig } from "../../rules/Types";
import { mergeStoredConfig } from "../ModConfigRules";

const CONFIG_KEY = "mockplayer:config";

export class McConfigStore {
  private config: ModConfig = createDefaultConfig();

  /** 当前配置（内存副本，外部只读；修改走 setter 写穿） */
  get(): ModConfig {
    return this.config;
  }

  /** 世界加载后调用：从 DP 读取持久化配置并合并（解析/合并规则在 core 纯函数） */
  refresh(): void {
    try {
      const raw = world.getDynamicProperty(CONFIG_KEY);
      if (typeof raw !== "string") {
        this.config = mergeStoredConfig(undefined);
        console.info(`[MockPlayer] 无全局配置，使用默认（defaultQuota=${this.config.defaultQuota}）`);
        return;
      }
      this.config = mergeStoredConfig(raw);
      console.info(`[MockPlayer] 全局配置已加载（defaultQuota=${this.config.defaultQuota}，逐人 ${Object.keys(this.config.quotas).length} 条，管理员 ${this.config.admins.length} 名）`);
    } catch (e: any) {
      console.error(`[MockPlayer] 全局配置加载失败，使用默认: ${e?.message ?? e}`);
      this.config = createDefaultConfig();
    }
  }

  /** 整配置替换（写穿） */
  set(config: ModConfig): void {
    this.config = config;
    this.persist();
  }

  /** 更新默认配额 */
  setDefaultQuota(quota: number): void {
    this.config.defaultQuota = Math.max(0, Math.floor(quota));
    this.persist();
  }

  /** 更新单个玩家配额（undefined = 删除覆盖恢复默认） */
  setPlayerQuota(playerName: string, quota: number | undefined): void {
    if (quota === undefined) {
      delete this.config.quotas[playerName];
    } else {
      this.config.quotas[playerName] = Math.max(0, Math.floor(quota));
    }
    this.persist();
  }

  /** 单个玩家生效配额（覆盖值 ?? 默认值） */
  quotaFor(playerName: string): number {
    const override = this.config.quotas[playerName];
    return override !== undefined ? override : this.config.defaultQuota;
  }

  /** 添加管理员名单成员 */
  addAdmin(playerName: string): void {
    if (!this.config.admins.includes(playerName)) {
      this.config.admins.push(playerName);
      this.persist();
    }
  }

  /** 移除管理员名单成员 */
  removeAdmin(playerName: string): void {
    const idx = this.config.admins.indexOf(playerName);
    if (idx >= 0) {
      this.config.admins.splice(idx, 1);
      this.persist();
    }
  }

  /** 设置世界重启自动上线 */
  setAutoOnlineOnRestart(enabled: boolean): void {
    this.config.autoOnlineOnRestart = enabled;
    this.persist();
  }

  /** 设置主人下线联动下线 */
  setOwnerOfflineAutoOffline(enabled: boolean): void {
    this.config.ownerOfflineAutoOffline = enabled;
    this.persist();
  }

  /** 工作模式是否启用（缺省启用） */
  isWorkModeEnabled(mode: string): boolean {
    return this.config.enabledWorkModes?.[mode] !== false;
  }

  /** 设置工作模式启用/禁用 */
  setWorkModeEnabled(mode: string, enabled: boolean): void {
    if (!this.config.enabledWorkModes) this.config.enabledWorkModes = {};
    if (enabled) {
      delete this.config.enabledWorkModes[mode];
    } else {
      this.config.enabledWorkModes[mode] = false;
    }
    // 清理空对象保持 JSON 简洁
    if (this.config.enabledWorkModes && Object.keys(this.config.enabledWorkModes).length === 0) {
      delete (this.config as any).enabledWorkModes;
    }
    this.persist();
  }

  /** 获取模组菜单触发信物物品 ID（null=仅命令） */
  getMenuTriggerItemId(): string | null {
    const v = this.config.menuTriggerItemId;
    return v === undefined ? DEFAULT_MENU_TRIGGER_ITEM : v;
  }

  /** 判断物品是否为模组菜单触发信物（null 时永远 false，仅命令可触发） */
  isMenuTrigger(itemTypeId: string | undefined): boolean {
    const trigger = this.getMenuTriggerItemId();
    if (trigger === null) return false;
    return itemTypeId === trigger;
  }

  /** 设置模组菜单触发信物（null=关闭物品触发，仅命令） */
  setMenuTriggerItemId(itemId: string | null): void {
    this.config.menuTriggerItemId = itemId;
    this.persist();
  }

  private persist(): void {
    try {
      world.setDynamicProperty(CONFIG_KEY, JSON.stringify(this.config));
    } catch (e: any) {
      console.error(`[MockPlayer] 全局配置保存失败: ${e?.message ?? e}`);
    }
  }
}