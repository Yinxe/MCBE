// ─── 容器表单:概览 → 槽位详情,两层 ──────────────────────────────
//
// 概览页把容器自报的统计与逐槽遍历的结果并列展示,这是探针的核心用途:
// 两个数字不一致时,开发者能立刻看到 API 的真实行为。
//
// 每个非空槽位一个按钮,回调直接绑定该槽位 —— 调用方不需要自己维护
// 「按钮下标 → 槽位下标」的映射。详情页是纯只读展示,用双按钮对话框,
// 关闭即返回,不再往下开第三层。

import { type Dimension, type Player, type Vector3 } from "@minecraft/server";
import { ActionFormBuilder, MessageFormBuilder } from "@mc-toolchain/mod-common";
import { formatLocation, readBlockContainer } from "./ContainerReader";
import type { ContainerSnapshot } from "./ContainerSnapshot";
import { describeItem } from "./ItemDetail";

/** 概览页正文:坐标、方块、三处统计(导出以便脱离游戏核对文本) */
export function buildOverviewBody(location: Vector3, blockTypeId: string, snapshot: ContainerSnapshot): string {
  const lines = [
    `坐标:${formatLocation(location)}`,
    `方块:${blockTypeId}`,
    "",
    `总槽位:${snapshot.size}`,
    `空槽(API emptySlotsCount):${snapshot.emptySlotsCount}`,
    `非空槽(遍历统计):${snapshot.countedNonEmpty}`,
  ];

  // 两个数字对不上时直接把差异写出来 —— 这正是探针要暴露的东西
  const derivedEmpty = snapshot.size - snapshot.countedNonEmpty;
  if (derivedEmpty !== snapshot.emptySlotsCount) {
    lines.push(`§e注意:emptySlotsCount(${snapshot.emptySlotsCount})与「总槽位-非空槽」(${derivedEmpty})不一致`);
  }
  if (snapshot.slotErrors.length > 0) {
    lines.push(`§c${snapshot.slotErrors.length} 个槽位读取失败:${snapshot.slotErrors.map((e) => e.slot).join("、")}`);
  }

  if (snapshot.nonEmptySlots.length === 0) {
    lines.push("", "没有非空槽位");
  } else {
    lines.push("", "点条目查看该槽位的物品详情");
  }

  return lines.join("\n");
}

/**
 * 打开容器概览表单。
 *
 * @param dimension 目标方块所在维度,详情页据此重新读取物品
 * @param location 目标方块坐标(已取整)
 * @param snapshot 已经取好的容器快照
 * @returns true = 玩家点了某个条目,false = 取消/关闭/显示失败
 */
export async function showContainerOverview(
  player: Player,
  dimension: Dimension,
  location: Vector3,
  blockTypeId: string,
  snapshot: ContainerSnapshot
): Promise<boolean> {
  const builder = new ActionFormBuilder()
    .title(`§l§6容器探针 §7${formatLocation(location)}`)
    .body(buildOverviewBody(location, blockTypeId, snapshot));

  for (const entry of snapshot.nonEmptySlots) {
    // 回调签名是 `() => void | Promise<void>`,而 showSlotDetail 返回 boolean,
    // 因此显式包一层丢弃返回值。
    builder.button(`槽位 ${entry.slot} · ${entry.typeId} · ×${entry.amount}`, async () => {
      await showSlotDetail(player, dimension, location, entry.slot, entry.typeId, entry.amount);
    });
  }

  return builder.show(player);
}

/** 详情页正文:逐字段「标签: 值」(导出以便脱离游戏核对文本) */
export function buildDetailBody(slot: number, detail: ReturnType<typeof describeItem>): string {
  const lines = [`§l槽位 ${slot}`, "", `标识:${detail.typeId}`, `数量:${detail.amount}`, ""];

  // 基础三项(槽位/标识/数量)已在上方单列,这里只补充其余字段
  const extras = detail.fields.filter((field) => !["槽位", "标识", "数量"].includes(field.label));
  if (extras.length === 0) {
    lines.push("§7无额外数据");
    return lines.join("\n");
  }

  for (const field of extras) {
    lines.push(`§7${field.label}§r:${field.value}`);
  }
  if (detail.failedFields.length > 0) {
    lines.push("", `§c无法序列化:${detail.failedFields.join("、")}`);
  }
  return lines.join("\n");
}

/**
 * 打开单个槽位的详情表单。
 *
 * 物品在点击时重新读一次目标容器:概览页到点击之间容器可能已经变化,
 * 重新读保证展示的是当前值;读不到时给出提示而不是抛出。
 */
export async function showSlotDetail(
  player: Player,
  dimension: Dimension,
  location: Vector3,
  slot: number,
  typeId: string,
  amount: number
): Promise<boolean> {
  const reread = readBlockContainer(dimension, location);
  // 容器可能在概览页与点击之间失效,getItem 本身也可能抛错;两者都降级为
  // 「读不到」分支,不向外抛。
  let item;
  if (reread.ok) {
    try {
      item = reread.container.getItem(slot);
    } catch {
      item = undefined;
    }
  }

  // 容器已失效或该槽位已被清空:用概览页记录的标识与数量兜底展示,
  // 并明确说明实时读取失败,不假装数据是最新的。
  if (!item) {
    return new MessageFormBuilder()
      .title(`§l§6槽位 ${slot}`)
      .body(
        [
          `§7标识§r:${typeId}`,
          `§7数量§r:${amount}`,
          "",
          reread.ok ? "§c该槽位当前已读取不到物品(容器内容可能已变化)" : `§c无法重新读取容器:${reread.reason}`,
          "",
          "§7(此页只读,关闭即可)",
        ].join("\n")
      )
      .confirmButton("§a返回")
      .cancelButton("§7关闭")
      .show(player);
  }

  const detail = describeItem(item, slot);
  return new MessageFormBuilder()
    .title(`§l§6槽位 ${slot} · ${detail.typeId}`)
    .body(buildDetailBody(slot, detail))
    .confirmButton("§a返回")
    .cancelButton("§7关闭")
    .show(player);
}
