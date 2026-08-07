// ─── 物品名单编辑器（items 集合的增删查）：仓库黑名单 / 容器黑白名单复用 ──
// 以分页 ActionForm 展示现有名单（每项中文名·id，点击即移除）+ 头部"添加"（搜索→下拉选型）+ 尾部分页。
// 纯受控：getItems/setItems 提供读与写（黑/白名单在核心/容器上以 string[] 存，此处仅序列化中文展示 + 移除）。
// 单文件、无 MC 副作用（仅 UI + 经外部 setItems 持久化），游戏内冒烟。
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit";
import { searchItems, getChineseName } from "../../core/data/ItemNameMap";
import type { CommandDeps } from "../commands/deps";
import * as uiColor from "./uiColor";

const PAGE = 8;
const SEARCH_LIMIT = 8;

/** 打开名单编辑器；title 例如"容器白名单"、getItems/setItems 读写该名单（setItems 由调用方落盘） */
export async function showItemListEditor(
  player: Player,
  deps: CommandDeps,
  opts: {
    title: string;
    hint: string;
    getItems: () => string[];
    setItems: (next: string[]) => void;
    onChange?: () => void;
  }
): Promise<void> {
  const { getItems, setItems } = opts;
  let page = 0;

  const render = async (): Promise<void> => {
    const items = getItems();
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE));
    if (page >= totalPages) page = totalPages - 1;
    const form = new ActionFormBuilder()
      .title(`${uiColor.form.title}${opts.title}·${items.length} 项`)
      .body(`${uiColor.form.muted}${opts.hint}`);
    // 当前页各项 → 点击移除
    const slice = items.slice(page * PAGE, page * PAGE + PAGE);
    for (const typeId of slice) {
      form.button(`${uiColor.btn.nav}${getChineseName(typeId)} ${uiColor.btn.info}${typeId}`, () => {
        setItems(items.filter((i) => i !== typeId)); // 移除
        void render();
      });
    }
    if (slice.length === 0) form.button(`${uiColor.btn.info}（暂无）`, () => undefined);
    // 分页 + 新增 + 返回
    form.button(`${uiColor.btn.primary}＋ 新增`, () => void addOne());
    if (page > 0) form.button(`${uiColor.btn.info}◀上一页`, () => { page--; void render(); });
    if (page < totalPages - 1) form.button(`${uiColor.btn.info}下一页▶`, () => { page++; void render(); });
    form.button(`${uiColor.btn.nav}返回`, () => undefined);
    await form.show(player);
  };

  const addOne = async (): Promise<void> => {
    const pick = new ModalFormBuilder()
      .title(`${uiColor.form.title}添加物品`)
      .textField("q", `${uiColor.form.body}搜索（中文名 / id）`, { tooltip: "输入后从匹配项中选择" });
    const values = await pick.show(player);
    if (!values) return;
    const q = (values.q as string).trim();
    if (!q) return;
    const matches = searchItems(q)
      .slice(0, SEARCH_LIMIT)
      .filter((id) => !getItems().includes(id));
    if (matches.length === 0) {
      player.sendMessage(`${uiColor.chat.muted}未找到匹配物品（或已在名单中）`);
      void render();
      return;
    }
    const confirm = new ModalFormBuilder()
      .title(`${uiColor.form.title}选择要添加的物品`)
      .dropdown("sel", "匹配结果", matches.map((id) => `${getChineseName(id)}（${id}）`), {
        tooltip: `共 ${matches.length} 条匹配，选其一添加`,
      });
    const v2 = await confirm.show(player);
    if (!v2) return;
    const typeId = matches[v2.sel as number];
    if (typeId === undefined) return;
    setItems([...getItems(), typeId]); // 追加（幂等去重由调用方/此处含盖）
    opts.onChange?.();
    void render();
  };

  void render();
}