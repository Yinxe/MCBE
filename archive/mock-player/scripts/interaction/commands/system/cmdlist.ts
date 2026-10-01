// ─── /mp:cmdlist —— 一次列出全部命令 ──────────────────────
// 合并自 v3 的 mp:cmdlist（我们自己维护清单；新增命令请在此登记）。
import { CommandPermissionLevel } from "@minecraft/server";
import { color, defineCommand } from "@yinxe/toolkit";

/** 命令目录（usage + 一句话说明） */
const COMMAND_LIST: readonly { usage: string; desc: string }[] = [
  { usage: "/mp:create <名字> [坐标] [维度]", desc: "创建一个假人" },
  { usage: "/mp:listbots", desc: "列出所有假人" },
  { usage: "/mp:online <名字>", desc: "假人上线" },
  { usage: "/mp:offline <名字>", desc: "假人下线" },
  { usage: "/mp:safeonline <名字>", desc: "安全上线（排队 + 冷却）" },
  { usage: "/mp:safeoffline <名字>", desc: "安全下线" },
  { usage: "/mp:killbot <名字>", desc: "杀死假人" },
  { usage: "/mp:respawn <名字>", desc: "假人重生" },
  { usage: "/mp:setrespawn <名字>", desc: "设置重生点" },
  { usage: "/mp:delete <名字>", desc: "删除假人（可回收物品）" },
  { usage: "/mp:teleportbot <名字>", desc: "传送到假人身边" },
  { usage: "/mp:tphere <名字>", desc: "把假人传送到你身边" },
  { usage: "/mp:move <名字> <坐标>", desc: "假人移动到目标位置" },
  { usage: "/mp:longmove <名字> <坐标>", desc: "长途移动（分段接力）" },
  { usage: "/mp:work <名字> [模式|list]", desc: "查看/切换工作模式" },
  { usage: "/mp:script <名字> <动作> [参数]", desc: "编程模式：add/list/loop/run/stop/status/dump" },
  { usage: "/mp:sneak <名字>", desc: "切换潜行状态" },
  { usage: "/mp:control <名字>", desc: "切换体态控制模式" },
  { usage: "/mp:follow <名字>", desc: "切换自动跟随" },
  { usage: "/mp:tagmanage <名字> add|remove|list [标签]", desc: "管理行为标签" },
  { usage: "/mp:tags", desc: "列出所有可用标签" },
  { usage: "/mp:reconnect <名字>", desc: "重连假人（下线 + 释放名字 + 重新上线）" },
  { usage: "/mp:recover <名字>", desc: "强制恢复背包/装备/经验" },
  { usage: "/mp:reclaim <名字>", desc: "回收假人物品和经验" },
  { usage: "/mp:data <名字>", desc: "查看假人详细数据" },
  { usage: "/mp:storage", desc: "查看存储占用统计" },
  { usage: "/mp:trident <名字>", desc: "投掷三叉戟" },
  { usage: "/mp:menu", desc: "打开主菜单" },
  { usage: "/mp:admin", desc: "打开管理员菜单" },
  { usage: "/mp:notify [on|off|show|debug|info|warn|error]", desc: "个人通知设置" },
  { usage: "/mp:test", desc: "测试工具" },
  { usage: "/mp:breakblock", desc: "方块破坏测试" },
  { usage: "/mp:chunkarea", desc: "常加载区块工具" },
  { usage: "/mp:container", desc: "容器互换测试" },
  { usage: "/mp:fishspot <坐标> [半径]", desc: "寻找钓鱼点" },
  { usage: "/mp:fish <名字>", desc: "让假人完成一次钓鱼" },
  { usage: "/mp:scantree <坐标> [半径]", desc: "扫描附近的树" },
  { usage: "/mp:scanlogs [坐标] [半径]", desc: "扫描附近的原木" },
  { usage: "/mp:scanleaves [坐标] [半径]", desc: "扫描附近的树叶" },
  { usage: "/mp:woodcut <名字>", desc: "切换砍树模式" },
  { usage: "/mp:woodcutmode <名字> [logs|collect]", desc: "设置砍树子模式" },
  { usage: "/mp:cmdlist", desc: "本帮助（命令目录）" },
];

/** 注册 /mp:cmdlist 命令 */
export function registerCmdListCommand(registry: Parameters<typeof defineCommand>[0]): void {
  defineCommand(
    registry,
    {
      name: "mp:cmdlist",
      description: "显示命令目录（本帮助）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    ({ player }) => {
      player.sendMessage(`${color.accent}━━━ 模拟玩家 · 命令目录 ━━━`);
      for (const c of COMMAND_LIST) {
        player.sendMessage(`${color.info}${c.usage} ${color.muted}- ${c.desc}`);
      }
      player.sendMessage(`${color.muted}提示：假人相关的管理命令需要「主人或管理员」权限。`);
    },
  );
}