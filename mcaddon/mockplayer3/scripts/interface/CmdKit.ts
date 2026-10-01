// ─── 命令目录框架（目录=注册=帮助，唯一真源） ──────────────────────
// mp:* 命令声明为 CommandSpec 进目录，注册委托 toolkit defineCommand；本层附加：
// admin 权限位（OP∨名单）、Enum 参数注册（键名归一）与 ctx 守卫缝、异常回显。
// 处理器只做一跳翻译（意图→Lifecycle/Modes 调用），零业务规则零持久化。

import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import type { CustomCommandRegistry, Player } from "@minecraft/server";
import { color, defineCommand, style, trySendMessage } from "@yinxe/toolkit";
import type { Viewer } from "../domain/Permissions";
import { canManage, isAdmin } from "../domain/Permissions";
import type { BotRecord } from "../domain/Record";
import type { Vec3 } from "../domain/Coords";
import { playerKey } from "../domain/Identity";
import { services } from "../Composition";

// ─── 目录类型 ──

/** 参数声明（坐标=Param.Location 原生取值；枚举=Param.Enum + enum 值表） */
export interface ArgSpec {
  name: string;
  type: CustomCommandParamType;
  optional?: boolean;
  /** 枚举值表；引擎按"参数名===注册枚举名"绑定，注册名由 enumName 派生 */
  enum?: readonly string[];
}

/** 参数类型转发（命令组文件免各自引枚举） */
export const Param = CustomCommandParamType;

/** 枚举注册名：须带命名空间且与命令同代际，否则引擎报 NamespaceMismatch */
function enumName(commandName: string, arg: ArgSpec): string {
  return `mp:${commandName.split(":")[1]}_${arg.name}`;
}

/** 发射给引擎的参数名（枚举参数=注册枚举名，其余=目录参数名） */
function engineName(commandName: string, arg: ArgSpec): string {
  return arg.enum ? enumName(commandName, arg) : arg.name;
}

/** 执行上下文（守卫缝：错误自动回发，返回 null=已回发、调用方中止） */
export interface CommandCtx {
  player: Player;
  viewer: Viewer;
  /** 是否管理员（OP∨名单；admin 权限位由包装器执法，此字段供附加场景） */
  readonly admin: boolean;
  /** 即时回显（断线静默） */
  say(text: string): void;
  /** 解析假人并校验管理权（含无主认领）；null=已回发错误，调用方中止 */
  bot(rawName: string | undefined): { botId: number; record: BotRecord } | null;
  /** 坐标参数取值（Param.Location 原生三分量；缺省回退 fallback） */
  coord(raw: unknown, fallback: Vec3): Vec3;
}

/** 命令目录项；帮助文本由目录渲染，勿另写手册 */
export interface CommandSpec {
  name: string;
  description: string;
  /** 使用示例（mp:cmdlist 渲染行，含参数形状） */
  usage?: string;
  args?: ArgSpec[];
  /** any=玩家即可；admin=OP∨名单（包装器统一执法，处理器内不再判权） */
  permission?: "any" | "admin";
  execute(ctx: CommandCtx, args: Record<string, unknown>): void | Promise<void>;
}

// ─── 注册包装 ──

/**
 * 注册命令目录；须在 system.beforeEvents.startup 内调用一次。
 * @param registry 引擎命令注册表
 * @param specs 命令目录（全量）
 */
export function registerCommands(registry: CustomCommandRegistry, specs: readonly CommandSpec[]): void {
  // 枚举名由命令作用域派生，目录内天然唯一；一次调用内查重即可
  const emitted = new Map<string, string>();
  for (const spec of specs) {
    const args = spec.args ?? [];
    const paramOf = (a: ArgSpec) => ({ name: engineName(spec.name, a), type: a.type });
    const keys = args.map((a) => ({ out: a.name, in: engineName(spec.name, a) }));
    const mandatory = args.filter((a) => !a.optional).map(paramOf);
    const optional = args.filter((a) => a.optional).map(paramOf);
    try {
      // 枚举必须先于命令注册（引擎按参数名查已注册枚举，缺失即 EnumDependencyMissing 整条失败）
      for (const a of args) {
        if (!a.enum) continue;
        const name = enumName(spec.name, a);
        const fingerprint = a.enum.join(",");
        const prev = emitted.get(name);
        if (prev !== undefined) {
          if (prev !== fingerprint) console.error(`[mockplayer3] 枚举值表冲突 ${name}：${prev} ≠ ${fingerprint}`);
          continue;
        }
        registry.registerEnum(name, [...a.enum]);
        emitted.set(name, fingerprint);
      }
      defineCommand(
        registry,
        {
          name: spec.name,
          description: spec.description,
          cheatsRequired: false,
          permissionLevel: CommandPermissionLevel.Any,
          mandatoryParameters: mandatory,
          optionalParameters: optional,
        },
        ({ player, params }) => {
          const say = (text: string) => trySendMessage(player, text);
          // defineCommand 已入 system.run；此处做同步守卫与异步异常回显
          try {
            const viewer: Viewer = { key: playerKey(player.name), isOp: player.playerPermissionLevel >= 2 };
            const admin = isAdmin(viewer, services.runtime.config);
            if ((spec.permission ?? "any") === "admin" && !admin) {
              say(style("该命令仅管理员可用", color.error));
              return;
            }
            // 引擎回传的键是枚举注册名，归一回目录参数名（处理器照旧写 a.mode）
            const typed: Record<string, unknown> = {};
            for (const k of keys) typed[k.out] = params[k.in];
            const ctx: CommandCtx = {
              player,
              viewer,
              admin,
              say,
              bot: (rawName) => resolveBot(say, viewer, rawName),
              coord: (raw, fallback) => readLocation(raw, fallback),
            };
            const ret = spec.execute(ctx, typed);
            if (ret instanceof Promise) {
              ret.catch((e: any) => say(style(`命令执行异常: ${e?.message ?? e}`, color.error)));
            }
          } catch (e: any) {
            say(style(`命令执行异常: ${e?.message ?? e}`, color.error));
          }
        }
      );
    } catch (e: any) {
      console.error(`[mockplayer3] 命令注册失败 ${spec.name}: ${e?.message ?? e}`);
    }
  }
}

/** Param.Location 取值：正常给 {x,y,z}；形状不符（引擎代际差异）留痕并回退 fallback */
function readLocation(raw: unknown, fallback: Vec3): Vec3 {
  if (raw === undefined || raw === null) return fallback;
  const shape = (raw as { position?: unknown }).position ?? raw;
  const v = shape as Partial<Vec3>;
  if (typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number") {
    return { x: v.x, y: v.y, z: v.z };
  }
  console.warn(`[mockplayer3] 坐标参数形状异常: ${JSON.stringify(raw)}——已回退缺省坐标`);
  return fallback;
}

// ─── 管理守卫（命令与面板共用） ──

/**
 * 解析假人并校验管理权（含无主自动认领）。
 * @param say 回发通道
 * @param viewer 执行者身份
 * @param rawName 命令原始名字参数
 * @returns 有权时返回 botId/record；失败已回发提示并返回 null
 */
export function resolveBot(
  say: (t: string) => void,
  viewer: Viewer,
  rawName: string | undefined
): { botId: number; record: BotRecord } | null {
  const { runtime, lifecycle } = services;
  const name = rawName?.trim() ?? "";
  if (!name) {
    say(style("请指定假人名字", color.error));
    return null;
  }
  const botId = runtime.findBotIdByName(name);
  if (botId === undefined) {
    say(`${style("未找到假人", color.error)} ${style(name, color.playerName)} ${style("的记录", color.error)}`);
    return null;
  }
  const record = runtime.record(botId);
  if (!record) {
    say(`${style("未找到假人", color.error)} ${style(name, color.playerName)} ${style("的记录", color.error)}`);
    return null;
  }
  if (canManage(viewer, record, runtime.config)) return { botId, record };
  // 无主假人首次管理操作自动认领：谁先管理谁为主人
  if (record.ownerKey === null && lifecycle.claimIfOwnerless(viewer, botId)) {
    say(
      `${style("已自动认领假人", color.success)} ${style(record.name, color.playerName)}${style("（旧版数据，首次操作生效）", color.success)}`
    );
    return { botId, record };
  }
  say(`${style(`假人 ${name} 只允许主人或管理员操作`, color.error)}`);
  return null;
}

// ─── 帮助渲染 ──

/**
 * 由命令目录渲染帮助行。
 * @param specs 命令目录
 * @returns 逐行文本
 */
export function renderHelpLines(specs: readonly CommandSpec[]): string[] {
  const lines: string[] = [style("≡≡≡ MockPlayer · 命令目录 ≡≡≡", color.accent)];
  for (const s of specs) {
    const usage = s.usage ?? s.name;
    lines.push(`${style(usage, color.info)} ${style(`- ${s.description}`, color.muted)}`);
  }
  return lines;
}
