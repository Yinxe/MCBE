// ─── 行为标签 + 帮助 ──────────────────────────────────
// 行为菜单（ModalForm）：提交时 **① setTags 先落库**（标签首先更新，
// record.tags 已是最新 + 实体同步 + 持久化），**② 发布 behaviorSubmitted
// 领域事件**（负载带表单参数 + tags）——各功能模块独立订阅，感知自己
// 感兴趣的字段执行，UI 不再直接调用任何业务动作函数。
//
// 表单布局（用户拍板）：自动重生置顶、强加载第 2；
// 互斥行为（工作模式下拉，单选）：闲逛/挖掘/放置/攻击/劫掠/钓鱼/跟随等；劫掠与跟随已收编进互斥菜单；使用物品已移至主菜单按钮。

import { Player, system, world } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { TAG_BOT, TAG_RESPAWN, getTagDef, computeTagsFromBehaviorForm } from "../../../rules/tags/BotTags";
import { WORK_MODES, setWorkMode, type WorkMode } from "../../../features/state/behavior";
import { configStore } from "../../../bootstrap/context";
import { BotUiEvent } from "../../../events/UiEvents";
import { canManageBot, autoClaim } from "../../commands/auth";
import { resolveUiBotRecord } from "../helpers";
import { setTags } from "../../../features/state/setTags";
import { parseCoordinateInput } from "../../../rules/coords/Coordinate";
import { normalizeScriptProgram } from "../../../rules/script/ScriptRules";
import { spotAtStand } from "../../../features/basic/fishing";
import { showScriptPanel } from "./script";

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
      player.sendMessage(
        `${color.success}已自动认领假人 ${color.playerName}${botName}${color.success}（旧版数据，首次操作生效）`
      );
    } else {
      player.sendMessage(`${color.error}假人 ${color.playerName}${botName}${color.error} 只允许主人或管理员操作`);
      return;
    }
  }

  // 共存标签（除 bot 标识外）：仅自动重生为可共存开关（自动跳跃已移除）

  // 工作模式下拉值列表 + 索引映射（从 canonical 列表 WORK_MODES 派生——
  // 与各引擎同源，避免三处手抄漏同步，审核 L4；已禁用模式不在下拉中）
  const WORK_MODE_OPTIONS: readonly WorkMode[] = WORK_MODES.filter(
    (m) => m === "none" || configStore.isWorkModeEnabled(m)
  );
  const WORK_MODE_INDEX: Record<string, number> = Object.fromEntries(WORK_MODE_OPTIONS.map((b, i) => [b, i]));

  const currentTagsText = record.tags
    .map((t) => {
      const d = getTagDef(t);
      return d ? d.label : t;
    })
    .join(" · ");

  const builder = new ModalFormBuilder()
    .title(`${color.bold}行为 · ${botName}`)
    .label("current", `${color.accent}当前: ${color.black}${currentTagsText}`)
    // ── 置顶：自动重生（最常用开关） ──
    .toggle("respawn", style("自动重生", color.playerName), {
      defaultValue: record.tags.includes(TAG_RESPAWN.value),
      tooltip: "死亡后自动复活到重生点",
    })
    // ── 第 2：强加载模式（已退役，统一继承，不再区分，隐藏开关） ──
    .label("sep1", style("━━ 其他开关 ────", color.accent))
    // ── 潜行 ──
    .toggle("sneaking", style("潜行", color.playerName), {
      defaultValue: record.isSneaking,
      tooltip: record.isSneaking ? "关闭将站起" : "开启将使假人潜行",
    })
    .label("sep2", style("━━ 工作模式 ────", color.accent))
    // ── 工作模式（用户拍板：单选互斥——一个假人一个工作模式，已禁用模式不在下拉中） ──
    .dropdown(
      "workMode",
      style("工作模式（仅选一项，互斥）", color.accent),
      WORK_MODE_OPTIONS.map((m) => {
        const labelMap: Record<string, string> = {
          none: style("无", color.muted),
          wander: style("闲逛模式", color.playerName),
          mine: style("定点挖掘模式", color.playerName),
          place: style("定点放置模式", color.playerName),
          attack: style("定点攻击模式", color.playerName),
          raid: style("劫掠模式", color.warn),
          fishing: style("自动钓鱼模式", color.accent),
          follow: style("自动跟随", color.playerName),
          autoInteract: style("定点交互模式", color.gold),
          script: style("编程模式", color.accent),
          vault: style("宝库模式", color.gold),
        };
        return labelMap[m] ?? style(m, color.muted);
      }),
      {
        defaultValueIndex: WORK_MODE_INDEX[record.workMode] ?? 0,
        tooltip: "单选工作模式（互斥，仅一项）：已禁用的模式不在此列表（管理员可在全局配置中启用/禁用）",
      }
    );

  const speedModes = new Set(["mine", "place", "attack", "autoInteract"]);
  if (speedModes.has(record.workMode)) {
    builder.textField("actionIntervalTicks", style("动作速度（GT）", color.accent), {
      defaultValue: String(record.actionIntervalTicks ?? 4),
      tooltip: "只输入正整数；留空恢复默认 4 GT。数值越小越快。",
    });
  }
  // ── 钓鱼模式：自动存入容器（用户规格 2.3.4：开关 + 容器坐标） ──
  if (record.workMode === "fishing") {
    const storePoint = record.autoStorePoint;
    const storeCoordText = storePoint
      ? `${Math.floor(storePoint.x)} ${Math.floor(storePoint.y)} ${Math.floor(storePoint.z)}`
      : "";
    builder
      .label("sepAutoStore", style("━━ 钓鱼自动存入容器 ────", color.accent))
      .toggle("autoStore", style("自动存入容器", color.playerName), {
        defaultValue: record.autoStore === true,
        tooltip: "开启后，钓到的战利品会自动放进下方坐标的容器（超出 5 格不生效）",
      })
      .textField("autoStoreCoord", style("容器坐标（x y z）", color.accent), {
        defaultValue: storeCoordText,
        tooltip: "填写容器方块坐标，支持 ~ 相对坐标",
      });
    // ── 固定钓点（用户规格 3.1.6：开关 + 坐标，与容器坐标同格式） ──
    const fsSpot = record.fishingSpot;
    const fsCoordText = fsSpot
      ? `${Math.floor(fsSpot.stand.x)} ${Math.floor(fsSpot.stand.y)} ${Math.floor(fsSpot.stand.z)}`
      : "";
    builder
      .label("sepFishSpot", style("━━ 固定钓点 ────", color.accent))
      .toggle("fishSpotFixed", style("固定钓点", color.playerName), {
        defaultValue: fsSpot != null,
        tooltip: "开启后假人固定在你填写的钓点钓鱼（不再自己换点）；关闭 = 恢复自动选点",
      })
      .textField("fishSpotCoord", style("钓点坐标（x y z）", color.accent), {
        defaultValue: fsCoordText,
        tooltip: "填写钓点（假人站立位置）坐标，格式与编程模式一致：支持 100 64 200 / (100,64,200) / ~相对；小数向下取整",
      });
  }
  // ── 编程模式：指令入口（用户方案 v0.3：占原「动作速度（GT）」位置） ──
  if (record.workMode === "script") {
    const scriptProgram = normalizeScriptProgram(record.script);
    builder
      .label(
        "scriptCount",
        style(
          `指令：${scriptProgram.steps.length > 0 ? `${scriptProgram.steps.length} 条` : "无"}`,
          color.accent,
        ),
      )
      .toggle("openScriptEditor", style("写指令", color.darkGreen), {
        defaultValue: false,
        tooltip: "勾选并提交 → 打开指令编辑器（添加模块 / 调顺序 / 循环设置）",
      });
  }

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

    const wantSneaking = vals.sneaking as boolean;
    const wantChunkload = true; // 全量走 test
    const wantFollow = pickedWorkMode === "follow";
    const speedText = typeof vals.actionIntervalTicks === "string" ? vals.actionIntervalTicks.trim() : "";
    const parsedSpeed = speedText === "" ? 4 : (/^[1-9]\d*$/.test(speedText) ? Number(speedText) : 4);
    const actionIntervalTicks = Number.isSafeInteger(parsedSpeed) && parsedSpeed > 0 ? parsedSpeed : 4;
    // ── 自动存入容器（仅钓鱼模式表单带这两个字段；坐标非法则整次不保存） ──
    let wantAutoStore = false;
    let autoStorePoint: { x: number; y: number; z: number } | null = null;
    if (typeof vals.autoStore === "boolean") {
      wantAutoStore = vals.autoStore;
      if (wantAutoStore) {
        const coordText = typeof vals.autoStoreCoord === "string" ? vals.autoStoreCoord.trim() : "";
        const parsedCoord = parseCoordinateInput(coordText, player.location);
        if (!parsedCoord.ok) {
          player.sendMessage(`${color.error}容器坐标无效：${parsedCoord.message}，本次未保存`);
          return;
        }
        autoStorePoint = {
          x: Math.floor(parsedCoord.pos.x),
          y: Math.floor(parsedCoord.pos.y),
          z: Math.floor(parsedCoord.pos.z),
        };
      }
    }
    // ── 固定钓点（仅钓鱼模式表单带这两个字段；坐标非法/无效钓点则整次不保存） ──
    let wantFishSpotFixed = false;
    let fishSpotAnchor: import("../../../rules/FishingPool").StoredFishingSpot | null = null;
    if (typeof vals.fishSpotFixed === "boolean") {
      wantFishSpotFixed = vals.fishSpotFixed;
      if (wantFishSpotFixed) {
        const fText = typeof vals.fishSpotCoord === "string" ? vals.fishSpotCoord.trim() : "";
        if (fText.length === 0) {
          player.sendMessage(`${color.error}请填写钓点坐标（x y z），本次未保存`);
          return;
        }
        const parsedFs = parseCoordinateInput(fText, player.location);
        if (!parsedFs.ok) {
          player.sendMessage(`${color.error}钓点坐标无效：${parsedFs.message}，本次未保存`);
          return;
        }
        const stand = {
          x: Math.floor(parsedFs.pos.x),
          y: Math.floor(parsedFs.pos.y),
          z: Math.floor(parsedFs.pos.z),
        };
        // 从站立格重建完整钓点信息（要求：能站人的有效水边）
        try {
          const fs = spotAtStand(player.dimension, stand);
          if (fs) {
            fishSpotAnchor = {
              dimension: player.dimension.id,
              stand: fs.stand,
              support: fs.support,
              waters: fs.waters,
              aim: fs.aim,
            };
          }
        } catch {
          fishSpotAnchor = null;
        }
        if (!fishSpotAnchor) {
          player.sendMessage(`${color.warn}该坐标不是有效钓点（需要是能站人的水边位置），本次未保存`);
          return;
        }
      }
    }
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
      // 速度必须先写入记录，再调用 setWorkMode。setWorkMode 会立即保存记录；
      // 若顺序反过来，速度值会在这次提交中漏保存，导致攻击/放置/挖掘继续使用旧间隔。
      if (speedModes.has(pickedWorkMode)) currentRecord.actionIntervalTicks = actionIntervalTicks;
      // 自动存入容器：字段先写入记录，再交给 setWorkMode 统一保存（顺序不能反）
      if (typeof vals.autoStore === "boolean") {
        currentRecord.autoStore = wantAutoStore;
        currentRecord.autoStorePoint = autoStorePoint;
      }
      // 固定钓点：写入锚（用户规格 3.1.6：开关 + 坐标；关闭 = 清除锚，恢复自动选点）
      const prevFs = currentRecord.fishingSpot;
      const fsChanged =
        typeof vals.fishSpotFixed === "boolean" &&
        (wantFishSpotFixed !== (prevFs != null) ||
          (wantFishSpotFixed &&
            prevFs != null &&
            fishSpotAnchor != null &&
            (prevFs.stand.x !== fishSpotAnchor.stand.x ||
              prevFs.stand.y !== fishSpotAnchor.stand.y ||
              prevFs.stand.z !== fishSpotAnchor.stand.z)));
      if (typeof vals.fishSpotFixed === "boolean") {
        currentRecord.fishingSpot = wantFishSpotFixed ? fishSpotAnchor : null;
      }
      setWorkMode(currentRecord, pickedWorkMode);
      // 固定钓点变更 → 立即生效：重启钓鱼行为（先切无、再切回；仅在线且当前为钓鱼模式）
      if (fsChanged) {
        player.sendMessage(
          wantFishSpotFixed && fishSpotAnchor
            ? `${color.success}已设置固定钓点：(${fishSpotAnchor.stand.x}, ${fishSpotAnchor.stand.y}, ${fishSpotAnchor.stand.z})`
            : `${color.success}已清除固定钓点（恢复自动选点）`,
        );
        if (currentRecord.online && pickedWorkMode === "fishing") {
          setWorkMode(currentRecord, "none");
          system.runTimeout(() => {
            try {
              setWorkMode(currentRecord, "fishing");
            } catch {
              /* 重启失败不影响已保存的设置 */
            }
          }, 10);
        }
      }
      // ── 编程模式：勾选「写指令」→ 提交后直接打开指令编辑器 ──
      if (vals.openScriptEditor === true) showScriptPanel(player, botName);
      // ── ③ 发布行为菜单提交领域事件（负载带表单参数 + tags） ──
      BotUiEvent.behaviorSubmitted.trigger({
        playerId: player.id,
        botName,
        sneaking: wantSneaking,
        chunkload: wantChunkload,
        follow: wantFollow,
        useItem: false,
        coexist,
        workMode: pickedWorkMode,
        actionIntervalTicks,
        tags: newTags,
      });
    });

    player.sendMessage(`${color.success}已更新 ${color.playerName}${botName}${color.success} 的行为设置`);
  });
}
