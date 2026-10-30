// ─── 长流程模式命令（/mp:flow） ────────────────────────────────────
// 用法：/mp:flow <假人> <动作> [参数…]
//   动作：add 添加 / list 列表 / clear 清空 / loop 循环设置 /
//         run 运行 / stop 停止 / status 状态 / dump 导出 / help 帮助
// 与面板共用同一套规则（domain/ActionRules）与执行器（Capabilities/Script），
// 指令表读写一律走 application/ScriptLibrary，避免两处漂移。
// 说明：本命令是「长流程模式」的命令入口，取代上游 /mp:action 那套。
import { color } from "@yinxe/toolkit";
import type { CommandSpec } from "./CmdKit";
import { Param } from "./CmdKit";
import { services } from "../Composition";
import { describeAction } from "../domain/ActionRules";
import {
  ACTION_KEYWORD_HELP,
  describeLoopCount,
  parseLoopCountInput,
  parseActionSpec,
} from "../domain/ActionRules";
import { ActionStatusBoard } from "../domain/ActionStatus";

/** 动作别名表（长别名优先，支持「add走到 100 64 200」这类连写） */
const ACTION_ALIASES: readonly { alias: string; action: string }[] = [
  { alias: "add", action: "add" },
  { alias: "添加", action: "add" },
  { alias: "list", action: "list" },
  { alias: "列表", action: "list" },
  { alias: "clear", action: "clear" },
  { alias: "清空", action: "clear" },
  { alias: "loop", action: "loop" },
  { alias: "循环", action: "loop" },
  { alias: "run", action: "run" },
  { alias: "运行", action: "run" },
  { alias: "start", action: "run" },
  { alias: "stop", action: "stop" },
  { alias: "停止", action: "stop" },
  { alias: "status", action: "status" },
  { alias: "状态", action: "status" },
  { alias: "dump", action: "dump" },
  { alias: "导出", action: "dump" },
  { alias: "help", action: "help" },
  { alias: "帮助", action: "help" },
].slice().sort((a, b) => b.alias.length - a.alias.length);

/** 拆出动作与粘连参数（「add走到」→ action=add, glued=走到） */
function splitAction(raw: string): { action: string; glued: string } {
  const t = raw.trim();
  const lower = t.toLowerCase();
  for (const { alias, action } of ACTION_ALIASES) {
    if (lower === alias) return { action, glued: "" };
  }
  for (const { alias, action } of ACTION_ALIASES) {
    if (lower.startsWith(alias) && lower.length > alias.length) {
      return { action, glued: t.slice(alias.length) };
    }
  }
  return { action: "", glued: "" };
}

/** 用法帮助 */
function sendUsage(say: (t: string) => void, name: string): void {
  const n = name || "<假人>";
  const lines = [
    `${color.accent}━━ 长流程模式命令 ━━`,
    `${color.info}/mp:flow ${n} add <模块> [参数] ${color.muted}- 添加一条指令`,
    `${color.info}/mp:flow ${n} list ${color.muted}- 查看指令列表`,
    `${color.info}/mp:flow ${n} clear ${color.muted}- 清空指令（循环设置保留）`,
    `${color.info}/mp:flow ${n} loop <次数|一直|关> ${color.muted}- 整段循环设置`,
    `${color.info}/mp:flow ${n} run ${color.muted}- 启动 | ${color.info}stop ${color.muted}- 停止 | ${color.info}status ${color.muted}- 状态`,
    `${color.info}/mp:flow ${n} dump ${color.muted}- 导出指令表到内容日志`,
    `${color.muted}模块：${ACTION_KEYWORD_HELP}`,
    `${color.muted}示例：/mp:flow ${n} add 走到 100 64 200`,
    `${color.muted}　　　/mp:flow ${n} add 等待 2`,
    `${color.muted}　　　/mp:flow ${n} add 挖掘 100 64 199`,
    `${color.muted}　　　/mp:flow ${n} add 跳转 1`,
  ];
  for (const line of lines) say(line);
}

export const SCRIPT_COMMANDS: CommandSpec[] = [
  {
    name: "mp:flow",
    description: "长流程模式：按指令表让假人执行（添加/查看/清空/循环/运行/停止/状态/导出）",
    usage: "mp:flow <假人> <add|list|clear|loop|run|stop|status|dump|help> [参数]",
    permission: "any",
    args: [
      { name: "target", type: Param.String },
      { name: "action", type: Param.String },
      { name: "value", type: Param.String, optional: true },
    ],
    execute: (ctx, a) => {
      const rawTarget = typeof a.target === "string" ? a.target : "";
      const rawAction = typeof a.action === "string" ? a.action : "";
      const value = typeof a.value === "string" ? a.value : "";
      const { action, glued } = splitAction(rawAction);
      if (action === "" || action === "help") {
        sendUsage((t) => ctx.say(t), rawTarget);
        return;
      }
      const hit = ctx.bot(rawTarget);
      if (!hit) return;
      const { botId, record } = hit;
      const lib = services.scripts;
      switch (action) {
        case "add": {
          const spec = `${glued} ${value}`.trim();
          if (spec.length === 0) {
            ctx.say(`${color.warn}要加什么？例如：/mp:flow ${record.name} add 走到 100 64 200`);
            return;
          }
          const parsed = parseActionSpec(spec);
          if ("error" in parsed) {
            ctx.say(`${color.error}${parsed.error}`);
            ctx.say(`${color.muted}模块：${ACTION_KEYWORD_HELP}`);
            return;
          }
          const r = lib.appendStep(botId, parsed.step);
          if (!r.ok) {
            ctx.say(`${color.error}添加失败：${r.reason}`);
            return;
          }
          ctx.say(
            `${color.success}已添加第 ${r.index} 条：${color.black}${describeAction(parsed.step)}` +
              `${color.muted}（共 ${r.count} 条；改动会在下一个指令边界生效）`,
          );
          return;
        }
        case "list": {
          const program = lib.programOf(botId);
          if (program.steps.length === 0) {
            ctx.say(`${color.warn}${record.name} 还没有指令（/mp:flow ${record.name} add …）`);
            return;
          }
          ctx.say(
            `${color.accent}━━ ${record.name} 的指令表（${program.steps.length} 条 · ${describeLoopCount(program.loopCount)}）━━`,
          );
          program.steps.forEach((s, i) => {
            const note = s.note ? `${color.accent}${s.note} ` : "";
            ctx.say(`${color.success}${i + 1}. ${note}${color.black}${describeAction(s)}`);
          });
          return;
        }
        case "clear": {
          const r = lib.clear(botId);
          ctx.say(
            r.ok
              ? `${color.success}已清空指令（循环设置保留）`
              : `${color.error}清空失败：${r.reason}`,
          );
          return;
        }
        case "loop": {
          const text = `${glued} ${value}`.trim();
          const loop = parseLoopCountInput(text);
          if (loop === undefined) {
            ctx.say(`${color.warn}循环参数不合法：可填 次数 / 一直 / 关`);
            return;
          }
          const r = lib.setLoopCount(botId, loop);
          ctx.say(
            r.ok
              ? `${color.success}循环设置：${describeLoopCount(loop)}`
              : `${color.error}设置失败：${r.reason}`,
          );
          return;
        }
        case "run": {
          const program = lib.programOf(botId);
          if (program.steps.length === 0) {
            ctx.say(`${color.warn}指令表是空的：先 add 一条再 run`);
            return;
          }
          services.modes.change(botId, "script", services.scripts.status.get(botId)?.updatedAt ?? 0);
          ctx.say(
            `${color.success}已启动长流程（${program.steps.length} 条 · ${describeLoopCount(program.loopCount)}）` +
              `${color.muted}（假人需在线且未死亡）`,
          );
          return;
        }
        case "stop": {
          services.modes.change(botId, "none", services.scripts.status.get(botId)?.updatedAt ?? 0);
          ctx.say(`${color.success}已停止（模式切回空闲）`);
          return;
        }
        case "status": {
          const st = lib.status.get(botId);
          const running = record.workMode === "script";
          ctx.say(
            `${color.accent}模式：${color.black}${running ? "长流程模式" : record.workMode}` +
              ` ${color.accent}状态：${color.black}${ActionStatusBoard.describe(st)}`,
          );
          return;
        }
        case "dump": {
          const program = lib.programOf(botId);
          console.warn(`[mockplayer3] ${record.name} 长流程指令表：${JSON.stringify(program)}`);
          ctx.say(`${color.success}已导出到内容日志（${program.steps.length} 条）`);
          return;
        }
        default:
          sendUsage((t) => ctx.say(t), record.name);
          return;
      }
    },
  },
];