// ─── 编程模式面板（状态 + 整段文本编辑 + 追加/删除 + 启停） ──────────
// 与旧版的主要差别（优化面）：
//   1 整段文本编辑是主路径（旧版只有命令能写文本，面板只能一层层加条目）；
//   2 循环次数可自填（旧版只有 1/3/10/一直四个预设）；
//   3 删除带确认、删除按序号（不再"进列表→点条目→删除"三步无确认）；
//   4 面板只调 ScriptLibrary 与 changeWorkMode，不自己解释脚本、不直接落盘（与命令同源）；
//   5 自带权限守卫（旧版面版自身不判权）。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { ActionFormBuilder, color, ModalFormBuilder, style, trySendMessage } from "@yinxe/toolkit";
import {
  describeFailPolicy,
  describeLoopCount,
  describeStep,
  SCRIPT_KEYWORD_HELP,
  SCRIPT_MODULES,
  moduleById,
  parseLoopCountInput,
  parseProgramSpec,
  programToSpecText,
  stepFromModule,
} from "../../domain/ScriptRules";
import { ScriptStatusBoard } from "../../domain/ScriptStatus";
import { services } from "../../Composition";
import { resolveUiBotRecord, guardUiManage, uiViewer } from "../Kit";

/** 面板 body 里最多列出的步骤数（更长走 /mp:script <名> list） */
const PREVIEW_STEPS = 8;

export function showScriptPanel(player: Player, rawName: string): void {
  const say = (t: string): void => trySendMessage(player, t);
  const viewer = uiViewer(player);
  const record = resolveUiBotRecord(say, rawName);
  if (!record) return;
  if (!guardUiManage(say, viewer, record)) return;
  const { botId, name } = record;
  const lib = services.script;
  const program = lib.programOf(botId);
  const running = record.workMode === "script";

  const body = [
    `${style("状态", color.accent)} ${ScriptStatusBoard.describe(lib.status.get(botId))}`,
    `${style("脚本", color.accent)} ${program.steps.length} 条 · ${describeLoopCount(program.loopCount)} · ${describeFailPolicy(program.onFail)}`,
    ...program.steps.slice(0, PREVIEW_STEPS).map((step, i) => `${color.muted}${describeStep(step, i + 1)}`),
    program.steps.length > PREVIEW_STEPS
      ? `${color.muted}…还有 ${program.steps.length - PREVIEW_STEPS} 条（用 /mp:script ${name} list 看全）`
      : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  void ActionFormBuilder.showQuick(player, `${color.bold}编程 · ${name}`, (f) => {
    f.body(body);
    f.button(style(running ? "■ 停止脚本" : "▶ 运行脚本", running ? color.warn : color.success), () => {
      system.run(() => toggleRun(player, viewer, botId, name, running));
    });
    f.button(style("✎ 编辑脚本（整段文本）", color.darkBlue), () => editProgram(player, name));
    f.button(style("＋ 追加一条", color.darkBlue), () => appendStep(player, name));
    f.button(style("✗ 删除一条", color.darkBlue), () => removeStep(player, name));
    f.button(style("🗑 清空脚本", color.warn), () => confirmClear(player, name));
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
    say(r.ok ? `${color.success}已停止编程模式` : `${color.error}${r.reason}`);
    showScriptPanel(player, name);
    return;
  }
  const program = services.script.programOf(botId);
  if (program.steps.length === 0) {
    say(`${color.error}脚本为空：先编辑脚本或追加一条`);
    showScriptPanel(player, name);
    return;
  }
  if (!services.runtime.session(botId)) say(`${color.warn}假人不在线：上线后会自动接着跑（模式已记住）`);
  const r = services.lifecycle.changeWorkMode(viewer, botId, "script");
  if (!r.ok) {
    say(`${color.error}${r.reason}`);
    showScriptPanel(player, name);
    return;
  }
  services.script.requestRerun(botId);
  say(
    `${color.success}已启动：${program.steps.length} 条 · ${describeLoopCount(program.loopCount)} · ${describeFailPolicy(program.onFail)}`
  );
  showScriptPanel(player, name);
}

// ─── 私有：整段文本编辑 ──────────────────────────────────────────

function editProgram(player: Player, name: string): void {
  const say = (t: string): void => trySendMessage(player, t);
  const botId = services.runtime.findBotIdByName(name);
  if (botId === undefined) return;
  const lib = services.script;
  const program = lib.programOf(botId);
  void ModalFormBuilder.showQuick(player, `${color.bold}编辑脚本 · ${name}`, (f) => {
    f.textField("spec", "脚本（每条一行，或用 | 分隔；文本编辑不保留备注）", {
      defaultValue: programToSpecText(program),
      tooltip: `可用模块：${SCRIPT_KEYWORD_HELP}`,
    });
    f.textField("loop", "循环（一直 / 一次 / 次数；留空＝不变）", {
      defaultValue: "",
      tooltip: `当前：${describeLoopCount(program.loopCount)}`,
    });
    f.dropdown("fail", "单条失败时", ["停下并报告", "跳过该条继续"], {
      defaultValueIndex: program.onFail === "skip" ? 1 : 0,
      tooltip: `当前：${describeFailPolicy(program.onFail)}`,
    });
  }).then((vals) => {
    if (!vals) return;
    system.run(() => {
      const parsed = parseProgramSpec(String(vals.spec ?? ""));
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
      showScriptPanel(player, name);
    });
  });
}

// ─── 私有：追加一条 ──────────────────────────────────────────────

function appendStep(player: Player, name: string): void {
  const say = (t: string): void => trySendMessage(player, t);
  const botId = services.runtime.findBotIdByName(name);
  if (botId === undefined) return;
  void ModalFormBuilder.showQuick(player, `${color.bold}追加一条 · ${name}`, (f) => {
    f.dropdown(
      "module",
      "模块",
      SCRIPT_MODULES.map((m) => `${m.cat} · ${m.label}`),
      { defaultValueIndex: 0, tooltip: "选模块后按参数提示填写" }
    );
    f.textField("args", "参数", {
      defaultValue: "",
      tooltip: "坐标 x y z / 秒数 / 次数 / 文本；无参模块留空。可留空坐标的模块填 x y z 就先转向",
    });
    f.textField("note", "备注（可选，列表里显示）", { defaultValue: "", tooltip: "给自己看的说明，不参与执行" });
  }).then((vals) => {
    if (!vals) return;
    system.run(() => {
      const def = SCRIPT_MODULES[Number(vals.module)] ?? SCRIPT_MODULES[0]!;
      const parsed = stepFromModule(def, String(vals.args ?? ""));
      if ("error" in parsed) {
        say(`${color.error}${parsed.error}`);
        return;
      }
      const note = String(vals.note ?? "").trim();
      if (note.length > 0) parsed.step.note = note;
      const r = services.script.appendStep(botId, parsed.step);
      if (!r.ok) {
        say(`${color.error}${r.reason}`);
        return;
      }
      say(`${color.success}已添加第 ${r.index} 条：${describeStep(parsed.step)}`);
      showScriptPanel(player, name);
    });
  });
}

// ─── 私有：删除一条 ──────────────────────────────────────────────

function removeStep(player: Player, name: string): void {
  const say = (t: string): void => trySendMessage(player, t);
  const botId = services.runtime.findBotIdByName(name);
  if (botId === undefined) return;
  const program = services.script.programOf(botId);
  if (program.steps.length === 0) {
    say(`${color.error}脚本为空`);
    return;
  }
  void ModalFormBuilder.showQuick(player, `${color.bold}删除一条 · ${name}`, (f) => {
    f.textField("index", `要删除的序号（1-${program.steps.length}）`, {
      defaultValue: "1",
      tooltip: "完整列表见 /mp:script " + name + " list",
    });
  }).then((vals) => {
    if (!vals) return;
    system.run(() => {
      const index = Math.trunc(Number(String(vals.index ?? "")));
      const before = services.script.programOf(botId);
      const step = before.steps[index - 1];
      const r = services.script.removeStep(botId, index);
      say(
        r.ok
          ? `${color.success}已删除第 ${index} 条${step ? `：${describeStep(step)}` : ""}`
          : `${color.error}${r.reason}`
      );
      showScriptPanel(player, name);
    });
  });
}

// ─── 私有：清空（带确认） ────────────────────────────────────────

function confirmClear(player: Player, name: string): void {
  const say = (t: string): void => trySendMessage(player, t);
  const botId = services.runtime.findBotIdByName(name);
  if (botId === undefined) return;
  void ModalFormBuilder.showQuick(player, `${color.bold}清空脚本 · ${name}`, (f) => {
    f.toggle("confirm", style("确认清空全部步骤（循环与失败策略保留）", color.warn), {
      defaultValue: false,
      tooltip: "清空后无法撤销",
    });
  }).then((vals) => {
    if (!vals) return;
    system.run(() => {
      if (Number(vals.confirm) !== 1 && vals.confirm !== true) {
        say(`${color.muted}已取消`);
        showScriptPanel(player, name);
        return;
      }
      const r = services.script.clear(botId);
      say(r.ok ? `${color.success}已清空脚本` : `${color.error}${r.reason}`);
      showScriptPanel(player, name);
    });
  });
}

/** 模块下拉项反查（面板/命令共用同源目录，测试可见） */
export function moduleOfIndex(index: number): (typeof SCRIPT_MODULES)[number] | undefined {
  return moduleById(SCRIPT_MODULES[index]?.id ?? "");
}
