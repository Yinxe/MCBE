// ─── 编程模式命令（/mp:script） ──────────────────────────
// 用法：/mp:script <假人名> <动作> [参数…]
//   动作：add 添加 / list 列表 / clear 清空 / loop 循环设置 /
//         run 运行 / stop 停止 / status 状态 / dump 导出 / help 帮助
//   中英文别名等价（添加/列表/清空/循环/运行/停止/状态/导出/帮助）。
// 权限：与其它命令一致——由 resolveBotForCommand 校验（主人 + 管理员）。
// 界面（面板）与命令共用同一套规则与执行器，避免两处漂移。
import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { color, defineCommand } from "@yinxe/toolkit";
import { resolveBotForCommand } from "../auth";
import { saveCoordinator } from "../../../bootstrap/context";
import { setWorkMode } from "../../../features/state/behavior";
import { getScriptRuntime, requestScriptKick } from "../../../features/script/runtime";
import { MAX_SCRIPT_STEPS, type BotRecord, type ScriptProgram } from "../../../rules/Types";
import {
  SCRIPT_KEYWORD_HELP,
  describeLoopCount,
  describeStep,
  normalizeScriptProgram,
  parseLoopCountInput,
  parseScriptSpec,
} from "../../../rules/script/ScriptRules";

/** 动作别名表（长别名优先，支持「add走到 100 64 200」这种连写） */
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
  { alias: "export", action: "dump" },
  { alias: "help", action: "help" },
  { alias: "帮助", action: "help" },
].slice().sort((a, b) => b.alias.length - a.alias.length);

/** 运行阶段 → 中文 */
const PHASE_TEXT: Record<string, string> = {
  idle: "空闲",
  running: "运行中",
  completed: "已完成",
  failed: "已失败",
  empty: "脚本为空",
};

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
function sendUsage(player: { sendMessage(msg: string): void }, name: string): void {
  const n = name || "<假人>";
  const lines = [
    `${color.accent}━━ 编程模式命令 ━━`,
    `${color.info}/mp:script ${n} add <模块> [参数] ${color.muted}- 添加一条指令`,
    `${color.info}/mp:script ${n} list ${color.muted}- 查看指令列表`,
    `${color.info}/mp:script ${n} clear ${color.muted}- 清空指令（循环设置保留）`,
    `${color.info}/mp:script ${n} loop <次数|一直|关> ${color.muted}- 整段循环设置`,
    `${color.info}/mp:script ${n} run ${color.muted}- 启动 | ${color.info}stop ${color.muted}- 停止 | ${color.info}status ${color.muted}- 状态`,
    `${color.info}/mp:script ${n} dump ${color.muted}- 导出脚本到内容日志`,
    `${color.muted}模块：${SCRIPT_KEYWORD_HELP}`,
    `${color.muted}示例：/mp:script ${n} add 走到 100 64 200`,
    `${color.muted}　　　/mp:script ${n} add 等待 2`,
    `${color.muted}　　　/mp:script ${n} add 挖掘 100 64 199`,
    `${color.muted}　　　/mp:script ${n} add 跳转 1`,
  ];
  for (const line of lines) player.sendMessage(line);
}

/** 指令列表输出（每 12 条一段，避免刷屏） */
function sendList(
  player: { sendMessage(msg: string): void },
  botName: string,
  program: ScriptProgram,
): void {
  const total = program.steps.length;
  if (total === 0) {
    player.sendMessage(`${color.warn}脚本为空（用 /mp:script ${botName} add … 添加指令）`);
    return;
  }
  player.sendMessage(`${color.accent}共 ${total} 条 · ${color.black}${describeLoopCount(program.loopCount)}`);
  for (let i = 0; i < total; i += 12) {
    const chunk = program.steps.slice(i, i + 12).map((s, j) => {
      return `${color.muted}${i + j + 1}. ${color.black}${describeStep(s)}`;
    });
    player.sendMessage(chunk.join("\n"));
  }
}

/** 导出脚本到内容日志（便于排查/备份） */
function dumpScript(
  player: { sendMessage(msg: string): void },
  botName: string,
  program: ScriptProgram,
): void {
  console.info(
    `===MP-SCRIPT-BEGIN=== bot=${botName} count=${program.steps.length} loop=${program.loopCount} ===`,
  );
  program.steps.forEach((s, i) => {
    console.info(`[${i + 1}] ${JSON.stringify(s)}`);
  });
  console.info(`===MP-SCRIPT-END===`);
  player.sendMessage(
    `${color.success}已导出到内容日志${color.muted}（需在 设置→创作者 开启「内容日志 GUI/文件」；搜 MP-SCRIPT 可定位）`,
  );
}

/** 注册 /mp:script 命令 */
export function registerScriptCommand(registry: Parameters<typeof defineCommand>[0]): void {
  defineCommand(
    registry,
    {
      name: "mp:script",
      description: "编程模式：管理假人的脚本（指令序列）——add/list/clear/loop/run/stop/status/dump",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [
        { name: "name", type: CustomCommandParamType.String },
        { name: "action", type: CustomCommandParamType.String },
      ],
      optionalParameters: [
        { name: "p1", type: CustomCommandParamType.String },
        { name: "p2", type: CustomCommandParamType.String },
        { name: "p3", type: CustomCommandParamType.String },
        { name: "p4", type: CustomCommandParamType.String },
      ],
    },
    ({ player, params }) => {
      const botName = String(params.name ?? "").trim();
      const bot = resolveBotForCommand(player, botName);
      if (!bot) return;
      const record: BotRecord = bot.record;
      const { action, glued } = splitAction(String(params.action ?? ""));
      const extras = [params.p1, params.p2, params.p3, params.p4].filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      );
      const spec = [glued, ...extras].filter((v) => v.length > 0).join(" ");

      switch (action) {
        case "add": {
          if (spec.length === 0) {
            player.sendMessage(
              `${color.error}用法：/mp:script ${botName} add <模块> [参数]（如 add 走到 100 64 200）`,
            );
            return;
          }
          const program = normalizeScriptProgram(record.script);
          if (program.steps.length >= MAX_SCRIPT_STEPS) {
            player.sendMessage(`${color.error}已达单脚本上限：${MAX_SCRIPT_STEPS} 条`);
            return;
          }
          const parsed = parseScriptSpec(spec);
          if ("error" in parsed) {
            player.sendMessage(`${color.error}${parsed.error}`);
            return;
          }
          program.steps.push(parsed.step);
          record.script = program;
          saveCoordinator.saveRecord(record);
          const n = program.steps.length;
          const hint =
            n === 1 && record.workMode !== "script"
              ? `${color.muted}（用 /mp:script ${botName} run 启动；list 查看全部）`
              : `${color.muted}（共 ${n} 条）`;
          player.sendMessage(
            `${color.success}已添加第 ${n} 条：${color.black}${describeStep(parsed.step)} ${hint}`,
          );
          return;
        }
        case "list": {
          sendList(player, botName, normalizeScriptProgram(record.script));
          return;
        }
        case "clear": {
          const program = normalizeScriptProgram(record.script);
          program.steps = [];
          record.script = program;
          saveCoordinator.saveRecord(record);
          player.sendMessage(
            `${color.success}已清空指令（循环设置保留：${describeLoopCount(program.loopCount)}）`,
          );
          return;
        }
        case "loop": {
          const token = spec.split(/\s+/)[0] ?? "";
          const value = parseLoopCountInput(token);
          if (value === undefined) {
            player.sendMessage(`${color.error}用法：/mp:script ${botName} loop <次数|一直|关>`);
            return;
          }
          const program = normalizeScriptProgram(record.script);
          program.loopCount = value;
          record.script = program;
          saveCoordinator.saveRecord(record);
          player.sendMessage(`${color.success}循环设置：${color.black}${describeLoopCount(value)}`);
          return;
        }
        case "run": {
          const program = normalizeScriptProgram(record.script);
          if (program.steps.length === 0) {
            player.sendMessage(
              `${color.warn}脚本为空：先用 /mp:script ${botName} add … 添加指令`,
            );
            return;
          }
          // 显式启动：标记运行中（用户规格：设置工作模式 ≠ 启动脚本）
          record.scriptRunning = true;
          setWorkMode(record, "script");
          requestScriptKick(botName);
          player.sendMessage(
            `${color.success}已启动：${color.black}${program.steps.length} 条 · ${describeLoopCount(program.loopCount)}` +
              `${color.muted}（假人需在线且未死亡）`,
          );
          return;
        }
        case "stop": {
          setWorkMode(record, "none");
          player.sendMessage(`${color.success}已停止（工作模式 → 无）`);
          return;
        }
        case "status": {
          const rt = getScriptRuntime(botName);
          const program = normalizeScriptProgram(record.script);
          if (!rt) {
            player.sendMessage(
              `${color.muted}暂无运行记录（当前 ${program.steps.length} 条 · ${describeLoopCount(program.loopCount)}；未运行过）`,
            );
            return;
          }
          const extra =
            rt.phase === "running"
              ? ` ${color.muted}第 ${rt.stepIndex}/${rt.total} 条 · 第 ${rt.cycle} 轮`
              : rt.message
                ? ` ${color.muted}(${rt.message})`
                : "";
          player.sendMessage(
            `${color.accent}编程状态：${color.black}${PHASE_TEXT[rt.phase] ?? rt.phase}${extra}` +
              ` ${color.muted}| 脚本 ${program.steps.length} 条 · ${describeLoopCount(program.loopCount)}`,
          );
          return;
        }
        case "dump": {
          dumpScript(player, botName, normalizeScriptProgram(record.script));
          return;
        }
        default: {
          sendUsage(player, botName);
          return;
        }
      }
    },
  );
}
