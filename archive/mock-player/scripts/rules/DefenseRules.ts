// ─── 防御规则（core 纯逻辑，零 @minecraft） ─────────────
// 威胁判定与防御决策：
//   - HOSTILE_TYPE_IDS：MCBE 敌对生物 typeId 集合（威胁感知过滤用；
//     MCBE 无家族 API，用 typeId 精确匹配——原版行为包数据源见
//     mcbe-vanilla-data-sources 记忆）
//   - 威胁信息 ThreatInfo 写入共享记忆（threat 键），防御目标读取
//   - 威胁时效（THREAT_TTL_TICKS）：感知停止后仍持续防御一阵（防抖）

/** MCBE 敌对生物 typeId（主世界/下界/末地；新增敌对生物在此追加） */
export const HOSTILE_TYPE_IDS: readonly string[] = [
  // 主世界
  "minecraft:zombie",
  "minecraft:zombie_villager",
  "minecraft:husk",
  "minecraft:drowned",
  "minecraft:skeleton",
  "minecraft:stray",
  "minecraft:bogged",
  "minecraft:spider",
  "minecraft:cave_spider",
  "minecraft:enderman",
  "minecraft:creeper",
  "minecraft:witch",
  "minecraft:slime",
  "minecraft:phantom",
  "minecraft:silverfish",
  "minecraft:warden",
  "minecraft:pillager",
  "minecraft:vindicator",
  "minecraft:evocation_illager",
  "minecraft:ravager",
  "minecraft:vex",
  "minecraft:guardian",
  "minecraft:elder_guardian",
  // 下界
  "minecraft:zombified_piglin",
  "minecraft:zoglin",
  "minecraft:hoglin",
  "minecraft:piglin_brute",
  "minecraft:blaze",
  "minecraft:ghast",
  "minecraft:magma_cube",
  "minecraft:wither_skeleton",
  // 末地
  "minecraft:endermite",
  "minecraft:shulker",
];

/** 威胁感知半径（格） */
export const THREAT_SCAN_RADIUS = 10;
/** 威胁时效（tick）：感知到威胁后，防御目标持续到该窗口过期（防抖/丢失检测容错） */
export const THREAT_TTL_TICKS = 40;
/** 防御攻击超时（tick）：攻击一个目标超过该时长 → 放弃（目标可能不可达/无敌） */
export const DEFENSE_ATTACK_TIMEOUT_TICKS = 200;
/** 防御攻击间隔（tick） */
export const DEFENSE_ATTACK_INTERVAL_TICKS = 5;

/** 威胁信息（写入共享记忆 threat 键） */
export interface ThreatInfo {
  /** 威胁实体 id */
  entityId: string;
  /** 威胁 typeId */
  typeId: string;
  /** 距离（格） */
  distance: number;
  /** 感知 tick（时效判定用） */
  seenAtTick: number;
}

/** typeId 是否敌对（精确匹配集合） */
export function isHostileTypeId(typeId: string): boolean {
  return HOSTILE_TYPE_IDS.includes(typeId);
}

/** 威胁是否仍有效（感知后 TTL 内） */
export function threatAlive(threat: ThreatInfo, tick: number): boolean {
  return tick - threat.seenAtTick < THREAT_TTL_TICKS;
}
