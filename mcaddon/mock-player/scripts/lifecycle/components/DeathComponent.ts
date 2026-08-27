// ─── 死亡复活组件（生命周期内聚） ─────────────
// 职责：死亡与重生的唯一管理者，集中处理
//   world.entityDie   → 死亡存储 + 死亡点 + botDeath 事件 + 自动重生 / 死亡下线
//   world.playerSpawn → 重生后状态同步 + botRespawn 事件
// 原逻辑分散于 events/entityDie.ts / events/playerSpawn.ts，现收敛于此。
// 为打破循环（ DeathComponent → tridentTracker → bootstrap/context → DeathComponent），
// 涉及 track 的调用采用动态 import 懒加载。

import { world, system, type EntityDieAfterEvent, type PlayerSpawnAfterEvent } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import type { PositionState } from "../../rules/Types";
import { EQUIP_SLOT_NAMES } from "../../rules/Types";
import { BOT_TAG, TAG_RESPAWN } from "../../rules/tags/BotTags";
import { BotEvents } from "../../events/DomainEvents";
import { syncEntityTags } from "../../features/basic/EntityTags";
import { formatPos } from "../../interaction/ui/format";
import { formatDimensionId } from "../../rules/format/Format";
import { captureExperience } from "../../features/basic/items";
import { setPose } from "../../features/basic/PoseGateway";
import type { LifecycleComponent } from "../LifecycleComponent";
import type { LifecycleContext } from "../LifecycleContext";

const RESPAWN_DELAY_TICKS = 20;

export class DeathComponent implements LifecycleComponent {
  readonly id = "death";
  readonly priority = 40;

  private ctx!: LifecycleContext;
  private dieHandler?: (e: EntityDieAfterEvent) => void;
  private spawnHandler?: (e: PlayerSpawnAfterEvent) => void;

  onRegister(ctx: LifecycleContext): void {
    this.ctx = ctx;
    this.dieHandler = (e) => { void this.handleDie(e).catch(err=>console.warn(`[Death] entityDie 异常: ${err?.message ?? err}`)); };
    this.spawnHandler = (e) => { void this.handleSpawn(e).catch(err=>console.warn(`[Death] playerSpawn 异常: ${err?.message ?? err}`)); };
    try { world.afterEvents.entityDie.subscribe(this.dieHandler); } catch (e: unknown) { const err = e as Error; console.warn(`[Death] 订阅 entityDie 失败: ${err?.message ?? String(err)}`); }
    try { world.afterEvents.playerSpawn.subscribe(this.spawnHandler); } catch (e: unknown) { const err = e as Error; console.warn(`[Death] 订阅 playerSpawn 失败: ${err?.message ?? String(err)}`); }
    console.info(`[Death] 已集中订阅 entityDie / playerSpawn（生命周期内聚）`);
  }

  onUnregister(_ctx: LifecycleContext): void {
    if (this.dieHandler) try { world.afterEvents.entityDie.unsubscribe(this.dieHandler); } catch {}
    if (this.spawnHandler) try { world.afterEvents.playerSpawn.unsubscribe(this.spawnHandler); } catch {}
    this.dieHandler = undefined;
    this.spawnHandler = undefined;
  }

  private async handleDie(event: EntityDieAfterEvent): Promise<void> {
    const entity = event.deadEntity;
    try { if (!entity.hasTag(BOT_TAG)) return; } catch { return; }
    const record = this.ctx.registry.get(entity.nameTag);
    if (!record) return;

    try {
      console.info(`[Death] entityDie ${record.name} @ ${entity.dimension.id} ${Math.floor(entity.location.x)} ${Math.floor(entity.location.y)} ${Math.floor(entity.location.z)}`);
      const bot = entity as unknown as SimulatedPlayer;
      const deathState: PositionState = {
        location: entity.location,
        dimension: entity.dimension.id,
        rotation: (bot as unknown as SimulatedPlayer).getRotation(),
        lookTarget: record.lastPoint?.lookTarget ?? record.respawnPoint.lookTarget,
      };

      record.death = true;
      this.recordDeathStorage(bot, record);
      console.info(`[Death] 死亡存储 ${record.name}`);

      record.deathPoint = deathState;
      record.lastPoint = null;
      this.ctx.save.saveRecord(record);

      BotEvents.botDeath.trigger({ botName: record.name, position: { x: deathState.location.x, y: deathState.location.y, z: deathState.location.z }, dimension: deathState.dimension });

      try { world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.error}${record.name} 死亡了 ${color.muted}@ ${formatPos(deathState.location)} ${color.darkGray}${formatDimensionId(deathState.dimension)}`); } catch {}

      if (await this.maybeAutoRespawn(bot, record)) return;
      await this.dieOffline(bot, record);
    } catch (e: unknown) { const err = e as Error; console.warn(`[Death] 处理异常 ${record.name}: ${err?.message ?? String(err)}`); }
  }

  private recordDeathStorage(bot: SimulatedPlayer, record: import("../../rules/Types").BotRecord): void {
    record.experience = captureExperience(bot as unknown as import("@minecraft/server").Player);
    for (const slot of EQUIP_SLOT_NAMES) {
      BotEvents.botEquipSlotChanged.trigger({ botName: record.name, slot: slot as import("../../rules/Types").EquipSlotName, via: "death" });
    }
  }

  private async maybeAutoRespawn(bot: SimulatedPlayer, record: import("../../rules/Types").BotRecord): Promise<boolean> {
    if (!record.tags.includes(TAG_RESPAWN.value)) return false;
    try {
      try { const { trackBotOffline } = await import("../../features/trident/tridentTracker"); trackBotOffline(bot.id); } catch {}
      bot.respawn();
      system.runTimeout(async () => {
        try {
          if (!bot.isValid) return;
          const dim = world.getDimension(record.respawnPoint.dimension);
          bot.teleport(record.respawnPoint.location, { dimension: dim });
          setPose(bot as unknown as import("@minecraft/server").Player, record.respawnPoint.rotation, record.respawnPoint.lookTarget);
          record.entityId = bot.id;
          syncEntityTags(bot as unknown as import("@minecraft/server").Player, record.tags);
          record.death = false;
          record.deathPoint = null;
          record.lastPoint = { ...record.respawnPoint };
          this.ctx.save.saveRecord(record);
          try { world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.accent}${record.name} 已自动复活`); } catch {}
        } catch (e: unknown){ const err = e as Error; try { world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.error}${record.name} 自动复活失败: ${err.message}`);} catch {}}
      }, RESPAWN_DELAY_TICKS);
      return true;
    } catch (e: unknown){ const err = e as Error; try { world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.error}${record.name} 自动重生失败: ${err.message}`);} catch {} return false; }
  }

  private async dieOffline(bot: SimulatedPlayer, record: import("../../rules/Types").BotRecord): Promise<void> {
    try { const { trackBotOffline } = await import("../../features/trident/tridentTracker"); trackBotOffline(bot.id); } catch {}
    record.online = false;
    record.entityId = undefined;
    this.ctx.save.saveRecord(record);
    try { bot.disconnect(); } catch {}
    BotEvents.botOffline.trigger({ botName: record.name });
    try { world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.playerName}${record.name} 已死亡下线`);} catch {}
  }

  private async handleSpawn(event: PlayerSpawnAfterEvent): Promise<void> {
    if (event.initialSpawn) return;
    const player = event.player as import("@minecraft/server").Player;
    try { if (!player.hasTag(BOT_TAG)) return; } catch { return; }
    const record = this.ctx.registry.get(player.name);
    if (!record) return;
    console.info(`[Death] playerSpawn(重生) ${record.name}`);
    record.death = false;
    record.online = true;
    record.entityId = player.id;
    try { const { trackBotOnline } = await import("../../features/trident/tridentTracker"); trackBotOnline(player.id, record.name); } catch {}
    try { syncEntityTags(player, record.tags); } catch {}
    this.ctx.save.saveRecord(record);
    try { world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.accent}${record.name} 重生了`);} catch {}
    BotEvents.botRespawn.trigger({ botName: record.name });
  }
}
