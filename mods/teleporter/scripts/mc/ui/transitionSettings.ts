// ─── 传送转场设置(所有玩家可见)────────────────────────────────
//
// 为什么单独开一个界面:转场默认开启,玩家一传送就会看到运镜。
// 如果开关只藏在「管理设置」里(且仅 OP 可见),普通玩家既不知道
// 有这个功能,也无法在自己不想要时关掉——这是可达性问题,不是小事。
//
// 因此这里给所有玩家一个入口:
//   · 管理员:完整配置(开关、风格、按维度的高度与时长、音量)
//   · 普通玩家:只有开关与风格两项(个人偏好性质),写入的是同一份
//     世界配置,因为本模组没有「按玩家」的配置存储,也不值得为它
//     引入一套。文案里说明这一点,避免误解。

import type { Player } from "@minecraft/server";
import { ModalFormBuilder, notifySuccess } from "@mc-toolchain/mod-common";
import {
  TRANSITION_DIMENSIONS,
  type TransitionDimension,
} from "../../core/types";
import {
  MAX_ZOOM_HEIGHT,
  MAX_ZOOM_TICKS,
  MIN_ZOOM_HEIGHT,
  MIN_ZOOM_TICKS,
  normalizeTransitionStyle,
  normalizeTransitionVolume,
  normalizeZoomHeightTable,
  normalizeZoomTicks,
} from "../../core/config";
import {
  transitionStyleFromIndex,
  transitionStyleToIndex,
} from "../../core/transition";
import { isAdmin } from "../detection";
import { loadConfig, saveConfig } from "../store";
import { showMainMenu } from "./menu";

/** 转场风格下拉框的选项文案。顺序必须与 `TRANSITION_STYLES` 一致。 */
const STYLE_LABELS = ["关闭", "淡入淡出", "电影感"];

/** 维度下拉框的选项文案。顺序必须与 `TRANSITION_DIMENSIONS` 一致。 */
const DIMENSION_LABELS = ["主世界", "下界", "末地"];

/** 音量的滑条步长。 */
const VOLUME_STEP = 0.05;

/** 打开转场设置。 */
export async function showTransitionSettings(player: Player): Promise<void> {
  const config = loadConfig();
  const admin = isAdmin(player);

  const builder = new ModalFormBuilder()
    .title("§l传送转场")
    .toggle("transitionEnabled", "启用传送转场", {
      defaultValue: config.transitionEnabled,
      tooltip: "关闭后所有传送立即完成,不播放任何动画",
    })
    .dropdown("transitionStyle", "转场风格", STYLE_LABELS, {
      defaultValueIndex: transitionStyleToIndex(config.transitionStyle),
    })
    .slider("volume", "转场音效音量", 0, 1, {
      defaultValue: config.transitionVolume,
      valueStep: VOLUME_STEP,
    });

  if (admin) {
    builder
      .divider()
      .header("§l变焦参数(管理员)")
      .dropdown("zoomDimension", "调整哪一套变焦高度", DIMENSION_LABELS, {
        defaultValueIndex: 0,
      })
      .slider(
        "zoomHeight1",
        "第一段高度(格)",
        MIN_ZOOM_HEIGHT,
        MAX_ZOOM_HEIGHT,
        {
          defaultValue: config.transitionZoomHeights.overworld[0],
          valueStep: 1,
        },
      )
      .slider(
        "zoomHeight2",
        "第二段高度(格)",
        MIN_ZOOM_HEIGHT,
        MAX_ZOOM_HEIGHT,
        {
          defaultValue: config.transitionZoomHeights.overworld[1],
          valueStep: 1,
        },
      )
      .slider(
        "zoomHeight3",
        "第三段高度(格)",
        MIN_ZOOM_HEIGHT,
        MAX_ZOOM_HEIGHT,
        {
          defaultValue: config.transitionZoomHeights.overworld[2],
          valueStep: 1,
        },
      )
      .slider(
        "zoomTicks1",
        "第一段时长(tick)",
        MIN_ZOOM_TICKS,
        MAX_ZOOM_TICKS,
        {
          defaultValue: config.transitionZoomTicks[0],
          valueStep: 1,
        },
      )
      .slider(
        "zoomTicks2",
        "第二段时长(tick)",
        MIN_ZOOM_TICKS,
        MAX_ZOOM_TICKS,
        {
          defaultValue: config.transitionZoomTicks[1],
          valueStep: 1,
        },
      )
      .slider(
        "zoomTicks3",
        "第三段时长(tick)",
        MIN_ZOOM_TICKS,
        MAX_ZOOM_TICKS,
        {
          defaultValue: config.transitionZoomTicks[2],
          valueStep: 1,
        },
      );
  } else {
    builder.label("_note", "§7变焦高度与时长由管理员调整");
  }

  const values = await builder.show(player);
  if (!values) return;

  const transitionEnabled = values.transitionEnabled === true;
  config.transitionEnabled = transitionEnabled;
  // 总开关关闭时收敛为 off,避免两个真值来源
  config.transitionStyle = transitionEnabled
    ? normalizeTransitionStyle(transitionStyleFromIndex(values.transitionStyle))
    : "off";
  config.transitionVolume = normalizeTransitionVolume(values.volume);

  if (admin) {
    const dimension = TRANSITION_DIMENSIONS[
      toIndex(values.zoomDimension, TRANSITION_DIMENSIONS.length)
    ] as TransitionDimension;
    config.transitionZoomHeights = normalizeZoomHeightTable({
      ...config.transitionZoomHeights,
      [dimension]: [
        toNumber(values.zoomHeight1),
        toNumber(values.zoomHeight2),
        toNumber(values.zoomHeight3),
      ],
    });
    config.transitionZoomTicks = normalizeZoomTicks([
      toNumber(values.zoomTicks1),
      toNumber(values.zoomTicks2),
      toNumber(values.zoomTicks3),
    ]);
  }

  saveConfig(config);
  notifySuccess(player, "转场设置已保存");
  await showMainMenu(player);
}

/** 把表单取值当数字读出来;类型不对时返回 NaN 交给归一化兜底。 */
function toNumber(value: unknown): number {
  return typeof value === "number" ? value : NaN;
}

/** 把下拉框下标收敛到合法范围。 */
function toIndex(value: unknown, length: number): number {
  if (typeof value !== "number" || !isFinite(value)) return 0;
  const index = Math.floor(value);
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}
