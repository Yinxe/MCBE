// ─── server-graphics 能力探针 ─────────────────────────────────────
//
// 这个模块与 debug-utilities 的本质区别:
//
//   debug-utilities   → 往世界里加东西(线框),看得见就是生效
//   server-graphics   → 改渲染管线参数,看不见也可能是生效了
//
// 后者有个致命陷阱:文档里 45 处提到 Vibrant Visuals(鲜艳视觉),
// 而它要求客户端把图形模式设为 Deferred。非 Deferred 时 setter
// 往往不抛错、读回值也正确,但画面完全不变。
//
// 所以本探针的第一件事是报告 `Player.graphicsMode`,并在非 Deferred
// 时明确警告「以下读数不证明渲染生效」。这一条比任何单项测试都重要。

import { GraphicsMode, Player, system, world, type BiomeType } from "@minecraft/server";
import {
  getBiomeAtmospherics,
  getBiomeColorGrading,
  getBiomeLighting,
  getBiomeWater,
  getPlayerAtmospherics,
  getPlayerColorGrading,
  getPlayerLighting,
  getPlayerWater,
} from "@minecraft/server-graphics";
import {
  SKY_KEYFRAME_COLORS,
  SOLID_SKY_COLOR,
  describeSetReset,
  describeSetterArgument,
  describeTimeOfDay,
  sortedKeyframes,
  vibrantVisualsVerdict,
  type SetResetOutcome,
} from "./GraphicsProbeMath";
import {
  attempt,
  errorText,
  formatValue,
  heading,
  kv,
  report,
  verdict,
  warning,
  type Attempt,
} from "./DebugProbeShared";

/** 探针操作的生物群系。选平原:最常见,且默认天空色容易辨认 */
const PROBE_BIOME = "minecraft:plains" as unknown as BiomeType;

/**
 * 把 `Player.graphicsMode` 读成字符串。
 *
 * 读失败时返回 `undefined` 而不是猜一个值 —— 探针宁可说「不知道」,
 * 也不能因为读不到就假设「已开启」,那会让后面所有结论失去意义。
 */
function readGraphicsMode(player: Player): string | undefined {
  const result = attempt(() => player.graphicsMode);
  if (!result.ok) return undefined;
  return String(result.value);
}

/** 把一个「调用 + 读回」包成 Attempt,便于统一格式化 */
function callAndRead<T>(label: string, fn: () => T): Attempt<T> {
  void label;
  return attempt(fn);
}

/**
 * 第 0 组:渲染前提。
 *
 * 这一组不放行,后面所有组都不成立,所以单独成节并放在最前。
 */
function probePrecondition(player: Player, lines: string[]): boolean {
  lines.push(heading("0. 渲染前提(最重要)"));
  const mode = readGraphicsMode(player);
  const judgement = vibrantVisualsVerdict(mode);

  lines.push(`  ${kv("Player.graphicsMode", mode ?? "§c读取失败")}`);
  lines.push(`  ${kv("Deferred 枚举值", GraphicsMode.Deferred)}`);
  lines.push(`  ${judgement.message}`);
  return judgement.conclusive;
}

/**
 * 第 1 组:四个 getBiome* 入口是否可用。
 *
 * 这一组只测「拿到对象」,不测读写。拿不到说明模块版本或
 * 生物群系 id 有问题,后面的测试就没必要跑。
 */
function probeBiomeAccessors(lines: string[]): void {
  lines.push(heading("1. getBiome* 入口"));
  const accessors: { name: string; fn: () => unknown }[] = [
    { name: "getBiomeAtmospherics", fn: () => getBiomeAtmospherics(PROBE_BIOME) },
    { name: "getBiomeColorGrading", fn: () => getBiomeColorGrading(PROBE_BIOME) },
    { name: "getBiomeLighting", fn: () => getBiomeLighting(PROBE_BIOME) },
    { name: "getBiomeWater", fn: () => getBiomeWater(PROBE_BIOME) },
  ];
  for (const { name, fn } of accessors) {
    const result = callAndRead(name, fn);
    lines.push(`  ${kv(name, result.ok ? "§a可调用" : `§c抛错:${result.error}`)}`);
  }
  lines.push(`  §7探针生物群系:${PROBE_BIOME}`);
}

/**
 * 第 2 组:四个 getPlayer* 入口。
 *
 * 与 getBiome* 的区别是「只对该玩家生效」。这一组顺带验证
 * 文档所说的「Player 版本优先级高于 Biome 版本」是否成立。
 */
function probePlayerAccessors(player: Player, lines: string[]): void {
  lines.push(heading("2. getPlayer* 入口"));
  const accessors: { name: string; fn: () => unknown }[] = [
    { name: "getPlayerAtmospherics", fn: () => getPlayerAtmospherics(PROBE_BIOME, player) },
    { name: "getPlayerColorGrading", fn: () => getPlayerColorGrading(PROBE_BIOME, player) },
    { name: "getPlayerLighting", fn: () => getPlayerLighting(PROBE_BIOME, player) },
    { name: "getPlayerWater", fn: () => getPlayerWater(PROBE_BIOME, player) },
  ];
  for (const { name, fn } of accessors) {
    const result = callAndRead(name, fn);
    lines.push(`  ${kv(name, result.ok ? "§a可调用" : `§c抛错:${result.error}`)}`);
  }
  lines.push("  §7文档称 Player 版本优先级高于 Biome 版本,本组只验证可调用性。");
}

/**
 * 第 3 组:天空色的两种写法。
 *
 * 单色 vs 关键帧表是这个模块最独特的能力。关键帧表能让颜色
 * 随时间连续变化,资源包做不到(只能静态)。
 *
 * 关键观察点:传关键帧表时引擎是否接受。若抛
 * InvalidArgumentError,说明该版本不支持关键帧。
 */
function probeSkyColor(player: Player, lines: string[]): void {
  lines.push(heading("3. 天空色:单色 vs 关键帧"));

  // 3a. 单色
  {
    const atmos = attempt(() => getBiomeAtmospherics(PROBE_BIOME));
    if (!atmos.ok) {
      lines.push(`  ${kv("单色", `§c拿不到对象:${atmos.error}`)}`);
    } else {
      const set = attempt(() => atmos.value.setSkyHorizonColor(SOLID_SKY_COLOR));
      lines.push(`  ${kv("单色 setSkyHorizonColor", describeSetterArgument(SOLID_SKY_COLOR))}`);
      lines.push(`  ${kv("  → 调用结果", set.ok ? "§a成功" : `§c抛错:${set.error}`)}`);
    }
  }

  // 3b. 关键帧表
  {
    const atmos = attempt(() => getBiomeAtmospherics(PROBE_BIOME));
    if (atmos.ok) {
      const set = attempt(() => atmos.value.setSkyHorizonColor(SKY_KEYFRAME_COLORS));
      lines.push(`  ${kv("关键帧 setSkyHorizonColor", describeSetterArgument(SKY_KEYFRAME_COLORS))}`);
      lines.push(`  ${kv("  → 调用结果", set.ok ? "§a成功(该版本支持关键帧)" : `§c抛错:${set.error}`)}`);
      // 逐时间点列出,便于对照画面
      for (const { time, color } of sortedKeyframes(SKY_KEYFRAME_COLORS)) {
        lines.push(`      §7${describeTimeOfDay(time)} → rgb(${color.red}, ${color.green}, ${color.blue})`);
      }
      lines.push("  §7若画面天空颜色随时间变化,说明关键帧生效;若恒为一种色,说明被当成单值处理。");
    }
  }

  // 3c. reset 退回什么
  {
    const atmos = attempt(() => getBiomeAtmospherics(PROBE_BIOME));
    if (atmos.ok) {
      const reset = attempt(() => atmos.value.resetSkyHorizonColor());
      lines.push(`  ${kv("resetSkyHorizonColor", reset.ok ? "§a成功" : `§c抛错:${reset.error}`)}`);
      lines.push("  §7reset 退回的是资源包/行为包设定的值,不是硬编码默认值。");
      lines.push("  §7因此「reset 后颜色等于原版」只在没有资源包覆盖天空色时成立。");
    }
  }
  void player;
}

/**
 * 第 4 组:set / reset 成对行为,四个类各取一个代表方法。
 *
 * 为什么只取代表:112 个方法逐个测会刷屏,而且同类方法的
 * 行为高度一致。取代表能回答「这一组能用吗」,细节留给人查文档。
 */
function probeSetResetPairs(lines: string[]): void {
  lines.push(heading("4. set / reset 配对"));
  const pairs: { group: string; set: () => void; reset: () => void }[] = [];

  const atmos = attempt(() => getBiomeAtmospherics(PROBE_BIOME));
  if (atmos.ok) {
    pairs.push({
      group: "Atmospherics.setRayleighStrength",
      set: () => atmos.value.setRayleighStrength(2),
      reset: () => atmos.value.resetRayleighStrength(),
    });
  }

  const grading = attempt(() => getBiomeColorGrading(PROBE_BIOME));
  if (grading.ok) {
    pairs.push({
      group: "ColorGrading.setTemperature",
      set: () => grading.value.setTemperature(0.8),
      reset: () => grading.value.resetTemperature(),
    });
  }

  const lighting = attempt(() => getBiomeLighting(PROBE_BIOME));
  if (lighting.ok) {
    pairs.push({
      group: "Lighting.setSkyIntensity",
      set: () => lighting.value.setSkyIntensity(1.5),
      reset: () => lighting.value.resetSkyIntensity(),
    });
  }

  const water = attempt(() => getBiomeWater(PROBE_BIOME));
  if (water.ok) {
    pairs.push({
      group: "Water.setChlorophyll",
      set: () => water.value.setChlorophyll(5),
      reset: () => water.value.resetChlorophyll(),
    });
  }

  for (const { group, set, reset } of pairs) {
    const outcome: SetResetOutcome = {
      setOk: attempt(set).ok,
      resetOk: attempt(reset).ok,
    };
    lines.push(`  ${kv(group, describeSetReset(outcome))}`);
  }
  if (pairs.length === 0) {
    lines.push("  §c四组对象都拿不到,无法测试 set/reset");
  }
}

/**
 * 第 5 组:参数范围是否夹取。
 *
 * 类型定义里给了明确范围(如 blendMax 是 [0,1]),但**没说越界会
 * 抛错还是夹取**。这个差异对调用方影响很大:抛错要自己防,
 * 夹取则静默改变意图。所以故意传越界值实测。
 */
function probeRangeClamping(lines: string[]): void {
  lines.push(heading("5. 参数越界行为"));
  const atmos = attempt(() => getBiomeAtmospherics(PROBE_BIOME));
  if (!atmos.ok) {
    lines.push(`  §c拿不到 Atmospherics:${atmos.error}`);
    return;
  }

  const cases: { label: string; value: number }[] = [
    { label: "范围内 0.5", value: 0.5 },
    { label: "越上界 5", value: 5 },
    { label: "越下界 -5", value: -5 },
  ];
  for (const { label, value } of cases) {
    const result = attempt(() => atmos.value.setHorizonBlendMax(value));
    lines.push(`  ${kv(`setHorizonBlendMax ${label}`, result.ok ? "§a接受(可能夹取)" : `§c抛错:${result.error}`)}`);
  }
  lines.push("  §7全部「接受」说明引擎静默夹取;越界抛错说明要调用方自己防。");
  attempt(() => atmos.value.resetHorizonBlendMax());
}

/**
 * 第 6 组:逐玩家覆盖是否真的只影响自己。
 *
 * 这一组无法用读数证明(没有 getter),只能靠观察。所以回执
 * 写明「该看到什么」,由玩家判定。
 */
function probePlayerOverride(player: Player, lines: string[]): void {
  lines.push(heading("6. 逐玩家覆盖(需肉眼判定)"));
  const personal = attempt(() => getPlayerAtmospherics(PROBE_BIOME, player));
  if (!personal.ok) {
    lines.push(`  ${kv("getPlayerAtmospherics", `§c抛错:${personal.error}`)}`);
    return;
  }

  const set = attempt(() => personal.value.setSkyHorizonColor({ red: 0, green: 1, blue: 0 }));
  lines.push(`  ${kv("对本人设绿色天空", set.ok ? "§a调用成功" : `§c抛错:${set.error}`)}`);
  lines.push("  §7§l该看到什么§r§7:只有你的屏幕天空变绿。");
  lines.push("  §7若有第二个玩家在场且他的天空也变绿,说明 Player 版本没生效、退化成了 Biome 版本。");
  lines.push("  §7恢复:再执行一次 /apitest:graphics reset");
}

/** 清掉本探针改过的全部参数,恢复到资源包设定值 */
export function resetGraphicsProbe(): string[] {
  const lines: string[] = [heading("graphics 探针复位")];
  const jobs: { name: string; fn: () => void }[] = [];

  const atmos = attempt(() => getBiomeAtmospherics(PROBE_BIOME));
  if (atmos.ok) {
    jobs.push(
      { name: "resetSkyHorizonColor", fn: () => atmos.value.resetSkyHorizonColor() },
      { name: "resetSkyZenithColor", fn: () => atmos.value.resetSkyZenithColor() },
      { name: "resetRayleighStrength", fn: () => atmos.value.resetRayleighStrength() },
      { name: "resetHorizonBlendMax", fn: () => atmos.value.resetHorizonBlendMax() }
    );
  }
  const grading = attempt(() => getBiomeColorGrading(PROBE_BIOME));
  if (grading.ok) {
    jobs.push({ name: "resetTemperature", fn: () => grading.value.resetTemperature() });
  }
  const lighting = attempt(() => getBiomeLighting(PROBE_BIOME));
  if (lighting.ok) {
    jobs.push({ name: "resetSkyIntensity", fn: () => lighting.value.resetSkyIntensity() });
  }
  const water = attempt(() => getBiomeWater(PROBE_BIOME));
  if (water.ok) {
    jobs.push({ name: "resetChlorophyll", fn: () => water.value.resetChlorophyll() });
  }

  let failed = 0;
  for (const { name, fn } of jobs) {
    const result = attempt(fn);
    if (!result.ok) failed += 1;
    lines.push(`  ${kv(name, result.ok ? "§a已复位" : `§c抛错:${result.error}`)}`);
  }
  lines.push(verdict(failed === 0 ? `全部 ${jobs.length} 项已复位` : `${failed} 项复位失败`));
  return lines;
}

/**
 * graphics 探针主入口。
 *
 * 必须在安全上下文调用(该模块全部方法都是 `no-restricted-execution`)。
 */
export function runGraphicsProbeCommand(player: Player): void {
  const lines: string[] = [heading("server-graphics 能力探针")];

  const conclusive = probePrecondition(player, lines);
  probeBiomeAccessors(lines);
  probePlayerAccessors(player, lines);
  probeSkyColor(player, lines);
  probeSetResetPairs(lines);
  probeRangeClamping(lines);
  probePlayerOverride(player, lines);

  lines.push(heading("结论"));
  if (conclusive) {
    lines.push(verdict("图形模式正确,以上读数可对照画面验证"));
  } else {
    lines.push(warning("图形模式不是 Deferred,读数只证明调用成功、不证明渲染生效"));
  }
  lines.push("  §7复位请执行 §e/apitest:graphics reset§7。");
  report(player, lines);
}

/** graphics 复位命令 */
export function runGraphicsResetCommand(player: Player): void {
  report(player, resetGraphicsProbe());
}

/** 供测试引用的重导出 */
export { describeTimeOfDay, describeSetterArgument, vibrantVisualsVerdict };

/** 世界维度数量,用于给探针一个「世界确实活着」的旁证 */
export function worldSummary(): string {
  const dimensions = attempt(() => world.getDimension("overworld").id);
  return dimensions.ok ? `overworld=${dimensions.value}` : `读取失败:${dimensions.error}`;
}

/** 把一个可能抛错的调用转成一行文本(供命令层复用) */
export function graphicsErrorText(error: unknown): string {
  return errorText(error);
}

/** 让 `system` 的引用不被 tree-shake(命令层需要它来推迟) */
export const graphicsSystem = system;

/** 供外部断言使用的格式函数 */
export { formatValue };
