// ─── 自定义动作命令（/mp:action） ────────────────────────────────────
// 一个 CommandSpec 带动作枚举（本仓无子命令概念）：编辑/查看/启停全在一个动词表里。
// 长动作（说话/备注）建议在自定义动作面板里改（命令参数只有单 token 类型，这里最多拼 6 段）。

import { color, style } from "@yinxe/toolkit";
import { modeSpec } from "../domain/Catalog";
import {
  actionsToSpecLines,
  describeFailPolicy,
  describeLoopCount,
  describeAction,
  parseFailPolicyInput,
  parseLoopCountInput,
  parseActionsSpec,
  parseActionSpec,
} from "../domain/ActionRules";
import { ActionStatusBoard } from "../domain/ActionStatus";
import { services } from "../Composition";
import type { CommandCtx, CommandSpec } from "./CmdKit";
import { Param } from "./CmdKit";
import { showActionPanel } from "./Panels/Action";

/** 动作枚举（含别名解析在 handleAction 内做，这里只给规范值） */
const ACTION_VERBS: readonly string[] = [
  "panel",
  "list",
  "add",
  "set",
  "del",
  "loop",
  "fail",
  "clear",
  "dup",
  "move",
  "export",
  "run",
  "stop",
  "status",
  "help",
];

/** 动作别名（拉丁不区分大小写；中文别名照写） */
const ACTION_ALIASES: Record<string, string> = {
  "": "panel",
  面板: "panel",
  编辑: "panel",
  列表: "list",
  添加: "add",
  新增: "add",
  设置: "set",
  整体设置: "set",
  删除: "del",
  移除: "del",
  循环: "loop",
  失败: "fail",
  清空: "clear",
  复制: "dup",
  移动: "move",
  导出: "export",
  运行: "run",
  启动: "run",
  start: "run",
  停止: "stop",
  状态: "status",
  帮助: "help",
};

function resolveAction(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (text.length === 0) return "panel";
  const lower = text.toLowerCase();
  if (ACTION_VERBS.includes(lower)) return lower;
  return ACTION_ALIASES[text] ?? ACTION_ALIASES[lower] ?? "unknown";
}

/** 拼接命令参数里的文本段（t1..t6；命令参数只有单 token 类型） */
function joinText(a: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["t1", "t2", "t3", "t4", "t5", "t6"]) {
    const v = a[key];
    if (typeof v === "string" && v.length > 0) parts.push(v);
  }
  return parts.join(" ").trim();
}

/** 动作表概览（状态 + 条数 + 循环 + 失败策略） */
function overview(botId: number, name: string): string[] {
  const lib = services.actions;
  const program = lib.programOf(botId);
  const status = ActionStatusBoard.describe(lib.status.get(botId));
  return [
    `${style(`${name} 的动作表`, color.playerName)} ${color.muted}${program.steps.length} 条 · ${describeLoopCount(program.loopCount)} · ${describeFailPolicy(program.onFail)}`,
    `${color.muted}状态：${color.info}${status}`,
  ];
}

function handleAction(ctx: CommandCtx, action: string, botId: number, name: string, text: string): void {
  const lib = services.actions;
  const say = (t: string): void => ctx.say(t);
  switch (action) {
    case "panel":
      for (const line of overview(botId, name)) say(line);
      showActionPanel(ctx.player, name);
      return;
    case "list": {
      const program = lib.programOf(botId);
      for (const line of overview(botId, name)) say(line);
      if (program.steps.length === 0) {
        say(
          `${color.muted}还没有自定义动作：用 ${color.info}/mp:action ${name} add 走到 100 64 100 ${color.muted}加一条，或在面板里整段编辑`
        );
        return;
      }
      program.steps.forEach((step, i) => say(`${color.muted}${describeAction(step, i + 1)}`));
      return;
    }
    case "add": {
      if (text.length === 0) {
        say(`${color.error}用法：/mp:action ${name} add <规格>（如 走到 100 64 100 / 等待 2 / 挖前方）`);
        return;
      }
      const parsed = parseActionSpec(text);
      if ("error" in parsed) {
        say(`${color.error}${parsed.error}`);
        return;
      }
      const r = lib.appendStep(botId, parsed.step);
      if (!r.ok) {
        say(`${color.error}${r.reason}`);
        return;
      }
      say(`${color.success}已添加第 ${r.index} 条：${describeAction(parsed.step)}（共 ${r.count} 个）`);
      if (r.count === 1) say(`${color.muted}用 ${color.info}/mp:action ${name} run ${color.muted}启动`);
      return;
    }
    case "set": {
      if (text.length === 0) {
        say(`${color.error}用法：/mp:action ${name} set <整段规格>（多条用 ${color.info}|${color.error} 分隔）`);
        return;
      }
      const parsed = parseActionsSpec(text);
      if (parsed.errors.length > 0) {
        say(`${color.error}有 ${parsed.errors.length} 条无法解析，本次未保存：`);
        for (const e of parsed.errors.slice(0, 5)) say(`${color.error}${e}`);
        return;
      }
      const r = lib.setProgram(botId, { ...lib.programOf(botId), steps: parsed.steps });
      if (!r.ok) {
        say(`${color.error}${r.reason}`);
        return;
      }
      say(`${color.success}已写入 ${parsed.steps.length} 条（循环与失败策略保持不变）`);
      return;
    }
    case "del": {
      const index = Number(text);
      const r = lib.removeStep(botId, Number.isFinite(index) ? Math.trunc(index) : NaN);
      say(r.ok ? `${color.success}已删除第 ${Math.trunc(index)} 条` : `${color.error}${r.reason}`);
      return;
    }
    case "dup": {
      const index = Math.trunc(Number(text));
      const step = lib.programOf(botId).steps[index - 1];
      if (!step) {
        say(`${color.error}序号需在 1-${lib.programOf(botId).steps.length} 之间`);
        return;
      }
      const r = lib.insertStep(botId, index, step);
      say(r.ok ? `${color.success}已复制第 ${index} 个动作（副本在第 ${index + 1} 位）` : `${color.error}${r.reason}`);
      return;
    }
    case "move": {
      const parts = text.split(/\s+/).filter((t) => t.length > 0);
      const index = Math.trunc(Number(parts[0]));
      const dir = parts[1] ?? "";
      if (dir !== "上" && dir !== "下" && dir !== "up" && dir !== "down") {
        say(`${color.error}用法：/mp:action ${name} move <序号> <上|下>`);
        return;
      }
      const up = dir === "上" || dir === "up";
      const r = lib.moveStep(botId, index, up ? -1 : 1);
      say(r.ok ? `${color.success}第 ${index} 个动作已${up ? "上移" : "下移"}一位` : `${color.error}${r.reason}`);
      return;
    }
    case "export": {
      const program = lib.programOf(botId);
      for (const line of overview(botId, name)) say(line);
      if (program.steps.length === 0) {
        say(`${color.muted}（空表，无内容可导出）`);
        return;
      }
      say(`${color.muted}—— 下面每行一个动作，可直接整段粘贴回 set ——`);
      for (const line of actionsToSpecLines(program).split("\n")) say(`${color.muted}${line}`);
      return;
    }
    case "loop": {
      const loop = parseLoopCountInput(text);
      if (loop === undefined) {
        say(`${color.error}用法：/mp:action ${name} loop <一直|一次|次数>`);
        return;
      }
      const r = lib.setLoopCount(botId, loop);
      say(r.ok ? `${color.success}循环设置：${describeLoopCount(loop)}` : `${color.error}${r.reason}`);
      return;
    }
    case "fail": {
      const policy = parseFailPolicyInput(text);
      if (!policy) {
        say(`${color.error}用法：/mp:action ${name} fail <停|跳过>`);
        return;
      }
      const r = lib.setFailPolicy(botId, policy);
      say(r.ok ? `${color.success}失败策略：${describeFailPolicy(policy)}` : `${color.error}${r.reason}`);
      return;
    }
    case "clear": {
      const r = lib.clear(botId);
      say(r.ok ? `${color.success}已清空指令（循环与失败策略保留）` : `${color.error}${r.reason}`);
      return;
    }
    case "run": {
      const program = lib.programOf(botId);
      if (program.steps.length === 0) {
        say(`${color.error}还没有自定义动作：先 add 或到面板里写一段`);
        return;
      }
      const record = services.runtime.record(botId);
      if (!record) {
        say(`${color.error}假人不存在`);
        return;
      }
      if (!services.runtime.session(botId)) {
        say(`${color.error}假人不在线：上线后会自动接着跑（模式已记住）`);
      }
      const changed = services.lifecycle.changeWorkMode(ctx.viewer, botId, "custom");
      if (!changed.ok) {
        say(`${color.error}${changed.reason}`);
        return;
      }
      lib.requestRerun(botId);
      say(
        `${color.success}已启动：${program.steps.length} 条 · ${describeLoopCount(program.loopCount)} · ${describeFailPolicy(program.onFail)}`
      );
      return;
    }
    case "stop": {
      const changed = services.lifecycle.changeWorkMode(ctx.viewer, botId, "none");
      say(changed.ok ? `${color.success}已停止（工作模式 → 空闲）` : `${color.error}${changed.reason}`);
      return;
    }
    case "status": {
      for (const line of overview(botId, name)) say(line);
      return;
    }
    default:
      say(`${color.error}未知动作；可用：${ACTION_VERBS.join(" / ")}`);
      say(`${color.muted}例如 ${color.info}/mp:action ${name} add 走到 100 64 100`);
  }
}

export const ACTION_COMMANDS: readonly CommandSpec[] = [
  {
    name: "mp:action",
    description: `自定义动作：${modeSpec("custom").help}`,
    usage: "mp:action <假人> [list|add|set|del|dup|move|loop|fail|clear|export|run|stop|status] [参数…]",
    args: [
      { name: "name", type: Param.String },
      { name: "action", type: Param.Enum, optional: true, enum: ACTION_VERBS },
      { name: "t1", type: Param.String, optional: true },
      { name: "t2", type: Param.String, optional: true },
      { name: "t3", type: Param.String, optional: true },
      { name: "t4", type: Param.String, optional: true },
      { name: "t5", type: Param.String, optional: true },
      { name: "t6", type: Param.String, optional: true },
    ],
    execute(ctx, a): void {
      const target = ctx.bot(String(a.name ?? ""));
      if (!target) return;
      const action = resolveAction(a.action);
      if (action === "unknown") {
        ctx.say(`${color.error}未知动作；可用：${ACTION_VERBS.join(" / ")}`);
        return;
      }
      if (action === "help") {
        ctx.say(`${color.muted}${ACTION_VERBS.join(" / ")}`);
        return;
      }
      handleAction(ctx, action, target.botId, target.record.name, joinText(a));
    },
  },
];
