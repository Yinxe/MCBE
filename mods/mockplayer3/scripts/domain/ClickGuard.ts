// ─── 假人功能方块误点拦截判据（domain 纯逻辑） ────────────────
// 只出判据不碰世界：engine 侧照本表判定执行 cancel。名单写死，不再有管理员开关。
// 拦的是"点开就弹 UI 或改状态"的 GUI/容器类方块：假人会自己打开容器界面，或错开别人的容器。
// 宝库不拦：宝库只在宝库模式有意开箱时才交互，路过假人不无故右键它，纳入名单反而误伤有意开箱以外的场景。
// 门/按钮/拉杆/活板门不拦：误动没有 UI 之害，而且可能就是想要的行为。
// 有意交互（宝库开箱、面板"前方交互"）靠许可窗放行：
// 按住期间引擎逐 tick 重复触发事件，所以许可必须是一段计时窗，不能是取走即失效的
// 一次性令牌，否则第二拍的重复事件会被自己拦下。

// ─── 方块分档 ──

/**
 * 纳入拦截的 GUI/容器类方块（基线名，不含宝库）。铜箱/潜影盒的染色与打蜡变体量大且只会增加，
 * 由 isClickGuardBlockedBlock 的后缀规则匹配，不在此逐色枚举。
 */
export const CLICK_GUARD_BLOCKED_BLOCKS: ReadonlySet<string> = new Set<string>([
  "minecraft:chest",
  "minecraft:trapped_chest",
  "minecraft:ender_chest",
  "minecraft:barrel",
  "minecraft:shulker_box",
  "minecraft:dispenser",
  "minecraft:dropper",
  "minecraft:hopper",
  "minecraft:furnace",
  "minecraft:lit_furnace",
  "minecraft:blast_furnace",
  "minecraft:lit_blast_furnace",
  "minecraft:smoker",
  "minecraft:lit_smoker",
  "minecraft:crafting_table",
  "minecraft:stonecutter_block",
  "minecraft:fletching_table",
  "minecraft:cartography_table",
  "minecraft:loom",
  "minecraft:grindstone",
  "minecraft:smithing_table",
  "minecraft:enchanting_table",
  "minecraft:brewing_stand",
  "minecraft:anvil",
  "minecraft:chipped_anvil",
  "minecraft:damaged_anvil",
  "minecraft:noteblock",
  "minecraft:jukebox",
  "minecraft:beacon",
  "minecraft:lodestone",
  "minecraft:bed",
  "minecraft:chiseled_bookshelf",
  "minecraft:decorated_pot",
  "minecraft:command_block",
  "minecraft:chain_command_block",
  "minecraft:repeating_command_block",
  "minecraft:structure_block",
  "minecraft:jigsaw",
]);

/** 变体后缀（铜箱全系 / 潜影盒全系——新染色件免维护自动入列） */
const BLOCKED_TYPE_SUFFIXES: readonly string[] = ["_chest", "_shulker_box"];

/**
 * 该方块是否在拦截名单内。
 * @param typeId - 方块 typeId（含命名空间）
 */
export function isClickGuardBlockedBlock(typeId: string): boolean {
  if (CLICK_GUARD_BLOCKED_BLOCKS.has(typeId)) return true;
  return BLOCKED_TYPE_SUFFIXES.some((suffix) => typeId.endsWith(suffix));
}

// ─── 判定 ──

/**
 * 一次假人方块点击该不该取消。
 * 判定顺序：该假人已被发放许可（许可仍生效）一律放行 → 命中拦截名单即拦 → 其余永不拦。
 * @param typeId - 被点方块 typeId
 * @param permitted - 该假人此刻是否处于有意交互的许可期内
 * @returns true = cancel（拦下这次点击）
 */
export function judgeBlockClick(typeId: string, permitted: boolean): boolean {
  if (permitted) return false;
  return isClickGuardBlockedBlock(typeId);
}

// ─── 交互许可记录 ──

/** 许可窗时长（tick）：交互发起后这段时间内的重复事件一律放行 */
export const CLICK_PERMIT_TTL_TICKS = 2;

/**
 * 有意交互许可记录（纯状态，tick 由调用方注入，与 Pool/CoordSet 同一口径）。
 * 按 botId 保存：假人同名重建或会话复用时，残留的许可会串到新会话，
 * 因此 forget 必须同时挂在下线与删除两处。
 */
export class ClickPermits {
  private readonly grantedAt = new Map<number, number>();

  /** 发放许可（调用点=假人自己的交互原子发起前） */
  grant(botId: number, nowTick: number): void {
    this.grantedAt.set(botId, nowTick);
  }

  /** 此刻是否仍在许可期内（从发放那一拍起算，含落在许可期末尾的重复事件拍） */
  permitted(botId: number, nowTick: number): boolean {
    const at = this.grantedAt.get(botId);
    if (at === undefined) return false;
    const elapsed = nowTick - at;
    return elapsed >= 0 && elapsed <= CLICK_PERMIT_TTL_TICKS;
  }

  /** 会话销毁时删除该 botId 的许可记录（防 botId 复用串状态） */
  forget(botId: number): void {
    this.grantedAt.delete(botId);
  }
}
