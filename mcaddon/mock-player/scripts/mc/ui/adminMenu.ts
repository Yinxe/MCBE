// ─── 管理员菜单 ────────────────────────────────────────
// 配置：默认配额 / 逐玩家配额（0=禁止，含占用统计）/ 管理员名单。
// 入口：主菜单"管理员菜单"按钮 或 /mp:admin（仅管理员可见/可开）。
// 额外提供：全部假人列表 / 全部假人在线管理（管理员视角，不受主人过滤）。

import { Player } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ActionFormBuilder, ModalFormBuilder, MessageFormBuilder } from "@yinxe/toolkit";

import { botRegistry, configStore } from "../bootstrap/context";
import { isAdmin } from "../commands/auth";
import { showBotList } from "./bot";
import { showOnlineManagement } from "./online";

/** 概览 + 一级入口 */
export function showAdminMenu(player: Player): void {
  if (!isAdmin(player)) {
    player.sendMessage(`${color.error}只有管理员可以打开管理员菜单`);
    return;
  }
  const cfg = configStore.get();
  const all = botRegistry.all();
  const owners = new Set(all.map((r) => r.ownerName).filter((n): n is string => !!n));
  const ownerless = all.filter((r) => !r.ownerName).length;

  new ActionFormBuilder()
    .title(`${color.gold}⚙ 管理员菜单`)
    .body(
      `${color.muted}默认配额: ${color.info}${cfg.defaultQuota} ${color.muted}个/玩家\n` +
      `${color.muted}假人总数: ${color.info}${botRegistry.size} ${color.muted}（主人 ${color.info}${owners.size} ${color.muted}名，无主 ${color.warn}${ownerless} ${color.muted}个）\n` +
      `${color.muted}管理员: ${color.info}${cfg.admins.length} ${color.muted}名（名单）`
    )
    // ── 假人全览（管理员视角：不受主人过滤，全部可见） ──
    .button("全部假人列表", () => showBotList(player, () => showAdminMenu(player)))
    .button("全部假人在线管理", () => showOnlineManagement(player))
    .button(`默认配额 ${color.info}${cfg.defaultQuota}`, () => editDefaultQuota(player))
    .button("逐玩家配额", () => showPlayerQuotaList(player))
    .button("管理员名单", () => showAdminList(player))
    .button(style("返回", color.darkGray), () => undefined)
    .show(player);
}

/** 修改默认配额 */
async function editDefaultQuota(player: Player): Promise<void> {
  const cfg = configStore.get();
  const vals = await ModalFormBuilder.showQuick(player, `${color.bold}默认配额`, (f) => {
    f.textField("quota", "每玩家默认可创建的假人数（0 = 禁止）", { defaultValue: `${cfg.defaultQuota}`, tooltip: "管理员（OP 或名单）不受配额限制" });
  });
  if (!vals) return;
  const quota = parseInt(vals.quota as string, 10);
  if (isNaN(quota) || quota < 0) {
    player.sendMessage(`${color.error}无效的配额数字`);
    return;
  }
  configStore.setDefaultQuota(quota);
  player.sendMessage(`${color.success}默认配额已更新为 ${color.info}${quota}${color.success} 个/玩家`);
}

/** 逐玩家配额列表：有覆盖的玩家 + 全部主人 */
function showPlayerQuotaList(player: Player): void {
  const cfg = configStore.get();
  const owners = [...new Set([
    ...Object.keys(cfg.quotas),
    ...botRegistry.all().map((r) => r.ownerName).filter((n): n is string => !!n),
  ])].sort();

  if (owners.length === 0) {
    player.sendMessage(`${color.muted}暂无玩家记录，先创建假人后再来配置`);
    return;
  }

  const form = new ActionFormBuilder().title(`${color.gold}逐玩家配额`);
  for (const name of owners) {
    const owned = botRegistry.all().filter((r) => r.ownerName === name).length;
    const quota = cfg.quotas[name] !== undefined ? cfg.quotas[name] : cfg.defaultQuota;
    const tag = quota === 0 ? `${color.error}禁止` : `${color.info}${quota}`;
    form.button(
      `${color.playerName}${name} ${color.muted}(${color.info}${owned}${color.muted}/${tag}${color.muted})`,
      () => editPlayerQuota(player, name)
    );
  }
  form.button(style("返回", color.darkGray), () => showAdminMenu(player));
  form.show(player);
}

/** 修改单个玩家配额（留空 = 恢复默认） */
async function editPlayerQuota(player: Player, targetName: string): Promise<void> {
  const cfg = configStore.get();
  const owned = botRegistry.all().filter((r) => r.ownerName === targetName).length;
  const current = cfg.quotas[targetName] !== undefined ? `${cfg.quotas[targetName]}` : "";

  const vals = await ModalFormBuilder.showQuick(player, `${color.bold}配额：${targetName}`, (f) => {
    f.textField("quota", `配额（留空恢复默认 ${cfg.defaultQuota}；0 = 禁止）`, { defaultValue: current, tooltip: `当前占用 ${owned} 个假人` });
  });
  if (!vals) return;
  const raw = (vals.quota as string).trim();
  if (raw === "") {
    configStore.setPlayerQuota(targetName, undefined);
    player.sendMessage(`${color.success}${targetName} 已恢复默认配额 ${color.info}${cfg.defaultQuota}`);
    return;
  }
  const quota = parseInt(raw, 10);
  if (isNaN(quota) || quota < 0) {
    player.sendMessage(`${color.error}无效的配额数字`);
    return;
  }
  configStore.setPlayerQuota(targetName, quota);
  player.sendMessage(`${color.success}${targetName} 的配额已设为 ${color.info}${quota}${color.success} 个`);
}

/** 管理员名单管理 */
function showAdminList(player: Player): void {
  const admins = configStore.get().admins;
  const form = new ActionFormBuilder().title(`${color.gold}管理员名单`);
  form.body(`${color.muted}名单内的玩家（无需 OP）与 OP 一样不受配额限制、可管理所有假人`);

  for (const name of admins) {
    form.button(`${color.playerName}${name}`, () => {
      MessageFormBuilder.confirm(player, "移除管理员", `确定将 ${color.playerName}${name}${color.info} 移出管理员名单？`, () => {
        configStore.removeAdmin(name);
        player.sendMessage(`${color.success}已移除管理员 ${color.playerName}${name}`);
        showAdminList(player);
      });
    });
  }

  form.button(`${color.success}+ 添加管理员`, async () => {
    const vals = await ModalFormBuilder.showQuick(player, `${color.bold}添加管理员`, (f) => {
      f.textField("name", "玩家名", { defaultValue: "", tooltip: "该玩家无需 OP 也可管理所有假人、不受配额限制" });
    });
    if (!vals) return;
    const name = (vals.name as string).trim();
    if (!name) {
      player.sendMessage(`${color.error}玩家名不能为空`);
      return;
    }
    configStore.addAdmin(name);
    player.sendMessage(`${color.success}已将 ${color.playerName}${name}${color.success} 加入管理员名单`);
    showAdminList(player);
  });

  form.button(style("返回", color.darkGray), () => showAdminMenu(player));
  form.show(player);
}