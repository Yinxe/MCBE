// ─── 自定义动作面板（状态 + 整段文本编辑 + 追加/删除 + 启停） ──────────
// 与旧版的主要差别（优化面）：
//   1 整段文本编辑是主路径（旧版只有命令能写文本，面板只能一层层加条目）；
//   2 循环次数可自填（旧版只有 1/3/10/一直四个预设）；
//   3 删除带确认、删除按序号（不再"进列表→点条目→删除"三步无确认）；
//   4 面板只调 ActionLibrary 与 changeWorkMode，不自己解释动作表、不直接落盘（与命令同源）；
//   5 自带权限守卫（旧版面版自身不判权）。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { ActionFormBuilder, color, ModalFormBuilder, style, trySendMessage } from "@yinxe/toolkit";
import {
  describeFailPolicy,
  describeLoopCount,
  describeAction,
  ACTION_KEYWORD_HELP,
  ACTION_TYPES,
  actionTypeById,
  parseLoopCountInput,
  parseActionsSpec,
  actionsToSpecText,
  actionsToSpecLines,
  stepToSpecText,
  actionFromType,
} from "../../domain/ActionRules";
import type { ActionProgram } from "../../domain/ActionRules";
import { ActionStatusBoard } from "../../domain/ActionStatus";
import { services } from "../../Composition";
import { resolveUiBotRecord, guardUiManage, uiViewer } from "../Kit";

/** 整段编辑表单里最多预览的动作行数（再多只报条数，免得表单过长） */
const EDIT_PREVIEW_LINES = 20;

/** 操作者当前所在格（坐标类动作留空时的默认落点） */
function playerCoord(player: Player): { x: number; y: number; z: number } {
  const l = player.location;
  return { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) };
}

/** 整段编辑表单的只读预览：一条动作一行（含备注），超长只报条数 */
function editPreviewText(program: ActionProgram): string {
  if (program.steps.length === 0) return `${color.muted}（还没有动作）`;
  const lines = program.steps
    .slice(0, EDIT_PREVIEW_LINES)
    .map((a, i) => `${i + 1}. ${stepToSpecText(a)}${a.note ? ` §7(${a.note})` : ""}`);
  lines.push(`${color.muted}${describeLoopCount(program.loopCount)} · ${describeFailPolicy(program.onFail)}`);
  const rest = program.steps.length - EDIT_PREVIEW_LINES;
  if (rest > 0) lines.push(`${color.muted}…还有 ${rest} 个动作未在此预览`);
  if (program.steps.some((a) => a.note)) lines.push(`${color.muted}注意：文本保存会丢掉备注`);
  return lines.join("\n");
}

/** 面板 body 里最多列出的动作数（更长走 /mp:action <名> list） */
const PREVIEW_STEPS = 8;

export function showActionPanel(player: Player, rawName: string): void {
  const say = (t: string): void => trySendMessage(player, t);
  const viewer = uiViewer(player);
  const record = resolveUiBotRecord(say, rawName);
  if (!record) return;
  if (!guardUiManage(say, viewer, record)) return;
  const { botId, name } = record;
  const lib = services.actions;
  const program = lib.programOf(botId);
  const running = record.workMode === "custom";

  const body = [
    `${style("状态", color.accent)} ${ActionStatusBoard.describe(lib.status.get(botId))}`,
    `${style("动作表", color.accent)} ${program.steps.length} 条 · ${describeLoopCount(program.loopCount)} · ${describeFailPolicy(program.onFail)}`,
    ...program.steps.slice(0, PREVIEW_STEPS).map((step, i) => `${color.muted}${describeAction(step, i + 1)}`),
    program.steps.length > PREVIEW_STEPS
      ? `${color.muted}…还有 ${program.steps.length - PREVIEW_STEPS} 条（用 /mp:action ${name} list 看全）`
      : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  void ActionFormBuilder.showQuick(player, `${color.bold}自定义动作 · ${name}`, (f) => {
    f.body(body);
    f.button(style(running ? "■ 停止动作表" : "▶ 运行动作表", running ? color.warn : color.success), () => {
      system.run(() => toggleRun(player, viewer, botId, name, running));
    });
    f.button(style("✎ 编辑动作表（整段文本）", color.darkBlue), () => editProgram(player, name));
    f.button(style("＋ 追加一个动作", color.darkBlue), () => appendStep(player, name));
    f.button(style("✗ 删除一个动作", color.darkBlue), () => removeStep(player, name));
    f.button(style("🗑 清空动作", color.warn), () => confirmClear(player, name));
  });
}

// ─── 私有：启停 ──────────────────────────────────────────────────

function toggleRun(
  player: Player,
  viewer: ReturnType<typeof uiViewer>,
  botId: number,
  name: string,
  running: boolean
): void {
  const say = (t: string): void => trySendMessage(player, t);
  if (running) {
    const r = services.lifecycle.changeWorkMode(viewer, botId, "none");
    say(r.ok ? `${color.success}已停止自定义动作` : `${color.error}${r.reason}`);
    showActionPanel(player, name);
    return;
  }
  const program = services.actions.programOf(botId);
  if (program.steps.length === 0) {
    say(`${color.error}还没有自定义动作：先编辑动作表或追加一条`);
    showActionPanel(player, name);
    return;
  }
  if (!services.runtime.session(botId)) say(`${color.warn}假人不在线：上线后会自动接着跑（模式已记住）`);
  const r = services.lifecycle.changeWorkMode(viewer, botId, "custom");
  if (!r.ok) {
    say(`${color.error}${r.reason}`);
    showActionPanel(player, name);
    return;
  }
  services.actions.requestRerun(botId);
  say(
    `${color.success}已启动：${program.steps.length} 条 · ${describeLoopCount(program.loopCount)} · ${describeFailPolicy(program.onFail)}`
  );
  showActionPanel(player, name);
}

// ─── 私有：整段文本编辑 ──────────────────────────────────────────

function editProgram(player: Player, name: string): void {
  const say = (t: string): void => trySendMessage(player, t);
  const botId = services.runtime.findBotIdByName(name);
  if (botId === undefined) return;
  const lib = services.actions;
  const program = lib.programOf(botId);
  void ModalFormBuilder.showQuick(player, `${color.bold}编辑动作表 · ${name}`, (f) => {
    f.label("preview", editPreviewText(program));
    f.textField("spec", "整段编辑（一条动作一行，清空即删光）", {
      defaultValue: actionsToSpecLines(program),
      tooltip: `坐标留空＝用你当前站的位置｜可用动作：${ACTION_KEYWORD_HELP}`,
    });
    f.textField("loop", "循环（一直 / 一次 / 次数；留空＝不变）", {
      defaultValue: "",
      tooltip: `当前：${describeLoopCount(program.loopCount)}`,
    });
    f.dropdown("fail", "单个动作失败时", ["停下并报告", "跳过它继续"], {
      defaultValueIndex: program.onFail === "skip" ? 1 : 0,
      tooltip: `当前：${describeFailPolicy(program.onFail)}`,
    });
  }).then((vals) => {
    if (!vals) return;
    system.run(() => {
      const parsed = parseActionsSpec(String(vals.spec ?? ""), { coord: playerCoord(player) });
      if (parsed.errors.length > 0) {
        say(`${color.error}有 ${parsed.errors.length} 条无法解析，本次未保存：`);
        for (const e of parsed.errors.slice(0, 5)) say(`${color.error}${e}`);
        return;
      }
      const loopText = String(vals.loop ?? "").trim();
      const loop = loopText.length === 0 ? program.loopCount : parseLoopCountInput(loopText);
      if (loop === undefined) {
        say(`${color.error}循环设置无法识别：${loopText}（可用 一直/一次/次数）`);
        return;
      }
      const onFail = Number(vals.fail) === 1 ? "skip" : "stop";
      const r = lib.setProgram(botId, { steps: parsed.steps, loopCount: loop, onFail });
      if (!r.ok) {
        say(`${color.error}${r.reason}`);
        return;
      }
      say(
        `${color.success}已保存 ${parsed.steps.length} 条 · ${describeLoopCount(loop)} · ${describeFailPolicy(onFail)}`
      );
      showActionPanel(player, name);
    });
  });
}

// ─── 私有：追加一条 ──────────────────────────────────────────────

function appendStep(player: Player, name: string): void {
  const say = (t: string): void => trySendMessage(player, t);
  const botId = services.runtime.findBotIdByName(name);
  if (botId === undefined) return;
  void ModalFormBuilder.showQuick(player, `${color.bold}追加一个动作 · ${name}`, (f) => {
    f.dropdown(
      "module",
      "动作类型",
      ACTION_TYPES.map((m) => `${m.cat} · ${m.label}`),
      { defaultValueIndex: 0, tooltip: "选动作类型后按参数提示填写" }
    );
    f.textField("args", "参数", {
      defaultValue: "",
      tooltip: `坐标 x y z（留空＝你当前站的位置）/ 秒数 / 次数 / 文本；可留空坐标的动作类型填了就先转向`,
    });
    f.textField("note", "备注（可选，列表里显示）", { defaultValue: "", tooltip: "给自己看的说明，不参与执行" });
  }).then((vals) => {
    if (!vals) return;
    system.run(() => {
      const def = ACTION_TYPES[Number(vals.module)] ?? ACTION_TYPES[0]!;
      const parsed = actionFromType(def, String(vals.args ?? ""), { coord: playerCoord(player) });
      if ("error" in parsed) {
        say(`${color.error}${parsed.error}`);
        return;
      }
      const note = String(vals.note ?? "").trim();
      if (note.length > 0) parsed.step.note = note;
      const r = services.actions.appendStep(botId, parsed.step);
      if (!r.ok) {
        say(`${color.error}${r.reason}`);
        return;
      }
      say(`${color.success}已添加第 ${r.index} 条：${describeAction(parsed.step)}`);
      showActionPanel(player, name);
    });
  });
}

// ─── 私有：删除一条 ──────────────────────────────────────────────

function removeStep(player: Player, name: string): void {
  const say = (t: string): void => trySendMessage(player, t);
  const botId = services.runtime.findBotIdByName(name);
  if (botId === undefined) return;
  const program = services.actions.programOf(botId);
  if (program.steps.length === 0) {
    say(`${color.error}还没有自定义动作`);
    return;
  }
  void ModalFormBuilder.showQuick(player, `${color.bold}删除一个动作 · ${name}`, (f) => {
    f.textField("index", `要删除的序号（1-${program.steps.length}）`, {
      defaultValue: "1",
      tooltip: "完整列表见 /mp:action " + name + " list",
    });
  }).then((vals) => {
    if (!vals) return;
    system.run(() => {
      const index = Math.trunc(Number(String(vals.index ?? "")));
      const before = services.actions.programOf(botId);
      const step = before.steps[index - 1];
      const r = services.actions.removeStep(botId, index);
      say(
        r.ok
          ? `${color.success}已删除第 ${index} 条${step ? `：${describeAction(step)}` : ""}`
          : `${color.error}${r.reason}`
      );
      showActionPanel(player, name);
    });
  });
}

// ─── 私有：清空（带确认） ────────────────────────────────────────

function confirmClear(player: Player, name: string): void {
  const say = (t: string): void => trySendMessage(player, t);
  const botId = services.runtime.findBotIdByName(name);
  if (botId === undefined) return;
  void ModalFormBuilder.showQuick(player, `${color.bold}清空动作 · ${name}`, (f) => {
    f.toggle("confirm", style("确认清空全部动作（循环与失败策略保留）", color.warn), {
      defaultValue: false,
      tooltip: "清空后无法撤销",
    });
  }).then((vals) => {
    if (!vals) return;
    system.run(() => {
      if (Number(vals.confirm) !== 1 && vals.confirm !== true) {
        say(`${color.muted}已取消`);
        showActionPanel(player, name);
        return;
      }
      const r = services.actions.clear(botId);
      say(r.ok ? `${color.success}已清空动作` : `${color.error}${r.reason}`);
      showActionPanel(player, name);
    });
  });
}
