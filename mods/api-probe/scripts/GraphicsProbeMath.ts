// ─── server-graphics 探针的纯函数层 ───────────────────────────────
//
// `@minecraft/server-graphics` 与 `debug-utilities` 有一个根本区别:
// 它的全部 112 个方法都标注了 `@privilege no-restricted-execution`,
// 因此**只能在安全上下文调用** —— 这一点没有模糊地带,不像
// debug-utilities 那样「没有标注但仍要推迟」。
//
// 另一个区别更要紧:它改的是**渲染管线参数**,文档里 45 处提到
// Vibrant Visuals(鲜艳视觉)。这是基岩版的延迟渲染特性,需要玩家
// 在图形设置里开启。未开启时:
//   · setter 很可能不抛错;
//   · 读回值照样是设进去的那个数;
//   · 但画面**完全不变**。
//
// 也就是说,这个模块是「写入成功 ≠ 渲染生效」最极端的例子 ——
// 连引擎都可能不知道参数没起作用。所以探针的第一件事必须是
// 报告 Vibrant Visuals 的状态,否则后面所有读数都是误导。
//
// 本文件保持纯函数(不 import `@minecraft/*` 运行时代码),以便
// `node --test` 直接跑。

/** 一天中的时间点 → 关键帧键名。数值取自 index.d.ts 的 doc block */
export const TIME_OF_DAY = {
  /** 0.0 与 1.0 都是正午 */
  noon: 0,
  sunset: 0.25,
  midnight: 0.5,
  sunrise: 0.75,
} as const;

/** 时间点键名的中文说明,用于回执 */
export const TIME_OF_DAY_LABELS: Readonly<Record<keyof typeof TIME_OF_DAY, string>> = {
  noon: "正午(0.0 / 1.0)",
  sunset: "日落(0.25)",
  midnight: "午夜(0.5)",
  sunrise: "日出(0.75)",
};

/**
 * 一个颜色关键帧表:键是时间点(0~1),值是颜色。
 *
 * 这是 `server-graphics` 最独特的设计 —— `setSkyHorizonColor` 等方法
 * 既可以收单个颜色(全时段同色),也可以收一张关键帧表(随时间插值)。
 * 后者是唯一能让颜色连续变化的 API:资源包只能给静态值,
 * `@minecraft/server` 完全没有这个能力。
 */
export type ColorKeyframes = Record<number, { red: number; green: number; blue: number }>;

/** 一组用于探针的对比色:正午亮蓝、日落橙、午夜深蓝、日出粉 */
export const SKY_KEYFRAME_COLORS: Readonly<ColorKeyframes> = {
  [TIME_OF_DAY.noon]: { red: 0.2, green: 0.5, blue: 1 },
  [TIME_OF_DAY.sunset]: { red: 1, green: 0.45, blue: 0.1 },
  [TIME_OF_DAY.midnight]: { red: 0.02, green: 0.03, blue: 0.15 },
  [TIME_OF_DAY.sunrise]: { red: 1, green: 0.6, blue: 0.75 },
};

/** 单色探针用的显眼颜色(与上面的关键帧色明显不同,便于分辨) */
export const SOLID_SKY_COLOR = { red: 1, green: 0, blue: 1 };

/**
 * 把关键帧表按键排序,得到可直接展示的顺序。
 *
 * 对象键在 JS 里对「整数形字符串」会按数值升序枚举,但 0.25 / 0.5
 * 这类非整数键按插入顺序。探针要展示「时间轴」,必须显式排序。
 */
export function sortedKeyframes(keyframes: ColorKeyframes): { time: number; color: ColorKeyframes[number] }[] {
  return Object.keys(keyframes)
    .map(Number)
    .sort((a, b) => a - b)
    .map((time) => ({ time, color: keyframes[time] }));
}

/**
 * 把时间点数值翻译成人类可读的时段名。
 *
 * 只认识四个标准时间点;其它值按「自定义」返回,因为关键帧本身
 * 允许任意 0~1 的键,不能假装只有四个。
 */
export function describeTimeOfDay(time: number): string {
  for (const [name, value] of Object.entries(TIME_OF_DAY)) {
    if (Math.abs(value - time) < 1e-9) {
      return TIME_OF_DAY_LABELS[name as keyof typeof TIME_OF_DAY];
    }
  }
  return `自定义(${time})`;
}

/**
 * 判断一个 setter 参数是单值还是关键帧表。
 *
 * 两者在类型上是联合类型 `T | Record<number, T>`,运行时靠
 * 「是不是对象且键能解析成数字」区分。这个判断在探针里要重复
 * 出现,抽出来避免各写一遍判断错。
 */
export function isKeyframeTable(value: unknown): value is Record<number, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  // 颜色对象本身也是对象,但它的键是 red/green/blue 这类非数字名
  return keys.every((key) => Number.isFinite(Number(key)));
}

/**
 * 描述一个 setter 参数的实际形态,用于回执。
 *
 * 探针的关键职责之一是**证明我们真的传了关键帧表而不是单值** ——
 * 如果引擎把关键帧表当成单值处理,回执里应该能看出来。
 */
export function describeSetterArgument(value: unknown): string {
  if (isKeyframeTable(value)) {
    const count = Object.keys(value).length;
    return `关键帧表(${count} 个时间点)`;
  }
  if (typeof value === "number") return `单值 ${value}`;
  if (typeof value === "object" && value !== null) {
    const record = value as { red?: number; green?: number; blue?: number };
    if (typeof record.red === "number") {
      return `单色 rgb(${record.red}, ${record.green}, ${record.blue})`;
    }
  }
  return String(value);
}

/**
 * Vibrant Visuals 状态对探针结论的影响。
 *
 * 这个函数把「探针测到了什么」和「能不能据此下结论」分开,
 * 因为在这个模块上二者经常不一致:所有 setter 都成功、所有读回
 * 都正确,画面却一动不动。
 */
export interface VibrantVisualsVerdict {
  /** 读数是否可信 */
  conclusive: boolean;
  /** 给玩家看的一句话 */
  message: string;
}

/**
 * 根据玩家的图形模式,给出探针读数的可信度判定。
 *
 * 判定依据是 `Player.graphicsMode` —— 这个属性在 `@minecraft/server`
 * 里就有,不需要 graphics 模块。`GraphicsMode.Deferred` 就是
 * Vibrant Visuals(延迟渲染)模式;`Fancy` / `Simple` 都是传统渲染。
 *
 * 传 `undefined` 表示读取本身失败了(例如玩家已离线),这种情况
 * 必须如实说「不知道」,而不是猜一个。
 */
export function vibrantVisualsVerdict(mode: string | undefined): VibrantVisualsVerdict {
  if (mode === undefined) {
    return {
      conclusive: false,
      message: "§e无法读取图形模式§7(玩家可能已离线)。以下读数仅供参考。",
    };
  }
  if (mode === "Deferred") {
    return {
      conclusive: true,
      message: "§a图形模式为 Deferred(Vibrant Visuals)§7 —— 以下读数可以对照画面验证。",
    };
  }
  return {
    conclusive: false,
    message:
      `§c图形模式为 ${mode},不是 Deferred§7 —— 本模块改的是延迟渲染管线参数,` +
      "非 Deferred 下 setter 可能不报错但画面完全不变。以下读数只证明「调用成功」," +
      "§c不证明「渲染生效」§7。请到 视频设置 里把图形模式改成「鲜艳视觉」再跑一次。",
  };
}

/**
 * 汇总一次 set/reset 配对测试的结果。
 *
 * `set` 与 `reset` 是成对的:reset 退回到**资源包/行为包设定的值**,
 * 而不是硬编码默认值。因此「reset 后读回是否等于初始值」这个判断
 * 只在没有资源包覆盖时成立,探针要如实说明这个前提。
 */
export interface SetResetOutcome {
  setOk: boolean;
  resetOk: boolean;
}

/** 把 set/reset 配对结果翻译成一行结论 */
export function describeSetReset(outcome: SetResetOutcome): string {
  if (outcome.setOk && outcome.resetOk) return "§a两者均成功§7(set 生效,reset 回退)";
  if (outcome.setOk && !outcome.resetOk) return "§eset 成功但 reset 抛错§7 —— 状态可能残留";
  if (!outcome.setOk && outcome.resetOk) return "§eset 抛错但 reset 成功§7 —— 检查参数范围";
  return "§c两者均抛错§7 —— 该组方法在此环境不可用";
}
