// ─── 编程模式界面（M2） ──────────────────────────────────
// 页面结构（对齐用户方案 v0.3）：
//   ① 编程主页：状态 / 指令数 / 循环设置 + 添加·编辑·循环·启停·清空
//   ② 指令列表：每条最左边带序号；每页 6 条；底部常驻「＋ 增加模块」+「跳转到第 N 条」
//   ③ 单条操作：改参数 / 上移 / 下移 / 复制一份 / 在下方插入 / 删除
//   ④ 选分类 → 选模块 → 参数输入（无参数模块点了直接插入）
//   ⑤ 循环设置
//
// 坐标输入（用户规格 2026-10-01）：**一个输入框填「X Y Z」**（空格分隔），
//   支持 (x,y,z) / 中文逗号 / ~ 相对坐标；一律**向下取整**（100.9 → 100）。
//   「挖掘前方 / 使用物品 / 潜行开 / 潜行关 / 跳一下」带**可选**对准坐标：
//   留空 = 按原行为；填了 = 先转头对准该方块再动作。
//
// 关于「返回时不要跳回顶部」：基岩版表单接口没有滚动位置控制，所以用
//   「分页 + 记住页码」——上移/下移/插入/删除后回到该条所在页；每页 6 条，
//   让一页在手机竖屏下基本不需要滚动。
//
// 编辑与运行：任何改动都会 requestScriptKick，令正在跑的脚本按新内容重开一轮。
import { type Player, world } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder, color, style } from "@yinxe/toolkit";
import { BotUiEvent } from "../../../events/UiEvents";
import { resolveUiBotRecord } from "../helpers";
import { botRegistry, saveCoordinator } from "../../../bootstrap/context";
import { setWorkMode } from "../../../features/state/behavior";
import {
  getLastAddedIndex,
  getScriptRuntime,
  requestScriptKick,
  setLastAddedIndex,
} from "../../../features/script/runtime";
import { isAdmin } from "../../commands/auth";
import { visibleRecords } from "../../../service/BotVisibility";
import { showBotPanel } from "../bot";
import {
  MAX_SCRIPT_STEPS,
  type BotRecord,
  type ScriptCoord,
  type ScriptProgram,
  type ScriptStep,
} from "../../../rules/Types";
import {
  SCRIPT_CATEGORIES,
  SCRIPT_MODULES,
  describeLoopCount,
  describeStep,
  modulesOfCategory,
  normalizeScriptProgram,
  type ScriptModuleDef,
} from "../../../rules/script/ScriptRules";
import { parseCoordinateInput } from "../../../rules/coords/Coordinate";

/** 每页指令条数（手机竖屏下一屏放得下，避免页内滚动） */
const PAGE_SIZE = 6;

/** 取记录并归一化脚本 */
function loadProgram(record: BotRecord): ScriptProgram {
  return normalizeScriptProgram(record.script);
}

/** 落库：写回脚本 + 保存 + 通知执行器重跑 */
function commitProgram(record: BotRecord, program: ScriptProgram): void {
  record.script = program;
  saveCoordinator.saveRecord(record);
  requestScriptKick(record.name);
}

/** 解析坐标输入串（单框「X Y Z」）→ 向下取整坐标；失败返回中文原因 */
function parseCoordInput(input: string, origin: { x: number; y: number; z: number }): ScriptCoord | string {
  const parsed = parseCoordinateInput(input, origin);
  if (!parsed.ok) return parsed.message;
  return {
    x: Math.floor(parsed.pos.x),
    y: Math.floor(parsed.pos.y),
    z: Math.floor(parsed.pos.z),
  };
}

/** 运行状态文本 */
function statusText(record: BotRecord): string {
  const rt = getScriptRuntime(record.name);
  if (record.workMode !== "script" || record.scriptRunning !== true) return `${color.muted}未运行`;
  if (!rt) return `${color.success}运行中`;
  switch (rt.phase) {
    case "running":
      return `${color.success}运行中 ${color.muted}第 ${rt.stepIndex}/${rt.total} 条 · 第 ${rt.cycle} 轮`;
    case "completed":
      return `${color.info}已完成 ${color.muted}(${rt.total} 条 × ${rt.cycle} 轮)`;
    case "failed":
      return `${color.error}已失败 ${color.muted}第 ${rt.stepIndex}/${rt.total} 条：${rt.message}`;
    case "empty":
      return `${color.warn}等待脚本 ${color.muted}(脚本为空)`;
    default:
      return `${color.muted}空闲`;
  }
}

/** 列表项文本：序号放最左边；最近添加的一条末尾带橙色圆点标记（关闭页面后仍在） */
function stepLabel(index: number, step: ScriptStep, botName: string): string {
  const mark = getLastAddedIndex(botName) === index ? ` ${color.gold}●` : "";
  // 注释（用户规格 3.1.6）：显示在最前，其后是模块描述与参数值，便于分辨用途
  const note = step.note ? `${color.accent}${step.note} ` : "";
  return `${color.success}${index + 1}. ${note}${color.black}${describeStep(step)}${mark}`;
}

// ─── 选人列表（羽毛对空气时进入） ────────────────────────
export function showScriptPicker(player: Player): void {
  const records = [...visibleRecords(botRegistry.all(), player.name, isAdmin(player))].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  if (records.length === 0) {
    player.sendMessage(`${color.warn}暂无可见的模拟玩家（先用 /mp:create 创建一个）`);
    return;
  }
  const builder = new ActionFormBuilder()
    .title(`${color.bold}编程 · 选择假人`)
    .body(`${color.muted}点一个假人 → 直接进它的编程界面（在线优先排序）`);
  for (const rec of records) {
    const dot = rec.online ? `${color.success}●` : `${color.muted}○`;
    const count = loadProgram(rec).steps.length;
    const tail = `${color.muted}（${count > 0 ? `${count} 条` : "无指令"}）`;
    builder.button(`${dot} ${style(rec.name, color.playerName)} ${tail}`, () =>
      showScriptPanel(player, rec.name),
    );
  }
  builder.button(style("← 关闭", color.muted), () => {
    // 关闭：不做任何事
  });
  builder.show(player);
}

// ─── UI 事件订阅（假人面板 → 编程入口） ──────────────────
/** 订阅假人面板动作：点「编程」按钮直接进入该假人的编程界面 */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "openScript") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    showScriptPanel(player, e.botName);
  });
}

// ─── ① 编程主页 ──────────────────────────────────────────
export function showScriptPanel(player: Player, botName: string): void {
  const record = resolveUiBotRecord(player, botName);
  if (!record) return;
  const program = loadProgram(record);
  const total = program.steps.length;
  const running = record.workMode === "script" && record.scriptRunning === true;

  new ActionFormBuilder()
    .title(`${color.bold}编程 · ${botName}`)
    .body(
      `${color.accent}状态：${statusText(record)}\n` +
        `${color.accent}指令：${color.black}${total > 0 ? `${total} 条` : "无"}\n` +
        `${color.accent}循环：${color.black}${describeLoopCount(program.loopCount)}`,
    )
    .button(style("＋ 添加指令", color.darkGreen), () => showPickCategory(player, botName))
    .button(style("编辑指令列表", color.darkBlue), () => showScriptList(player, botName, 0))
    .button(
      style(`循环设置：${describeLoopCount(program.loopCount)}`, color.darkBlue),
      () => showScriptLoop(player, botName),
    )
    .button(
      running ? style("■ 停止脚本", color.darkRed) : style("▶ 启动脚本", color.darkGreen),
      () => {
        if (running) {
          setWorkMode(record, "none");
          player.sendMessage(`${color.success}已停止编程脚本`);
          // 停止后重新打开面板（用户规格：方便继续改脚本）；启动则直接关闭
          showScriptPanel(player, botName);
          return;
        }
        if (total === 0) {
          player.sendMessage(`${color.warn}脚本为空：先添加指令再启动`);
          return;
        }
        // 显式启动：标记运行中（用户规格：设置工作模式 ≠ 启动脚本）
        record.scriptRunning = true;
        setWorkMode(record, "script");
        requestScriptKick(botName);
        player.sendMessage(
          `${color.success}已启动编程脚本（${total} 条 · ${describeLoopCount(program.loopCount)}）` +
            `${color.muted}（假人需在线且未死亡）`,
        );
        // 用户规格：启动后直接关闭页面，不再重开
      },
    )
    .button(style("清空脚本", color.darkRed), () => confirmClearScript(player, botName))
    .button(style("返回假人面板", color.muted), () => showBotPanel(player, botName))
    .show(player);
}

/** 清空脚本二次确认（用户规格：要弹确认按钮） */
function confirmClearScript(player: Player, botName: string): void {
  const record = resolveUiBotRecord(player, botName);
  if (!record) return;
  const total = loadProgram(record).steps.length;
  new ActionFormBuilder()
    .title(`${color.bold}清空脚本`)
    .body(
      `${color.warn}确定要清空全部 ${total} 条指令吗？${color.muted}\n循环设置会保留，但指令无法撤销。`,
    )
    .button(style("确定清空", color.darkRed), () => {
      const fresh = resolveUiBotRecord(player, botName);
      if (!fresh) return;
      const cur = loadProgram(fresh);
      cur.steps = [];
      commitProgram(fresh, cur);
      player.sendMessage(`${color.success}已清空指令（循环设置保留）`);
      showScriptPanel(player, botName);
    })
    .button(style("取消", color.muted), () => showScriptPanel(player, botName))
    .show(player);
}

// ─── ② 指令列表（分页 · 底部常驻「＋ 增加模块」） ─
export function showScriptList(player: Player, botName: string, page: number): void {
  const record = resolveUiBotRecord(player, botName);
  if (!record) return;
  const program = loadProgram(record);
  const total = program.steps.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.max(0, Math.min(page, pages - 1));
  const from = p * PAGE_SIZE;
  const slice = program.steps.slice(from, from + PAGE_SIZE);

  const builder = new ActionFormBuilder()
    .title(`${color.bold}指令列表`)
    .body(
      total === 0
        ? `${color.muted}还没有指令。点最下面的「＋ 增加模块」开始写。`
        : `${color.accent}共 ${color.black}${total}${color.accent} 条　${color.muted}第 ${p + 1}/${pages} 页` +
          `　${color.accent}循环：${color.black}${describeLoopCount(program.loopCount)}`,
    );

  for (let i = 0; i < slice.length; i++) {
    const step = slice[i];
    if (!step) continue;
    const index = from + i;
    builder.button(stepLabel(index, step, botName), () => showStepActions(player, botName, index));
  }
  builder.button(style("＋ 增加模块", color.darkGreen), () => showPickCategory(player, botName));
  if (p > 0) builder.button(style("◀ 上一页", color.muted), () => showScriptList(player, botName, p - 1));
  if (p < pages - 1) builder.button(style("下一页 ▶", color.muted), () => showScriptList(player, botName, p + 1));
  builder.button(style("← 返回", color.muted), () => showScriptPanel(player, botName));
  builder.show(player);
}

// ─── ③ 单条操作 ──────────────────────────────────────────
export function showStepActions(player: Player, botName: string, index: number): void {
  const record = resolveUiBotRecord(player, botName);
  if (!record) return;
  const program = loadProgram(record);
  const step = program.steps[index];
  if (!step) {
    showScriptList(player, botName, 0);
    return;
  }
  /** 该条所在页（改动后按新位置回到同页，避免跳回第一页） */
  const pageOf = (i: number): number => Math.floor(Math.max(0, i) / PAGE_SIZE);

  new ActionFormBuilder()
    .title(`${color.bold}第 ${index + 1} 条`)
    .body(`${color.accent}${describeStep(step)}`)
    .button(style("改参数", color.darkBlue), () => showStepParams(player, botName, index))
    .button(style("⬆ 上移", color.darkBlue), () => {
      if (index <= 0) {
        player.sendMessage(`${color.warn}已经是第一条`);
        showScriptList(player, botName, pageOf(index));
        return;
      }
      const a = program.steps[index - 1];
      const b = program.steps[index];
      if (a && b) {
        program.steps[index - 1] = b;
        program.steps[index] = a;
      }
      commitProgram(record, program);
      showScriptList(player, botName, pageOf(index - 1));
    })
    .button(style("⬇ 下移", color.darkBlue), () => {
      if (index >= program.steps.length - 1) {
        player.sendMessage(`${color.warn}已经是最后一条`);
        showScriptList(player, botName, pageOf(index));
        return;
      }
      const a = program.steps[index + 1];
      const b = program.steps[index];
      if (a && b) {
        program.steps[index + 1] = b;
        program.steps[index] = a;
      }
      commitProgram(record, program);
      showScriptList(player, botName, pageOf(index + 1));
    })
    .button(style("复制一份（插在下方）", color.darkGreen), () => {
      if (program.steps.length >= MAX_SCRIPT_STEPS) {
        player.sendMessage(`${color.error}已达单脚本上限：${MAX_SCRIPT_STEPS} 条`);
        showScriptList(player, botName, pageOf(index));
        return;
      }
      program.steps.splice(index + 1, 0, JSON.parse(JSON.stringify(step)) as ScriptStep);
      commitProgram(record, program);
      setLastAddedIndex(botName, index + 1);
      player.sendMessage(`${color.success}已复制第 ${index + 1} 条`);
      showScriptList(player, botName, pageOf(index + 1));
    })
    .button(style("＋ 在下方插入新模块", color.darkGreen), () =>
      showPickCategory(player, botName, index),
    )
    .button(style("删除这一条", color.darkRed), () => {
      program.steps.splice(index, 1);
      commitProgram(record, program);
      player.sendMessage(`${color.success}已删除第 ${index + 1} 条`);
      showScriptList(player, botName, pageOf(index));
    })
    .button(style("← 返回列表", color.muted), () => showScriptList(player, botName, pageOf(index)))
    .show(player);
}

// ─── ④ 选分类 → 选模块 → 参数 ────────────────────────────
export function showPickCategory(player: Player, botName: string, insertAfter?: number): void {
  const builder = new ActionFormBuilder()
    .title(`${color.bold}选择分类`)
    .body(
      insertAfter === undefined
        ? `${color.muted}要往脚本里加什么？`
        : `${color.muted}将在第 ${insertAfter + 1} 条下方插入`,
    );
  for (const cat of SCRIPT_CATEGORIES) {
    const count = modulesOfCategory(cat).length;
    builder.button(`${style(cat, color.playerName)} ${color.muted}（${count}）`, () =>
      showPickModule(player, botName, cat, insertAfter),
    );
  }
  // 跳转不归类：直接摆出来（用户规格）
  const jumpMod = SCRIPT_MODULES.find((m) => m.stepType === "jump");
  if (jumpMod) {
    builder.button(style("跳转到第 N 条", color.gold), () =>
      showModuleParams(player, botName, jumpMod, -1, insertAfter),
    );
  }
  builder.button(style("← 返回", color.muted), () => {
    if (insertAfter === undefined) showScriptPanel(player, botName);
    else showScriptList(player, botName, Math.floor(insertAfter / PAGE_SIZE));
  });
  builder.show(player);
}

export function showPickModule(
  player: Player,
  botName: string,
  cat: string,
  insertAfter?: number,
): void {
  const builder = new ActionFormBuilder()
    .title(`${color.bold}${cat} · 选模块`)
    .body(`${color.muted}带「（可指定坐标）」的模块：坐标留空 = 按原行为，填了就转头对准该方块。`);
  const mods = modulesOfCategory(cat);
  for (let i = 0; i < mods.length; i++) {
    const mod = mods[i];
    if (!mod) continue;
    builder.button(`${color.muted}${i + 1}. ${style(mod.label, color.playerName)}`, () =>
      handleModulePicked(player, botName, mod, insertAfter),
    );
  }
  builder.button(style("← 返回分类", color.muted), () => showPickCategory(player, botName, insertAfter));
  builder.show(player);
}

/** 无参数模块：直接插入；有参数模块：进参数页 */
function handleModulePicked(
  player: Player,
  botName: string,
  mod: ScriptModuleDef,
  insertAfter?: number,
): void {
  // 所有模块统一进参数表单（用户规格 3.1.6：添加时可填注释；无参数模块也一样）
  showModuleParams(player, botName, mod, -1, insertAfter);
}

/** 由模块定义 + 参数值构造指令（坐标向下取整） */
function buildStep(mod: ScriptModuleDef, values: Record<string, unknown>): ScriptStep {
  const n = typeof values.num === "number" ? values.num : 1;
  const coord = values.coord as ScriptCoord | undefined;
  const look = values.look as ScriptCoord | undefined;
  switch (mod.stepType) {
    case "moveTo":
      return { type: "moveTo", ...(coord ?? { x: 0, y: 0, z: 0 }) };
    case "mine":
      return { type: "mine", ...(coord ?? { x: 0, y: 0, z: 0 }) };
    case "place":
      return { type: "place", ...(coord ?? { x: 0, y: 0, z: 0 }) };
    case "look":
      return { type: "look", ...(coord ?? { x: 0, y: 0, z: 0 }) };
    case "wait":
      return { type: "wait", ticks: Math.max(1, Math.floor(n * 20)) };
    case "attack":
      return { type: "attack", count: Math.max(1, Math.floor(n)) };
    case "say":
      return { type: "say", text: String(values.text ?? "") };
    case "sneak":
      return look ? { type: "sneak", on: mod.fixed?.on ?? true, look } : { type: "sneak", on: mod.fixed?.on ?? true };
    case "jump":
      return { type: "jump", target: Math.max(1, Math.floor(n)) };
    case "mineLook":
      return look ? { type: "mineLook", look } : { type: "mineLook" };
    case "useItem":
      return look ? { type: "useItem", look } : { type: "useItem" };
    case "hop":
      return look ? { type: "hop", look } : { type: "hop" };
  }
}

// ─── 参数输入 ────────────────────────────────────────────
/** 打开参数页（editIndex ≥ 0 表示改已有条目，否则按 insertAfter 插入） */
export function showModuleParams(
  player: Player,
  botName: string,
  mod: ScriptModuleDef,
  editIndex: number,
  insertAfter?: number,
): void {
  const record = resolveUiBotRecord(player, botName);
  if (!record) return;
  const program = loadProgram(record);
  const editing = editIndex >= 0;
  const cur = editing ? program.steps[editIndex] : undefined;
  const origin = player.location;

  /** 取消/失败后回到上一层 */
  const back = (): void => {
    if (editing) showStepActions(player, botName, editIndex);
    else showScriptList(player, botName, 0);
  };

  const builder = new ModalFormBuilder().title(
    editing ? `${color.bold}改参数 · ${mod.label}` : `${color.bold}添加 · ${mod.label}`,
  );

  if (mod.param === "coord") {
    let def = "";
    if (cur && "x" in cur) def = `${cur.x} ${cur.y} ${cur.z}`;
    builder.textField("coord", style("坐标（X Y Z）", color.accent), {
      defaultValue: def,
      tooltip: "三个数字用空格分开，例：100 64 200；支持 (100,64,200) 和 ~ 相对坐标；小数自动向下取整",
    });
  } else if (mod.param === "coordOptional") {
    let def = "";
    if (cur && "look" in cur && cur.look) def = `${cur.look.x} ${cur.look.y} ${cur.look.z}`;
    builder.textField("look", style("对准坐标（可留空）", color.accent), {
      defaultValue: def,
      tooltip: "留空 = 不指定（按原行为）；填了就先把头转向该方块，例：100 64 200；小数向下取整",
    });
  } else if (mod.stepType === "wait") {
    const sec = cur && cur.type === "wait" ? Math.round((cur.ticks / 20) * 10) / 10 : 1;
    builder.textField("num", style("等待秒数", color.accent), {
      defaultValue: String(sec),
      tooltip: "最长 3600 秒；小数向下取整到 0.05 秒",
    });
  } else if (mod.stepType === "attack") {
    const count = cur && cur.type === "attack" ? cur.count : 1;
    builder.textField("num", style("攻击次数", color.accent), {
      defaultValue: String(count),
      tooltip: "1-500 之间；小数向下取整",
    });
  } else if (mod.stepType === "jump") {
    const target = cur && cur.type === "jump" ? cur.target : 1;
    builder.textField("num", style("跳转到第几条", color.accent), {
      defaultValue: String(target),
      tooltip: `当前共 ${program.steps.length} 条，序号从 1 开始；填 1 就是回到第一条`,
    });
  } else if (mod.stepType === "say") {
    const text = cur && cur.type === "say" ? cur.text : "";
    builder.textField("text", style("要说的话", color.accent), {
      defaultValue: text,
      tooltip: "最多 200 字",
    });
  }
  // 注释（用户规格 3.1.6：所有模块通用，可留空；列表里显示在最前）
  builder.textField("note", style("注释（可留空）", color.playerName), {
    defaultValue: cur?.note ?? "",
    tooltip: "给这个模块写个说明（最多 100 字），列表里会显示在最前面，方便分辨每个模块的用途",
  });
  builder.show(player).then((vals) => {
    if (!vals) {
      back();
      return;
    }
    const fresh = resolveUiBotRecord(player, botName);
    if (!fresh) return;
    const freshProgram = loadProgram(fresh);
    const values: Record<string, unknown> = {};

    if (mod.param === "coord") {
      const text = String(vals.coord ?? "").trim();
      const parsed = parseCoordInput(text, origin);
      if (typeof parsed === "string") {
        player.sendMessage(`${color.error}坐标无效：${parsed}（本次未保存）`);
        back();
        return;
      }
      values.coord = parsed;
    } else if (mod.param === "coordOptional") {
      const text = String(vals.look ?? "").trim();
      if (text.length > 0) {
        const parsed = parseCoordInput(text, origin);
        if (typeof parsed === "string") {
          player.sendMessage(`${color.error}对准坐标无效：${parsed}（本次未保存）`);
          back();
          return;
        }
        values.look = parsed;
      }
    } else if (mod.param === "num") {
      const raw = String(vals.num ?? "").trim();
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        player.sendMessage(`${color.error}请填一个大于 0 的数字（本次未保存）`);
        back();
        return;
      }
      if (mod.stepType === "jump") {
        const target = Math.floor(n);
        if (target < 1 || target > freshProgram.steps.length) {
          player.sendMessage(
            `${color.error}跳转目标越界：当前共 ${freshProgram.steps.length} 条，请填 1-${freshProgram.steps.length}（本次未保存）`,
          );
          back();
          return;
        }
      }
      values.num = n;
    } else if (mod.param === "text") {
      const text = String(vals.text ?? "").trim();
      if (text.length === 0) {
        player.sendMessage(`${color.error}内容不能为空（本次未保存）`);
        back();
        return;
      }
      values.text = text;
    }

    const step = buildStep(mod, values);
    // 注释（用户规格 3.1.6）：有值则写入（编辑时清空 = 删除注释）
    const noteText = typeof vals.note === "string" ? vals.note.trim() : "";
    if (noteText.length > 0) step.note = noteText.slice(0, 100);
    if (editing) {
      freshProgram.steps[editIndex] = step;
      commitProgram(fresh, freshProgram);
      player.sendMessage(`${color.success}已更新第 ${editIndex + 1} 条：${color.black}${describeStep(step)}`);
      showScriptList(player, botName, Math.floor(editIndex / PAGE_SIZE));
      return;
    }
    if (freshProgram.steps.length >= MAX_SCRIPT_STEPS) {
      player.sendMessage(`${color.error}已达单脚本上限：${MAX_SCRIPT_STEPS} 条`);
      showScriptList(player, botName, 0);
      return;
    }
    const at = insertAfter === undefined ? freshProgram.steps.length : insertAfter + 1;
    freshProgram.steps.splice(at, 0, step);
    commitProgram(fresh, freshProgram);
    setLastAddedIndex(botName, at);
    player.sendMessage(`${color.success}已插入：${color.black}${describeStep(step)}`);
    showScriptList(player, botName, Math.floor(at / PAGE_SIZE));
  });
}

/** 改已有条目的参数（供单条操作页调用） */
function showStepParams(player: Player, botName: string, index: number): void {
  const record = resolveUiBotRecord(player, botName);
  if (!record) return;
  const program = loadProgram(record);
  const step = program.steps[index];
  if (!step) {
    showScriptList(player, botName, 0);
    return;
  }
  const mod = SCRIPT_MODULES.find((m) => m.stepType === step.type && matchesFixed(m, step));
  if (!mod) {
    player.sendMessage(`${color.warn}未找到对应模块`);
    showStepActions(player, botName, index);
    return;
  }
  // 无参数模块也允许进编辑页（用户规格 3.1.6：可以给模块加/改注释）
  showModuleParams(player, botName, mod, index);
}

/** 潜行开/关同属 sneak，用固定参数区分 */
function matchesFixed(mod: ScriptModuleDef, step: ScriptStep): boolean {
  if (mod.stepType !== "sneak") return true;
  if (step.type !== "sneak") return false;
  return (mod.fixed?.on ?? true) === step.on;
}

// ─── ⑤ 循环设置 ──────────────────────────────────────────
export function showScriptLoop(player: Player, botName: string): void {
  const record = resolveUiBotRecord(player, botName);
  if (!record) return;
  const program = loadProgram(record);

  const setLoop = (value: number): void => {
    const fresh = resolveUiBotRecord(player, botName);
    if (!fresh) return;
    const p = loadProgram(fresh);
    p.loopCount = value;
    commitProgram(fresh, p);
    player.sendMessage(`${color.success}循环设置：${color.black}${describeLoopCount(value)}`);
    showScriptPanel(player, botName);
  };

  new ActionFormBuilder()
    .title(`${color.bold}循环设置`)
    .body(`${color.accent}当前：${color.black}${describeLoopCount(program.loopCount)}`)
    .button(style("只跑一遍", color.playerName), () => setLoop(1))
    .button(style("循环 3 次", color.playerName), () => setLoop(3))
    .button(style("循环 10 次", color.playerName), () => setLoop(10))
    .button(style("一直循环", color.darkGreen), () => setLoop(-1))
    .button(style("← 返回", color.muted), () => showScriptPanel(player, botName))
    .show(player);
}