// ─── 行为标签 + 帮助 ──────────────────────────────────
// 行为菜单（ModalForm）：提交时 **① setTags 先落库**（标签首先更新，
// record.tags 已是最新 + 实体同步 + 持久化），**② 发布 behaviorSubmitted
// 领域事件**（负载带表单参数 + tags）——各功能模块独立订阅，感知自己
// 感兴趣的字段执行，UI 不再直接调用任何业务动作函数。
//
// 表单布局（用户拍板）：自动重生置顶、强加载第 2；
// 互斥行为（工作模式下拉，单选）：闲逛/挖掘/放置/攻击/劫掠/钓鱼等；劫掠已收编进互斥菜单（workMode="raid"）。

import { Player, system, world } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { TAG_BOT, TAG_RESPAWN, getTagDef, computeTagsFromBehaviorForm } from "../../../rules/tags/BotTags";
import { WORK_MODES, setWorkMode, type WorkMode } from "../../../features/state/behavior";
import { BotUiEvent } from "../../../events/UiEvents";
import { canManageBot, autoClaim } from "../../commands/auth";
import { resolveUiBotRecord } from "../helpers";
import { setTags } from "../../../features/state/setTags";
import { isFollowing } from "../../../features/state/follow";

// ─── UI 事件订阅（BOT 主菜单 → 感知行为标签动作） ──────

/** 订阅 BOT 主菜单动作事件：行为标签 → 弹表单 */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "openBehavior") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    showTagManagement(player, e.botName);
  });
}

// ─── 行为标签管理（含 上线/潜行 快捷开关） ───────────

export function showTagManagement(player: Player, botName: string): void {
  const record = resolveUiBotRecord(player, botName);
  if (!record) return;
  // ⚠️ 权限守卫：本面板可改他人假人的标签/生成模式/潜行/跟随，
  // 入口可达自潜行长按假人（playerInteractWithEntity），必须校验管理权
  // 无主假人（旧版升级数据）：首次打开 tag 菜单 → 自动认领成为主人（静默标记）
  if (!canManageBot(player, record)) {
    if (autoClaim(player, record)) {
      player.sendMessage(`${color.success}已自动认领假人 ${color.playerName}${botName}${color.success}（旧版数据，首次操作生效）`);
    } else {
      player.sendMessage(`${color.error}假人 ${color.playerName}${botName}${color.error} 只允许主人或管理员操作`);
      return;
    }
  }

  // 共存标签（除 bot 标识外）：仅自动重生为可共存开关（自动跳跃已移除）

  // 工作模式下拉值列表 + 索引映射（从 canonical 列表 WORK_MODES 派生——
  // 与各引擎同源，避免三处手抄漏同步，审核 L4）
  const WORK_MODE_OPTIONS: readonly WorkMode[] = WORK_MODES;
  const WORK_MODE_INDEX: Record<string, number> = Object.fromEntries(WORK_MODES.map((b, i) => [b, i]));

  const currentTagsText = record.tags
    .map((t) => { const d = getTagDef(t); return d ? d.label : t; })
    .join(" · ");

  const builder = new ModalFormBuilder()
    .title(`${color.bold}行为 · ${botName}`)
    .label("current", `${color.accent}当前: ${color.black}${currentTagsText}`)
    // ── 置顶：自动重生（最常用开关） ──
    .toggle("respawn", style("自动重生", color.playerName), {
      defaultValue: record.tags.includes(TAG_RESPAWN.value),
      tooltip: "死亡后自动复活到重生点",
    })
    // ── 第 2：强加载模式 ──
    .toggle("chunkload", style("强加载模式", color.playerName), {
      defaultValue: record.spawnMode === "chunkload",
      tooltip: "区块持续加载，体态完全可操控。异地上线仅加载当前区块附近，需玩家靠近补足模拟距离；重新上线后需再次靠近。切换时自动重新上线",
    })
    .label("sep1", style("━━ 其他开关 ────", color.accent))
    // ── 潜行 ──
    .toggle("sneaking", style("潜行", color.playerName), {
      defaultValue: record.isSneaking,
      tooltip: record.isSneaking ? "关闭将站起" : "开启将使假人潜行",
    })
    // ── 使用物品（独立普通开关，每次打开默认关） ──
    .toggle("useItem", style("使用物品", color.accent), {
      defaultValue: false,
      tooltip: "勾选提交＝使用主手物品并约 2 秒后自动停下（吃完喝完）；取消提交＝立即停止。一次性动作，默认关闭",
    })
    // ── 自动跟随（独立开关，record.following 状态） ──
    .toggle("follow", style("自动跟随", color.playerName), {
      defaultValue: isFollowing(botName),
      tooltip: "开启后假人会持续跟随你",
    })
    .label("sep2", style("━━ 工作模式 ────", color.accent))
    // ── 工作模式（用户拍板：单选互斥——一个假人一个工作模式） ──
    .dropdown(
      "workMode",
      style("工作模式（仅选一项，互斥）", color.accent),
      [
        style("无", color.muted),
        style("闲逛模式", color.playerName),
        style("定点挖掘模式", color.playerName),
        style("定点放置模式", color.playerName),
        style("定点攻击模式", color.playerName),
        style("劫掠模式", color.warn),
        style("自动钓鱼模式", color.accent),
      ],
      {
        defaultValueIndex: WORK_MODE_INDEX[record.workMode] ?? 0,
        tooltip: "单选工作模式（互斥，仅一项）：闲逛模式（近点散步）/ 定点挖掘模式（视线挖方块）/ 定点放置模式（面前放方块）/ 定点攻击模式（攻击面前目标）/ 劫掠模式（喝不祥之瓶刷袭击）/ 自动钓鱼模式（生物 AI + 共享钓鱼点，自动就位抛竿收竿）",
      },
    );

  builder.show(player).then((vals) => {
    if (!vals) return;
    const currentRecord = resolveUiBotRecord(player, botName);
    if (!currentRecord) return;

    // ── 表单 → 标签计算（core 纯函数：共存勾选） ──
    const workModeSel = vals.workMode as number;
    const pickedWorkMode = WORK_MODE_OPTIONS[workModeSel] ?? "none";
    const coexist: string[] = [];
    if (vals.respawn as boolean) coexist.push(TAG_RESPAWN.value);
    const newTags = computeTagsFromBehaviorForm({ coexist });
    // 工作模式落库延迟到 system.run 内、标签校验成功后（审核 M1：
    // 避免 setTags 校验失败时模式字段已改写——部分应用残留）
    // setWorkMode(currentRecord, pickedWorkMode);

    // 一次性使用开关：勾选提交=使用一次（自动停下），取消提交=停止一次。
    // 开关本身不落库（用后即停，无持续状态），每次打开行为菜单都默认关。
    const useItemOn = vals.useItem as boolean;
    const wantSneaking = vals.sneaking as boolean;
    const wantChunkload = vals.chunkload as boolean;
    const wantFollow = vals.follow as boolean;

    system.run(() => {
      // ── ① 标签先落库（record.tags 最新 + 实体同步 + 持久化） ──
      // 校验失败（正常表单不会触发，防御脏数据）则不落库、不发布事件
      const rejected = setTags(currentRecord, newTags, player);
      if (rejected) {
        player.sendMessage(`${color.error}${rejected}`);
        return;
      }
      // ── ② 工作模式落库（record.workMode 字段——驱动引擎按值启动；
      //     与标签同一 system.run 块、标签校验通过后才写——防部分应用） ──
      setWorkMode(currentRecord, pickedWorkMode);
      // ── ③ 发布行为菜单提交领域事件（负载带表单参数 + tags） ──
      BotUiEvent.behaviorSubmitted.trigger({
        playerId: player.id,
        botName,
        sneaking: wantSneaking,
        chunkload: wantChunkload,
        follow: wantFollow,
        useItem: useItemOn,
        coexist,
        workMode: pickedWorkMode,
        tags: newTags,
      });
    });

    player.sendMessage(`${color.success}已更新 ${color.playerName}${botName}${color.success} 的行为设置`);
  });
}
