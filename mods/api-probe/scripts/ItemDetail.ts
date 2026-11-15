// ─── 物品详情:把 ItemStack 摊成可读文本 ─────────────────────────
//
// `@minecraft/server` 2.1.0 没有公开的 NBT 读写接口(`getNbt` /
// `saveToNbt` 在后续版本才出现,且本模组刻意不追 beta)。因此这里的
// 「NBT 序列化文本」是由公开只读接口拼出的结构化快照:
// 组件列表、附魔、耐久、锁模式、标签、lore、可破坏/可放置列表、
// 动态属性、自定义名 —— 也就是玩家实际能观测到的全部物品状态。
//
// 每一项都单独 try/catch:单个字段读失败只降级该项,不影响其余字段,
// 也不影响其它槽位的查看。

import { type ItemStack } from "@minecraft/server";
import { errorText } from "./ContainerReader";

/** 详情文本的分段:标题行 + 若干「字段: 值」 */
export interface ItemDetail {
  /** 物品标识 */
  typeId: string;
  /** 堆叠数量 */
  amount: number;
  /** 逐项展开的字段,顺序稳定便于对照 */
  fields: { label: string; value: string }[];
  /** 序列化过程中失败的字段名;为空表示全部成功 */
  failedFields: string[];
}

/** 安全地取一个字段:读失败时返回失败标记而不是抛出 */
function readField<T>(reader: () => T): { ok: true; value: T } | { ok: false; reason: string } {
  try {
    return { ok: true, value: reader() };
  } catch (error) {
    return { ok: false, reason: errorText(error) };
  }
}

/** 把附魔列表拼成 `sharpness 5、unbreaking 3` 形式 */
function formatEnchantments(item: ItemStack): string | undefined {
  if (!item.hasComponent("minecraft:enchantable")) return undefined;
  const component = item.getComponent("minecraft:enchantable");
  if (!component) return undefined;
  const enchantments = component.getEnchantments();
  if (enchantments.length === 0) return undefined;
  return enchantments.map((enchantment) => `${enchantment.type.id} ${enchantment.level}`).join("、");
}

/** 把耐久拼成 `120 / 1561` 形式 */
function formatDurability(item: ItemStack): string | undefined {
  if (!item.hasComponent("minecraft:durability")) return undefined;
  const component = item.getComponent("minecraft:durability");
  if (!component) return undefined;
  return `${component.maxDurability - component.damage} / ${component.maxDurability}(已损 ${component.damage})`;
}

/**
 * 生成某槽位物品的详情。
 *
 * 只读:全部调用都是查询接口,不写回物品。
 */
export function describeItem(item: ItemStack, slot: number): ItemDetail {
  const fields: { label: string; value: string }[] = [];
  const failedFields: string[] = [];

  const push = (label: string, reader: () => string | undefined) => {
    const result = readField(reader);
    if (!result.ok) {
      failedFields.push(label);
      fields.push({ label, value: `读取失败(${result.reason})` });
      return;
    }
    if (result.value === undefined) return;
    fields.push({ label, value: result.value });
  };

  fields.push({ label: "槽位", value: String(slot) });
  fields.push({ label: "标识", value: item.typeId });
  fields.push({ label: "数量", value: String(item.amount) });

  push("自定义名", () => item.nameTag);
  push("附魔", () => formatEnchantments(item));
  push("耐久", () => formatDurability(item));
  push("锁模式", () => (item.lockMode === "none" ? undefined : item.lockMode));
  push("死亡保留", () => (item.keepOnDeath ? "是" : undefined));
  push("最大堆叠", () => {
    // maxAmount 声明为 number,但实际运行时不保证有值。先判空再转字符串:
    // 直接 String(item.maxAmount) 会把 undefined 变成字符串 "undefined",
    // 绕过 push 的「undefined 即跳过」逻辑,在表单里显示成字面的 undefined。
    const max = item.maxAmount;
    return max === undefined || max === null ? undefined : String(max);
  });
  push("标签", () => {
    const tags = item.getTags();
    return tags.length === 0 ? undefined : tags.join("、");
  });
  push("Lore", () => {
    const lore = item.getLore();
    return lore.length === 0 ? undefined : lore.join(" / ");
  });
  push("可破坏方块", () => {
    const list = item.getCanDestroy();
    return list.length === 0 ? undefined : list.join("、");
  });
  push("可放置于", () => {
    const list = item.getCanPlaceOn();
    return list.length === 0 ? undefined : list.join("、");
  });
  push("动态属性", () => {
    const ids = item.getDynamicPropertyIds();
    if (ids.length === 0) return undefined;
    return ids
      .map((id) => {
        const value = item.getDynamicProperty(id);
        return `${id}=${JSON.stringify(value)}`;
      })
      .join("、");
  });
  push("组件", () => {
    const components = item.getComponents();
    if (components.length === 0) return undefined;
    return components.map((component) => component.typeId).join("、");
  });

  return { typeId: item.typeId, amount: item.amount, fields, failedFields };
}

/** 详情文本是否只有基础三项(槽位/标识/数量),即没有任何附加数据 */
export function hasNoExtraData(detail: ItemDetail): boolean {
  return detail.fields.length <= 3 && detail.failedFields.length === 0;
}
