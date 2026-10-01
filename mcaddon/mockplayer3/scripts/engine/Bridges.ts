// ─── 世界事件桥（只报告不驱动） ────────────────────────────────────
// 实体/玩家事件的订阅与转发；本文件不读写记录、不驱动管线，application 层的
// 对账回调是唯一消费者。回调内一律 try-catch 隔离（F-18）。
// 发布死亡回调上下文标志：2.8.0 无 entityDie before 事件，
// afterEvents.entityDie 回调内短期实体仍可读（F-04），respawn 只能发生在该
// 窗口——respawner 原子凭 isDeathCallbackContext() 校验调用窗口。

import { Player, world } from "@minecraft/server";
import type { Block, Entity, ItemStack } from "@minecraft/server";
import { BOT_MARKER_TAG } from "../domain/Record";
import { itemEnchantments } from "./Atomic";
import { isBridgeTrackedEntity } from "./ProjectileTracker";

export interface BridgeHandlers {
  /** entityDie：死亡瞬间是抓遗态快照的唯一窗口（F-04）。只传纯数据（id/名字），
   * 实体句柄经 EntityGateway.byId 在同一 tick 内回取（死亡窗口仍可读） */
  onEntityDie?(entityId: string, entityName: string): void;
  /** playerSpawn after：initialSpawn=true 时库存尚未就绪（F-05） */
  onPlayerSpawn?(entityId: string, playerName: string, initialSpawn: boolean): void;
  /** playerLeave after：名字+离开时实体 id（供反查/幽灵过滤）；真实玩家也转发（联动下线需要） */
  onPlayerLeave?(playerName: string, playerId: string): void;
  /** playerJoin after：同样只有名字——实体重解析走 EntityGateway（F-05） */
  onPlayerJoin?(playerName: string): void;
  /** entitySpawn after（仅受跟踪投射物/鱼钩，桥内降噪）：句柄经 rawEntity 回取 */
  onProjectileSpawn?(entityId: string): void;
  /** entityLoad after（同上过滤；区块重载/重启路径） */
  onProjectileLoad?(entityId: string): void;
  /**
   * 假人库存槽位变化 after（真人不转发）：工具守护的世界真值源 +
   * 钓鱼战利品事件收集源。item=变化后槽位摘要（含附魔、清槽为
   * undefined——摘要纯数据上达，句柄不出桥）。
   */
  onBotInventoryChanged?(
    botName: string,
    slot: number,
    item?: { typeId: string; amount: number; enchantments: { id: string; level: number }[] }
  ): void;
  /**
   * 假人受伤 after（entityHurt 假人限定降噪）：装备耐久复查落盘的触发源
   * （掉血未判也算——护甲吸收同样耗耐久）。
   */
  onBotHurt?(botName: string): void;
  /**
   * 假人获得状态效果 after（假人限定桥内降噪——effectAdd 全站实体高频，
   * 真人/怪物不转发）。typeId/amplifier 纯数据上达，分流归应用层。
   */
  onBotEffectAdded?(botName: string, typeId: string, amplifier: number): void;
  /**
   * 信物候选 after（真人限定桥内降噪，此类事件唯一注册点）：配置匹配与弹菜单
   * 归 interface；开表单须再 system.run（itemUse 回调上下文不能直接开表单）。
   */
  onRealPlayerItemUse?(playerName: string, itemTypeId: string): void;
  /**
   * 点击假人 before（目标假人→桥内 cancel 后转发，真人源限定——假人自身
   * 交互不截获不转发）：只报数据，站立/潜行分流与表单由 interface 在
   * system.run 内重读判定（F-11：before 回调内不能开表单）。
   */
  onBotInteract?(viewerName: string, botName: string): void;
  /**
   * 假人点击方块 before（假人限定桥内降噪，真人点击一律不参与判定）：
   * 返回 true = 取消这次点击（误点拦截）。须同步给结论，本回调是桥里唯一
   * 带返回值的缝——消费方只读配置与交互许可记录，不碰世界；抛穿或返回非 true
   * 一律保守放行（绝不误杀作业）。
   */
  onBotBlockClick?(botName: string, blockTypeId: string): boolean;
}

/** 死亡回调上下文标志（同步回调期间为 true——respawner 原子调用窗口门） */
let deathCallbackContext = false;

/** 当前是否处于死亡处理窗口（respawn 调用窗口校验面） */
export function isDeathCallbackContext(): boolean {
  return deathCallbackContext;
}

function isBotEntity(entity: { hasTag(tag: string): boolean }): boolean {
  try {
    return entity.hasTag(BOT_MARKER_TAG);
  } catch {
    // 实体瞬态失效
    return false;
  }
}

/**
 * 安装事件桥（启动时调用一次）。
 * @returns 全量退订函数
 */
export function installBridges(handlers: BridgeHandlers): () => void {
  const onDie = (event: { deadEntity: Entity }): void => {
    const dying = event.deadEntity;
    // 2.8.0 Entity 面无 name——instanceof Player 收窄后再读
    if (!(dying instanceof Player) || !isBotEntity(dying)) return;
    deathCallbackContext = true;
    try {
      handlers.onEntityDie?.(dying.id, dying.name);
    } catch (e: any) {
      console.error(`[mockplayer3] 死亡对账异常: ${e?.message ?? e}`);
    } finally {
      deathCallbackContext = false;
    }
  };

  const onSpawn = (event: { player: Player; initialSpawn: boolean }): void => {
    // 真人进场无需转发（联动下线走 playerLeave，无自动上线征询）
    if (!isBotEntity(event.player)) return;
    try {
      handlers.onPlayerSpawn?.(event.player.id, event.player.name, event.initialSpawn);
    } catch (e: any) {
      console.error(`[mockplayer3] 出生对账异常: ${e?.message ?? e}`);
    }
  };

  const onLeave = (event: { playerName: string; playerId: string }): void => {
    try {
      handlers.onPlayerLeave?.(event.playerName, event.playerId);
    } catch (e: any) {
      console.error(`[mockplayer3] 离开对账异常: ${e?.message ?? e}`);
    }
  };

  const onJoin = (event: { playerName: string }): void => {
    // join 只给名字且无实体引用（F-05）——是否假由应用层反查名字索引，
    // 实体重解析走 EntityGateway（桥不做 getPlayers，纪律在网关独享）
    try {
      handlers.onPlayerJoin?.(event.playerName);
    } catch (e: any) {
      console.error(`[mockplayer3] 加入对账异常: ${e?.message ?? e}`);
    }
  };

  const onProjectileSpawn = (event: { entity: Entity }): void => {
    try {
      if (!isBridgeTrackedEntity(event.entity.typeId)) return;
      handlers.onProjectileSpawn?.(event.entity.id);
    } catch (e: any) {
      console.error(`[mockplayer3] 投射物生成对账异常: ${e?.message ?? e}`);
    }
  };

  const onProjectileLoad = (event: { entity: Entity }): void => {
    try {
      if (!isBridgeTrackedEntity(event.entity.typeId)) return;
      handlers.onProjectileLoad?.(event.entity.id);
    } catch (e: any) {
      console.error(`[mockplayer3] 投射物加载对账异常: ${e?.message ?? e}`);
    }
  };

  const onInvChange = (event: { player: Player; slot: number; itemStack?: ItemStack }): void => {
    try {
      if (!isBotEntity(event.player)) return;
      const stack = event.itemStack;
      handlers.onBotInventoryChanged?.(
        event.player.name,
        event.slot,
        stack ? { typeId: stack.typeId, amount: stack.amount, enchantments: itemEnchantments(stack) } : undefined
      );
    } catch (e: any) {
      console.error(`[mockplayer3] 库存变更对账异常: ${e?.message ?? e}`);
    }
  };

  const onEffectAdd = (event: { effect: { typeId: string; amplifier: number }; entity: Entity }): void => {
    try {
      // 2.8.0 Entity 面无 name——判定方式同死亡桥：instanceof 收窄
      if (!(event.entity instanceof Player) || !isBotEntity(event.entity)) return;
      handlers.onBotEffectAdded?.(event.entity.name, event.effect?.typeId ?? "", event.effect?.amplifier ?? 0);
    } catch (e: any) {
      console.error(`[mockplayer3] 效果对账异常: ${e?.message ?? e}`);
    }
  };

  const onHurt = (event: { hurtEntity: Entity }): void => {
    try {
      // 假人受伤限定（instanceof 收窄同死亡桥）——真人/怪物不转发
      if (!(event.hurtEntity instanceof Player) || !isBotEntity(event.hurtEntity)) return;
      handlers.onBotHurt?.(event.hurtEntity.name);
    } catch (e: any) {
      console.error(`[mockplayer3] 受伤对账异常: ${e?.message ?? e}`);
    }
  };

  const onItemUse = (event: { source: Player; itemStack?: ItemStack }): void => {
    try {
      // 假人自身使用物品不触发菜单
      if (isBotEntity(event.source)) return;
      handlers.onRealPlayerItemUse?.(event.source.name, event.itemStack?.typeId ?? "");
    } catch (e: any) {
      console.error(`[mockplayer3] 信物对账异常: ${e?.message ?? e}`);
    }
  };

  const onInteractBlock = (event: { cancel: boolean; player: Player; block: Block }): void => {
    try {
      if (!isBotEntity(event.player)) return; // 真人点击零影响
      if (handlers.onBotBlockClick?.(event.player.name, event.block.typeId) === true) event.cancel = true;
    } catch (e: any) {
      console.error(`[mockplayer3] 假人点击判定异常: ${e?.message ?? e}`);
    }
  };

  const onInteractEntity = (event: { cancel: boolean; player: Player; target: Entity }): void => {
    try {
      // 2.8.0 Entity 面无 name——instanceof Player 收窄后读（同死亡桥）
      const target = event.target;
      if (!(target instanceof Player) || !isBotEntity(target)) return;
      if (isBotEntity(event.player)) return; // 假人自身交互（攻击/作业）不截获不转发
      event.cancel = true;
      handlers.onBotInteract?.(event.player.name, target.name);
    } catch (e: any) {
      console.error(`[mockplayer3] 假人交互对账异常: ${e?.message ?? e}`);
    }
  };

  world.afterEvents.entityDie.subscribe(onDie);
  world.afterEvents.playerSpawn.subscribe(onSpawn);
  world.afterEvents.playerLeave.subscribe(onLeave);
  world.afterEvents.playerJoin.subscribe(onJoin);
  world.afterEvents.entitySpawn.subscribe(onProjectileSpawn);
  world.afterEvents.entityLoad.subscribe(onProjectileLoad);
  world.afterEvents.playerInventoryItemChange.subscribe(onInvChange);
  world.afterEvents.effectAdd.subscribe(onEffectAdd);
  world.afterEvents.entityHurt.subscribe(onHurt);
  world.afterEvents.itemUse.subscribe(onItemUse);
  world.beforeEvents.playerInteractWithEntity.subscribe(onInteractEntity);
  world.beforeEvents.playerInteractWithBlock.subscribe(onInteractBlock);

  return () => {
    try {
      world.afterEvents.entityDie.unsubscribe(onDie);
    } catch {
      /* 退订失败不阻塞 */
    }
    try {
      world.afterEvents.playerSpawn.unsubscribe(onSpawn);
    } catch {
      /* 忽略 */
    }
    try {
      world.afterEvents.playerLeave.unsubscribe(onLeave);
    } catch {
      /* 忽略 */
    }
    try {
      world.afterEvents.playerJoin.unsubscribe(onJoin);
    } catch {
      /* 忽略 */
    }
    try {
      world.afterEvents.entitySpawn.unsubscribe(onProjectileSpawn);
    } catch {
      /* 忽略 */
    }
    try {
      world.afterEvents.entityLoad.unsubscribe(onProjectileLoad);
    } catch {
      /* 忽略 */
    }
    try {
      world.afterEvents.playerInventoryItemChange.unsubscribe(onInvChange);
    } catch {
      /* 忽略 */
    }
    try {
      world.afterEvents.effectAdd.unsubscribe(onEffectAdd);
    } catch {
      /* 忽略 */
    }
    try {
      world.afterEvents.entityHurt.unsubscribe(onHurt);
    } catch {
      /* 忽略 */
    }
    try {
      world.afterEvents.itemUse.unsubscribe(onItemUse);
    } catch {
      /* 忽略 */
    }
    try {
      world.beforeEvents.playerInteractWithEntity.unsubscribe(onInteractEntity);
    } catch {
      /* 忽略 */
    }
    try {
      world.beforeEvents.playerInteractWithBlock.unsubscribe(onInteractBlock);
    } catch {
      /* 忽略 */
    }
  };
}
