// ─── UI 命令组 ─────────────────────────────────────────────────────
// 命令=面板的一跳入口翻译，零业务规则。mp:admin 在处理器内判权，其拒绝文案与
// CmdKit admin 位消息口径不同源，勿合并；mp:data 走 ctx.bot 管理守卫（含无主认领）。

import { color } from "@yinxe/toolkit";
import { Param, type CommandSpec } from "./CmdKit";
import { showMainMenu } from "./Panels/Menu";
import { showAdminMenu } from "./Panels/Admin";
import { showTridentSelector } from "./Panels/Trident";
import { sendData } from "./Panels/Data";

export const UI_COMMANDS: CommandSpec[] = [
  {
    name: "mp:menu",
    description: "打开模拟玩家管理菜单",
    usage: "mp:menu",
    execute(ctx) {
      showMainMenu(ctx.player);
    },
  },
  {
    name: "mp:admin",
    description: "打开管理员菜单（默认配额/逐玩家配额/管理员名单）",
    usage: "mp:admin",
    execute(ctx) {
      if (!ctx.admin) {
        ctx.say(`${color.error}只有管理员可以打开管理员菜单`);
        return;
      }
      showAdminMenu(ctx.player);
    },
  },
  {
    name: "mp:trident",
    description: "让假人投掷手中的三叉戟或打开选择表单",
    usage: "mp:trident <假人>",
    args: [{ name: "name", type: Param.String }],
    execute(ctx, a) {
      const r = ctx.bot(String(a.name ?? ""));
      if (!r) return;
      showTridentSelector(ctx.player, r.record);
    },
  },
  {
    name: "mp:data",
    description: "查看模拟玩家的完整数据",
    usage: "mp:data <假人>",
    args: [{ name: "name", type: Param.String, optional: true }],
    execute(ctx, a) {
      const name = String(a.name ?? "").trim();
      if (!name) {
        ctx.say(`${color.error}用法: /mp:data <假人名>`);
        return;
      }
      const r = ctx.bot(name);
      if (!r) return;
      sendData(ctx.player, r.record);
    },
  },
];
