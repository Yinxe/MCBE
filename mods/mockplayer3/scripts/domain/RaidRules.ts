// ─── 劫掠规则（domain） ────────────────
// 零 @minecraft，可单测。闸门全过即扣一瓶，此后每 5 秒施加 4 秒袭击之兆，兆头到期即开袭。
// 机制事实：
//   - 和平难度不触发袭击，只拦和平；
//   - 袭击于 raid_omen 结束时所在位置的村庄范围内开始，故施加前先做村民/床存在感知；
//   - 村庄英雄挂身 40 分钟不主动移除，则下一次胜利不再触发 effectAdd；
//   - 袭击的胜负由原版机制判定：假人须在场挂机，袭击生物需由假人击杀才谈得上胜场，
//     本能力不做战斗，因此开张只是把开袭机会交给引擎，唯一确定的事实是胜利信号本身。

/** 不祥之瓶物品 ID */
export const OMINOUS_BOTTLE_ID = "minecraft:ominous_bottle";

/** 不祥之兆（停摆时需清理的残留兆头） */
export const BAD_OMEN = "minecraft:bad_omen";
/** 袭击之兆（本能力自施；到期即开袭） */
export const RAID_OMEN = "minecraft:raid_omen";
/** 村庄英雄（袭击胜利获得，40 分钟）——胜利唯一识别信号 */
export const VILLAGE_HERO = "minecraft:village_hero";

// ─── 持续施加节拍与瓶费 ──

/** 施加间隔（tick）：每 5 秒一轮 */
export const RAID_OMEN_GRANT_INTERVAL_TICKS = 100;
/** 单次时长（tick）：短于间隔以留出到期窗（兆头到期=开袭时刻） */
export const RAID_OMEN_GRANT_DURATION_TICKS = 80;
/** 袭击之兆等级（0=Lv.1；假人常驻刷袭不抬波次强度） */
export const RAID_OMEN_GRANT_AMPLIFIER = 0;
/** 瓶费：首次启动扣一瓶，此后每次胜利再扣一瓶 */
export const RAID_BOTTLE_COST = 1;

/** 村庄英雄剩余时长叠加上限（tick；引擎 addEffect 时长口径，防溢出） */
export const VILLAGE_HERO_MAX_DURATION = 20_000_000;

/** 物品类型匹配：Script API typeId 恒带命名空间前缀，直接精确比对 */
export function isOminousBottle(typeId: string): boolean {
  return typeId === OMINOUS_BOTTLE_ID;
}

/** 效果类型分类（用于 effectAdd 事件分流） */
export type RaidEffectType = "bad-omen" | "raid-omen" | "village-hero";

/** 识别劫掠相关效果类型，无关效果返回 undefined */
export function classifyRaidEffect(typeId: string): RaidEffectType | undefined {
  if (typeId === BAD_OMEN) return "bad-omen";
  if (typeId === RAID_OMEN) return "raid-omen";
  if (typeId === VILLAGE_HERO) return "village-hero";
  return undefined;
}

// ─── 启动闸门（难度 → 瓶数 → 村庄） ──
// 判定顺序即成本序：零成本的难度与瓶数在前，慢操作村庄扫描后置短路。

/** 村民实体类型 id（getEntities type 过滤口径） */
export const VILLAGER_TYPE = "minecraft:villager";

/** 床方块 typeId 全集（16 色 *_bed + 裸 bed 兜底——getBlocks includeTypes 口径） */
export const BED_BLOCK_IDS: readonly string[] = [
  "minecraft:bed",
  ...[
    "white",
    "orange",
    "magenta",
    "light_blue",
    "yellow",
    "lime",
    "pink",
    "gray",
    "light_gray",
    "cyan",
    "purple",
    "blue",
    "brown",
    "green",
    "red",
    "black",
  ].map((c) => `minecraft:${c}_bed`),
];

/** 村庄存在感知输入（engine 批量扫描产出；unreadable=区块/查询瞬态，不等于"没有"） */
export interface VillageScan {
  villagers: number;
  beds: number;
  unreadable: boolean;
}

/**
 * 村庄存在判定：村民或床任一命中即在村庄；感知失败（unreadable）保守放行。
 * @param scan engine 批量扫描产出的村庄感知输入
 * @returns 是否按"在村庄"处理
 */
export function judgeVillagePresence(scan: VillageScan): boolean {
  return scan.unreadable || scan.villagers > 0 || scan.beds > 0;
}

/** 和平难度判定（Difficulty 枚举字面量 'Peaceful'——domain 零 @minecraft） */
export function isPeacefulDifficulty(difficulty: string): boolean {
  return difficulty === "Peaceful";
}

/** 不在村庄提示（未扣瓶未施兆头即退） */
export const VILLAGE_ABSENT_MESSAGE =
  "附近没有村民也没有床——不在村庄范围内，袭击之兆不会引发袭击。请把假人带到村庄后重新开启劫掠模式";

/** 和平难度提示（只拦和平，简单照样放行） */
export const PEACEFUL_DIFFICULTY_MESSAGE = "当前难度为和平——袭击不会触发。请把难度调到简单/普通/困难后重新开启劫掠模式";

/** 无瓶提示（启动/胜利扣瓶失败；autoStop 归空闲的 reasons 同句） */
export const NO_BOTTLE_MESSAGE = `背包里没有不祥之瓶了（启动与每次胜利各消耗 ${RAID_BOTTLE_COST} 瓶），请补充后重新开启劫掠模式`;

/** 闸门失败因（一律落空闲退出；因别决定告知文案） */
export type RaidGateFail = "peaceful" | "no-bottle" | "no-village";

/** 闸门判决 */
export type RaidGate = { ok: true } | { ok: false; fail: RaidGateFail; message: string };

/**
 * 启动/续跑闸门：难度 → 瓶数 → 村庄，任一不合格给出中文原因与因别。
 * @param difficulty 引擎 Difficulty 枚举字符串（读取失败传 ""——保守放行）
 * @param bottles 背包不祥之瓶总数（不可读按 0）
 * @param scanVillage 村庄感知惰性供给（前两道放行后才执行）
 */
export function diagnoseRaidGate(difficulty: string, bottles: number, scanVillage: () => VillageScan): RaidGate {
  if (difficulty && isPeacefulDifficulty(difficulty)) {
    return { ok: false, fail: "peaceful", message: PEACEFUL_DIFFICULTY_MESSAGE };
  }
  if (bottles < RAID_BOTTLE_COST) {
    return { ok: false, fail: "no-bottle", message: NO_BOTTLE_MESSAGE };
  }
  if (!judgeVillagePresence(scanVillage())) {
    return { ok: false, fail: "no-village", message: VILLAGE_ABSENT_MESSAGE };
  }
  return { ok: true };
}

// ─── 胜利播报文案（数字全由调用侧实读卡填充，纯函数可测） ──

/** 胜利瓶费口径（播报分叉） */
export type RaidVictoryFee = "charged" | "absent" | "unpaid";

/**
 * 胜利播报：向主人播报累计胜场与本轮村庄英雄；本轮胜利是劫掠唯一确定的事实。
 * @param name 假人显示名
 * @param bottlesLeft 本瓶扣除后剩余数（仅 fee=charged 有意义）
 * @param victories 累计胜场（含本轮）
 * @param hero 本轮读到的村庄英雄（不可读 undefined——只报胜场，不报等级）
 * @param fee charged=本瓶已扣；absent=假人不在场只记账未扣瓶；unpaid=在场但未扣瓶（无瓶或持续位已停）
 */
export function raidVictoryReport(
  name: string,
  bottlesLeft: number,
  victories: number,
  hero: EffectInfo | undefined,
  fee: RaidVictoryFee = "charged"
): string {
  const heroPart = hero
    ? `获得村庄英雄 Lv.${hero.amplifier + 1}（约 ${Math.round(hero.duration / 1200)} 分钟）`
    : "本轮村庄英雄效果读取失败，未能转移";
  let feePart = "，本瓶未扣";
  if (fee === "charged") feePart = `，本瓶已扣，剩余 ${bottlesLeft} 瓶`;
  else if (fee === "absent") feePart = "，假人不在场，本瓶未扣";
  return `${name} 劫掠胜利（累计 ${victories} 胜）：${heroPart}${feePart}`;
}

// ─── 村庄英雄叠加（移除假人英雄前把它叠给主人） ──

/**
 * 效果摘要。
 *
 * `duration` 是引擎 {@link Effect} 的 duration 字段：ScriptAPI 定义为
 * "entire specified duration"（施加时的总时长，单位 tick），不是剩余时长。
 * 合并因此是对两个总时长求和，播报口径同步写作"约 N 分钟"。
 */
export interface EffectInfo {
  amplifier: number;
  duration: number;
}

/**
 * 村庄英雄合并：总时长相加（封顶 {@link VILLAGE_HERO_MAX_DURATION}）、等级取高。
 * 时长下限 1 tick——引擎 addEffect 的 duration 界为 [1, 20000000]，0 会抛错。
 * @param hero 假人身上待转移的英雄效果
 * @param owner 主人已有英雄效果（无 → undefined）
 */
export function mergeVillageHero(hero: EffectInfo, owner: EffectInfo | undefined): EffectInfo {
  return {
    amplifier: Math.max(hero.amplifier, owner?.amplifier ?? 0),
    duration: Math.min(Math.max(1, hero.duration + (owner?.duration ?? 0)), VILLAGE_HERO_MAX_DURATION),
  };
}

/**
 * 英雄转移结果（胜利旁路据此决定是否另发一条消息）。
 * `transferred`= 已叠给主人；`ownerOffline`= 主人不在线（已世界公告）；`noOwner`= 假人无主；
 * `grantFailed`= 主人在场但效果写入失败（需私信主人）；`noHeroOnBot`= 假人身上已无英雄效果
 * （该事实已写进首条胜利播报）。
 */
export type HeroTransfer = "transferred" | "ownerOffline" | "noOwner" | "grantFailed" | "noHeroOnBot";

/** 主人不在线（世界公告，胜场已计入） */
export function heroOwnerOfflineNotice(botName: string, ownerName: string): string {
  return `${botName} 的村庄英雄未能转移：主人 ${ownerName} 不在线`;
}

/**
 * 叠加成功公告。
 * @param merged {@link mergeVillageHero} 的结果
 */
export function heroTransferredNotice(botName: string, ownerName: string, merged: EffectInfo): string {
  return `${botName} 的村庄英雄已叠加给 ${ownerName}（Lv.${merged.amplifier + 1}，约 ${Math.round(merged.duration / 1200)} 分钟）`;
}

/** 写入失败私信（假人英雄仍必须清除——挂着则下次胜利不再触发信号） */
export const HERO_GRANT_FAILED_MESSAGE =
  "村庄英雄未能叠加到你身上（效果写入失败），已从假人身上清除；本轮仅计入胜场，下一轮胜利照常结算";

// ─── 劫掠会话状态形状（按假人存活于 Runtime，删假人才全清，防同名重建继承；
//     胜场持久化在记录，此处不留内存副本） ──

/** 一个假人的劫掠状态（纯数据；读写在 application） */
export interface RaidFlowState {
  /** 已在持续施加（进入即扣瓶；停机/无瓶/停摆清位） */
  sustaining: boolean;
  /** 下次施加袭击之兆的 tick（进入持续时=now，到点即施） */
  grantAt: number;
  /** 最近村庄英雄效果事件 tick（胜利处理幂等判定） */
  lastHeroTick: number;
  /** 已处理的英雄事件 tick（防 removeEffect 失败重复叠加） */
  handledHeroTick: number;
  /** 村庄英雄移除失败待重试（挂身期间下次胜利不再触发 effectAdd） */
  heroRemovalPending: boolean;
}

/** 初始劫掠状态（tick 基准 -Infinity，首轮事件必被处理） */
export function createRaidFlowState(): RaidFlowState {
  return {
    sustaining: false,
    grantAt: -Infinity,
    lastHeroTick: -Infinity,
    handledHeroTick: -Infinity,
    heroRemovalPending: false,
  };
}
