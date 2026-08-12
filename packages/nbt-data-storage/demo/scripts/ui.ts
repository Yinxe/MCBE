// ── UI：主菜单 + 批量勾选存取 + 单件存取 ─────────────────────────────
// 全部复用 @yinxe/toolkit 的 ActionFormBuilder / ModalFormBuilder（回调在
// system.run 中执行，可直接触碰世界/容器/DP）。
// - 批量存入：背包全部非空物品**单页全量** ModalForm 开关（背包 ≤36 格，无需分页），
//   勾选后提交即全部存入
// - 批量取出：凭据索引（仅当前区域）**分页**勾选（凭据可达数百条，防 ModalForm 溢出）
// - 单件取出列表 / 按格号取出（凭据取物，跨模组可取）
// 取出列表来自本地凭据索引（storage.list()），不扫描桶阵列（O(1) 纪律）。
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder, notifyError } from "@yinxe/toolkit";
import { colorOf, storage } from "./storageService";
import { showConfigForm } from "./config";

/** 分页勾选表单每页最大条目数（ModalForm 组件数防溢出） */
const PAGE_SIZE = 12;
/** ActionForm 单屏按钮上限保护（列表超长时截断显示并提示） */
const TAKE_LIST_MAX = 20;

/**
 * 主菜单：单件/批量存取、统计、配置入口。
 * 状态区显示：启用状态、区域 ID、已用/容量、桶数（扩容进度）、凭据条数。
 */
export async function showMainMenu(player: Player): Promise<void> {
  const cfg = storage.config;
  const s = storage.stats();
  const status = !cfg.enabled ? "§c停用§r" : storage.ready ? "§a启用§r" : "§e未就绪§r";
  const region = storage.regionId ?? "（未注册）";
  const refs = storage.list();

  await new ActionFormBuilder()
    .title("§lNBT 存储测试")
    .body(
      `状态：${status}｜区域 §e${region}§r\n` +
        `已用 §e${s?.used ?? 0}§r/${s?.capacity ?? 0} 槽｜桶 §e${s?.barrels ?? 0}§r/${s?.totalBarrels ?? 0}｜凭据 ${refs.length} 条`
    )
    .divider()
    .button("§l存入手中物品§r", () => {
      const r = storage.storeHeldItem(player);
      player.sendMessage(`${colorOf(r)}${r.message}`);
    })
    .button("§l批量存入（背包勾选）§r", () => showBatchStore(player))
    .button("§l取出（凭据列表）§r", () => showTakeList(player))
    .button("§l批量取出（勾选）§r", () => showBatchTake(player))
    .button("§l取出（按格子号）§r", () => showTakeBySlot(player))
    .button("§l覆写（手持→格子）§r", () => showOverwriteBySlot(player))
    .button("§l自检修复§r", () => storage.checkAndRepair(player))
    .button("存储统计", () => storage.showStats(player))
    .button("配置", () => showConfigForm(player, { onApply: (cfg) => storage.applyConfig(cfg, true) }))
    .show(player);
}

// ─── 批量取出（分页 ModalForm，凭据条数多时防溢出） ───────────────────

/**
 * 分页勾选表单：每页 PAGE_SIZE 个 toggle，提交即把本页勾选 key 交给 onConfirm，
 * 还有下一页则自动弹出，可随时关闭结束（已处理的页不重复）。
 * 仅批量取出使用（凭据可达数百条）；批量存入走单页全量（见 showBatchStore）。
 */
async function pagedToggleForm(
  player: Player,
  title: string,
  items: { key: string; label: string }[],
  onConfirm: (keys: string[]) => void | Promise<void>
): Promise<void> {
  const totalPages = Math.ceil(items.length / PAGE_SIZE);
  for (let page = 0; page < totalPages; page++) {
    const slice = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const builder = new ModalFormBuilder()
      .title(`§l${title}`)
      .label("_hint", `§7第 ${page + 1}/${totalPages} 页（共 ${items.length} 项），勾选后提交即处理本页`)
      .divider();
    for (const it of slice) {
      builder.toggle(it.key, it.label);
    }
    builder.divider();
    builder.submitButton(page + 1 < totalPages ? `确认本页（还有第 ${page + 2} 页）` : "确认");
    const vals = await builder.show(player);
    if (!vals) return; // 关闭即结束
    const picked = slice.filter((it) => vals[it.key] === true).map((it) => it.key);
    if (picked.length > 0) await onConfirm(picked);
  }
}

/** 批量存入：背包全部非空物品**单页全量** ModalForm 开关（背包 ≤36 格，无需分页），勾选后提交即批量存入 */
export async function showBatchStore(player: Player): Promise<void> {
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) {
    notifyError(player, "无法读取背包容器");
    return;
  }
  const items: { key: string; label: string }[] = [];
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (!item) continue;
    items.push({ key: String(i), label: `槽 ${i}：§f${item.typeId}§r ×${item.amount}` });
  }
  if (items.length === 0) {
    notifyError(player, "背包没有可存入的物品");
    return;
  }
  const builder = new ModalFormBuilder()
    .title("§l批量存入 · 背包勾选")
    .label("_hint", `§7共 ${items.length} 件物品，已默认全选，勾选后提交即全部存入（不分页）`)
    .divider();
  for (const it of items) {
    builder.toggle(it.key, it.label, { defaultValue: true }); // 默认全选：一键提交全存
  }
  builder.divider().submitButton("存入勾选的物品");
  const vals = await builder.show(player);
  if (!vals) return;
  const picked = items.filter((it) => vals[it.key] === true).map((it) => it.key);
  if (picked.length === 0) {
    notifyError(player, "未勾选任何物品");
    return;
  }
  const r = storage.storeItems(player, picked.map(Number));
  player.sendMessage(`${colorOf(r)}${r.message}`);
}

/** 批量取出：当前区域凭据分页勾选，勾选后批量取出到背包 */
export async function showBatchTake(player: Player): Promise<void> {
  const refs = storage.list();
  if (refs.length === 0) {
    notifyError(player, "当前区域尚无凭据记录：先存入物品（/nds-demo:store 或批量存入）");
    return;
  }
  const items = refs.map((r) => ({
    key: String(r.slotId),
    label: `#${r.slotId}：§f${r.typeId}§r ×${r.amount}`,
  }));
  await pagedToggleForm(player, "批量取出 · 勾选", items, (keys) => {
    const r = storage.takeItems(player, keys.map(Number));
    player.sendMessage(`${colorOf(r)}${r.message}`);
  });
}

/**
 * 取出列表（ActionForm）：凭据索引逐条列出，点击即取出到背包。
 * 超长截断显示前 TAKE_LIST_MAX 条；其余用"按格子号取出"。
 */
export async function showTakeList(player: Player): Promise<void> {
  const refs = storage.list();
  if (refs.length === 0) {
    notifyError(player, "当前区域尚无凭据记录：先存入物品（/nds-demo:store 或菜单存入）再取出");
    return;
  }

  const shown = refs.slice(0, TAKE_LIST_MAX);
  const builder = new ActionFormBuilder()
    .title("§l取出 · 凭据列表")
    .body(`§7共 ${refs.length} 条，显示前 ${shown.length} 条；点击即取出到背包§r`);
  for (const r of shown) {
    builder.button(`#${r.slotId} §f${r.typeId}§r ×${r.amount}`, () => {
      const res = storage.takeToPlayer(player, r.slotId);
      player.sendMessage(`${colorOf(res)}${res.message}`);
    });
  }
  if (refs.length > shown.length) {
    builder.button("§7其余用「按格子号取出」§r", () => showTakeBySlot(player));
  }
  builder.button("§7返回主菜单§r", () => showMainMenu(player));
  await builder.show(player);
}

/** 按格子号取出（ModalForm 文本输入）：凭据取物，跨模组存入的物品同样可取。 */
export async function showTakeBySlot(player: Player): Promise<void> {
  const vals = await new ModalFormBuilder()
    .title("§l取出 · 按格子号")
    .textFieldWithPlaceholder("slotId", "格子号（slotId）", "取物凭据的格号，如 3")
    .divider()
    .submitButton("取出")
    .show(player);
  if (!vals) return;

  const slotId = Number(vals.slotId);
  if (!Number.isInteger(slotId) || slotId < 0) {
    notifyError(player, "格子号必须是非负整数");
    return;
  }
  const res = storage.takeToPlayer(player, slotId);
  player.sendMessage(`${colorOf(res)}${res.message}`);
}

/** 原位覆写（ModalForm 文本输入）：手持物品覆写到指定格子，旧物品进背包/存回。 */
export async function showOverwriteBySlot(player: Player): Promise<void> {
  const vals = await new ModalFormBuilder()
    .title("§l覆写 · 手持物品 → 格子")
    .label("_hint", "§7把手中物品覆写到指定格子（slotId 不变），旧物品返回背包或存回存储")
    .textFieldWithPlaceholder("slotId", "格子号（slotId）", "已有物品的格号，如 3")
    .divider()
    .submitButton("覆写")
    .show(player);
  if (!vals) return;

  const slotId = Number(vals.slotId);
  if (!Number.isInteger(slotId) || slotId < 0) {
    notifyError(player, "格子号必须是非负整数");
    return;
  }
  const res = storage.overwriteToSlot(player, slotId);
  player.sendMessage(`${colorOf(res)}${res.message}`);
}
