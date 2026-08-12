// ── 演示配置：模型 + DP 持久化 + 配置 UI ─────────────────────────────
// 配置是"存储区域"的完整参数：启用开关 + 维度 + 锚点 X/Z（决定区块地址）
// + 底层 Y（桶阵列最底层）+ 测试参数（每桶可用槽数 / 层数）。
// 持久化到 `ndsdemo:cfg`，保存后由调用方注入的 onApply 回调立即重新应用
// （registerTest 幂等，同区块共享；改锚点即新区域）。
// 默认配置 = 库 README 示例：末地 (0,120,-1024)，进游戏即可直接冒烟。
//
// ⚠️ 测试参数（slotPerBarrel/maxLevels）仅测试用途，走库的 registerTest 渠道：
// 解码恒按 27 槽/桶（ID 语义恒定），每桶可用槽数只限制分配（跳过桶内超限槽），
// 调小即可快速模拟满容量/见证扩容；正式模组请用 register 默认参数。
// 注意：本模块不依赖 storageService（避免循环依赖），应用动作经 onApply 注入。
import { world } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { ModalFormBuilder, notifyError, notifySuccess } from "@yinxe/toolkit";

/** 演示配置（存储区域的完整参数） */
export interface DemoConfig {
  /** 是否启用存取（关闭后不再注册/访问区域） */
  enabled: boolean;
  /** 完整维度 ID（minecraft:the_end / overworld / nether） */
  dimension: string;
  /** 锚点 X（所在区块即存储地址） */
  anchorX: number;
  /** 锚点 Z */
  anchorZ: number;
  /** 最底层木桶 Y（默认 120） */
  baseY: number;
  /** ⚠️ 仅测试：每桶可分配槽位上限 1..27（默认 27 = 全部可用；解码恒按 27 槽/桶） */
  slotPerBarrel: number;
  /** ⚠️ 仅测试：纵向层数上限 1..64（默认 64） */
  maxLevels: number;
}

/** 配置 DP 键 */
const CONFIG_KEY = "ndsdemo:cfg";

/** 配置 UI 可选维度列表 */
const DIMENSIONS = [
  { id: "minecraft:the_end", label: "末地（推荐）" },
  { id: "minecraft:overworld", label: "主世界" },
  { id: "minecraft:nether", label: "下界" },
] as const;

/** 底层 Y 合法范围（世界最低 -64 起，桶阵列 64 层不顶到世界上限 320） */
const BASE_Y_MIN = -64;
const BASE_Y_MAX = 256;

/** 默认配置（库 README 示例：末地 (0,120,-1024)；测试参数默认 = 正式行为） */
export function defaultConfig(): DemoConfig {
  return {
    enabled: true,
    dimension: "minecraft:the_end",
    anchorX: 0,
    anchorZ: -1024,
    baseY: 120,
    slotPerBarrel: 27,
    maxLevels: 64,
  };
}

/** 读取配置（DP）；缺失/损坏/旧格式回退默认值 */
export function loadConfig(): DemoConfig {
  try {
    const raw = world.getDynamicProperty(CONFIG_KEY);
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw) as Partial<DemoConfig>;
      const base = defaultConfig();
      return {
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : base.enabled,
        dimension: typeof parsed.dimension === "string" ? parsed.dimension : base.dimension,
        anchorX: typeof parsed.anchorX === "number" ? parsed.anchorX : base.anchorX,
        anchorZ: typeof parsed.anchorZ === "number" ? parsed.anchorZ : base.anchorZ,
        baseY: typeof parsed.baseY === "number" ? parsed.baseY : base.baseY,
        slotPerBarrel: typeof parsed.slotPerBarrel === "number" ? parsed.slotPerBarrel : base.slotPerBarrel,
        maxLevels: typeof parsed.maxLevels === "number" ? parsed.maxLevels : base.maxLevels,
      };
    }
  } catch (e) {
    console.warn("[nds-demo] 读取配置失败，使用默认配置", e);
  }
  return defaultConfig();
}

/** 保存配置到 DP */
export function saveConfig(config: DemoConfig): void {
  try {
    world.setDynamicProperty(CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn("[nds-demo] 保存配置失败", e);
  }
}

// ─── 配置 UI（完整配置：开关 + 维度 + 锚点 + 底层Y + 测试参数） ─────────

/** 配置表单回调：调用方负责持久化 + 应用（返回 null/undefined = 成功或停用；字符串 = 失败原因） */
export interface ConfigFormOptions {
  onApply?: (config: DemoConfig) => string | null | void;
}

/**
 * 打开配置 ModalForm：所有存储区域参数均可改，保存后经 onApply 立即重新应用注册。
 * 输入校验：X/Z/Y 必须为整数，Y 必须在 [-64, 256]；测试参数用滑杆（天然整数范围）。
 */
export async function showConfigForm(player: Player, opts: ConfigFormOptions = {}): Promise<void> {
  const cfg = loadConfig();
  const dimIndex = Math.max(
    0,
    DIMENSIONS.findIndex((d) => d.id === cfg.dimension)
  );

  const vals = await new ModalFormBuilder()
    .title("§lNBT 存储测试 · 配置")
    .label("_hint", "§7存储区域 = 锚点所在区块的全木桶阵列\n§7同区块任意锚点共享同一阵列；改锚点即新区域")
    .divider()
    .toggle("enabled", "启用存储", { defaultValue: cfg.enabled, tooltip: "关闭后停止存取，已存物品保留在桶阵列中" })
    .dropdown(
      "dimension",
      "维度",
      DIMENSIONS.map((d) => d.label),
      { defaultValueIndex: dimIndex }
    )
    .textFieldWithPlaceholder("anchorX", "锚点 X", "整数；区块坐标 = floor(x/16)", {
      defaultValue: String(cfg.anchorX),
    })
    .textFieldWithPlaceholder("anchorZ", "锚点 Z", "如 -1024 → 区块 -64", {
      defaultValue: String(cfg.anchorZ),
    })
    .textFieldWithPlaceholder("baseY", "底层 Y", `最底层木桶 Y（${BASE_Y_MIN}..${BASE_Y_MAX}，默认 120）`, {
      defaultValue: String(cfg.baseY),
    })
    .divider()
    .label(
      "_test",
      "§7⚠️ 以下为测试参数（仅测试模组用）：解码恒按 27 槽/桶，\n§7调小每桶槽数/层数 → 容量变小 → 快速堆满 + 见证扩容"
    )
    .slider("slotPerBarrel", "每桶可用槽数（仅测试）", 1, 27, {
      defaultValue: cfg.slotPerBarrel,
      valueStep: 1,
      tooltip: "1..27，默认 27（全部可用）；ID 解码恒按 27 槽/桶，此值只限制每桶可分配槽数。创建后不可变，改它需换锚点",
    })
    .slider("maxLevels", "层数（仅测试）", 1, 64, {
      defaultValue: cfg.maxLevels,
      valueStep: 1,
      tooltip: "1..64，默认 64；可动态调整：扩层任意生效，缩层需高层无物品（已有数据不受影响）",
    })
    .divider()
    .submitButton("保存并应用")
    .show(player);
  if (!vals) return;

  const anchorX = Number(vals.anchorX);
  const anchorZ = Number(vals.anchorZ);
  const baseY = Number(vals.baseY);
  if (!Number.isInteger(anchorX) || !Number.isInteger(anchorZ) || !Number.isInteger(baseY)) {
    notifyError(player, "锚点 X/Z 与底层 Y 必须填写整数");
    return;
  }
  if (baseY < BASE_Y_MIN || baseY > BASE_Y_MAX) {
    notifyError(player, `底层 Y 需在 ${BASE_Y_MIN}..${BASE_Y_MAX} 之间`);
    return;
  }

  const dim = DIMENSIONS[Number(vals.dimension)] ?? DIMENSIONS[0];
  const next: DemoConfig = {
    enabled: Boolean(vals.enabled),
    dimension: dim.id,
    anchorX,
    anchorZ,
    baseY,
    slotPerBarrel: Number(vals.slotPerBarrel),
    maxLevels: Number(vals.maxLevels),
  };
  // 停用时无需应用成功与否（已存物品留在桶阵列）；启用时以应用结果（错误信息）为准
  const fail = next.enabled ? (opts.onApply?.(next) ?? null) : null;
  if (fail) {
    notifyError(player, `应用失败，配置未保存（仍使用上次成功配置）：${fail}`);
    return;
  }
  notifySuccess(
    player,
    next.enabled
      ? `配置已保存并应用：${dim.label} 锚点 (${anchorX}, ${baseY}, ${anchorZ})\n每桶 ${next.slotPerBarrel} 槽 × ${next.maxLevels} 层｜可开始存取（/nds-demo:ui 打开菜单）`
      : "配置已保存：存储已停用（已存物品保留在桶阵列中）"
  );
}
