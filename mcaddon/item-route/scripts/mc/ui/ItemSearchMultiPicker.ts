// ─── 物品搜索多选器：黑白名单（仓库级/容器级）共用的多选编辑 UI ──
// 表单 1：顶部 [输入框搜索（中文名 / id 模糊）] + 已添加物品逐个**开关**展示（开=保留，关=移除）。
// 交互规则（提交后）：
//   · 输入框为空 → 直接提交当前开关状态（保留勾选项，移除取消项）——无新搜索。
//   · 输入框有字  → 搜索后弹出新模态，搜索结果逐个开关多选（勾选=新增），提交后并入保留项。
//     - 若搜索无结果 → 不发新窗，直接提交当前状态（提示"未找到"）。
// 回调：setItems(提交后的完整名单) 由调用方落盘（仓库 updateSettings / 容器 + containerRegistryChanged）。
import { type Player } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit";
import { searchItems, getChineseName } from "../../core/data/ItemNameMap";
import type { CommandDeps } from "../commands/deps";
import * as uiColor from "./uiColor";

/** 多选器选项：读写当前名单 + 变化回调（持久化由调用方） */
export interface ItemMultiPickerOptions {
  title: string;
  hint: string;
  getItems: () => string[];
  setItems: (next: string[]) => void;
  /** 提交后通知（落盘外可选的聊天/刷新回调） */
  onCommit?: (kept: number, added: number) => void;
}

/**
 * 物品搜索多选器：编辑黑白名单。返回 promise（内部多表单流程）。
 */
export async function showItemSearchMultiPicker(
  player: Player,
  deps: CommandDeps,
  opts: ItemMultiPickerOptions
): Promise<void> {
  const currentItems = opts.getItems();

  // ── 表单 1：搜索框 + 已添加项开关 ──
  const form1 = new ModalFormBuilder()
    .title(`${uiColor.form.title}${opts.title}`)
    .label("info", `${uiColor.form.muted}${opts.hint}\n${uiColor.form.muted}已添加 ${uiColor.form.body}${currentItems.length} 项`)
    .textField("search", `${uiColor.form.body}搜索（中文 / id）`, {
      tooltip: "输入后提交会弹出搜索结果供勾选添加；留空则直接提交下方开关状态",
    });
  for (let i = 0; i < currentItems.length; i++) {
    const id = currentItems[i]!;
    form1.toggle(`cur_${i}`, `${getChineseName(id)} ${uiColor.form.muted}${id}`, {
      defaultValue: true,
      tooltip: "开 = 保留，关 = 移除该物品",
    });
  }
  const v1 = await form1.show(player);
  if (!v1) return; // 取消

  // 保留项 = 勾选的已添加项（未勾选 = 移除）
  const kept: string[] = currentItems.filter((_, i) => v1[`cur_${i}`] === true);

  const q = (v1.search as string ?? "").trim();
  // 无搜索词：直接提交当前开关状态
  if (!q) {
    opts.setItems(kept);
    opts.onCommit?.(kept.length, 0);
    return;
  }

  // 有搜索词：全量匹配（去重已保留项），**搜到即全部展示，不截断**
  const matches = searchItems(q).filter((id) => !kept.includes(id));
  if (matches.length === 0) {
    // 无搜索结果：不弹新窗，直接提交当前状态
    opts.setItems(kept);
    player.sendMessage(`${uiColor.chat.muted}未搜索到"${q}"，已提交当前保留项`);
    return;
  }

  // ── 表单 2：搜索结果多选新增（全部展示，无超限折叠） ──
  const form2 = new ModalFormBuilder()
    .title(`${uiColor.form.title}搜索结果 · “${q}”`)
    .label("info", `${uiColor.form.muted}勾选需新增到名单的物品（${matches.length} 条）`);
  for (let i = 0; i < matches.length; i++) {
    const id = matches[i]!;
    form2.toggle(`sel_${i}`, `${getChineseName(id)} ${uiColor.form.muted}${id}`, {
      defaultValue: false,
      tooltip: "勾选 = 加入名单",
    });
  }
  const v2 = await form2.show(player);
  if (!v2) return; // 取消搜索结果 → 不新增（保留已提交的继续？此处不落盘，用户之前表单已点过提交，无副作用）
  const added: string[] = matches.filter((_, i) => v2[`sel_${i}`] === true);
  opts.setItems([...kept, ...added]);
  opts.onCommit?.(kept.length, added.length);
}