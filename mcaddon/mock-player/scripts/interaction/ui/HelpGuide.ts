/**
 * ============================================================================
 * HelpGuide —— 帮助手册 + 功能介绍
 * ============================================================================
 *
 * 以聊天栏分段发送格式化的帮助内容，涵盖：
 * - 功能介绍（所有行为标签说明）
 * - 快速上手
 * - 命令参考
 * - 常见问题
 * ============================================================================
 */

import { type Player } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

function sendLines(player: Player, lines: string[]): void {
  for (const line of lines) {
    player.sendMessage(line);
  }
}

const HELP_SECTIONS: { title: string; content: string[] }[] = [
  {
    title: `${color.bold}${color.accent}≡≡≡ MockPlayer · 功能介绍 ≡≡≡`,
    content: [
      "",
      `${color.success}MockPlayer ${color.muted}是一个模拟玩家（假人）管理模组。`,
      `${color.muted}你可以创建假人来协助完成自动化任务。`,
      "",
      `${color.accent}▶ 可共存标签`,
      `${color.muted}  ${color.playerName}自动重生${color.muted}: 死亡后自动复活到重生点`,
      "",
      `${color.accent}▶ 互斥行为标签（同一时间只能选一个）`,
      `${color.muted}  ${color.playerName}空闲${color.muted}: 默认状态，不执行任何行为`,
      `${color.muted}  ${color.playerName}自动挖掘${color.muted}: 自动破坏面前的方块（6 格内）`,
      `${color.muted}  ${color.playerName}自动放置${color.muted}: 将手中方块放置到面前位置`,
      `${color.muted}  ${color.playerName}自动攻击${color.muted}: 持续攻击附近的实体`,
      `${color.muted}  ${color.playerName}体态控制${color.muted}: 跟随控制玩家的位置和视角`,
      `${color.muted}  ${color.playerName}使用物品${color.muted}: 行为菜单开关：勾选提交用一次主手物品（约 2 秒后自动停下），取消即立即停止（一次性，默认关闭）`,
      `${color.muted}  ${color.playerName}宝库模式${color.muted}: 自动用钥匙开 Trial Chambers 宝库`,
      "",
      `${color.accent}▶ 宝库模式专有说明`,
      `${color.muted}  开启后假人会尝试用手中的钥匙打开面前的宝库。`,
      `${color.muted}  交互成功后自动下线刷新躯体，绕过每人只能开一次的`,
      `${color.muted}  限制。支持普通钥匙（trial_key）和不详钥匙（ominous_trial_key）。`,
      `${color.muted}  每次开完后向最近玩家报告剩余钥匙数量。`,
      "",
    ],
  },
  {
    title: `${color.bold}${color.accent}≡≡≡ MockPlayer · 快速上手 ≡≡≡`,
    content: [
      "",
      `${color.accent}▶ 创建假人`,
      `${color.muted}  1. 使用 ${color.info}/mp:menu ${color.muted}打开主菜单`,
      `${color.muted}  2. 点击 ${color.success}创建模拟玩家${color.muted}，填写名称和坐标`,
      `${color.muted}  3. 创建后假人自动加入世界`,
      "",
      `${color.accent}▶ 管理假人`,
      `${color.muted}  在 ${color.accent}模拟玩家列表 ${color.muted}中点击假人进入管理面板，`,
      `${color.muted}  可进行以下操作：`,
      `${color.muted}  - ${color.highlight}行为标签 ${color.muted}切换自动挖掘/放置/攻击等模式`,
      `${color.muted}  - 上下线 / 潜行 / 控制模式`,
      `${color.muted}  - 互换背包 / 回收资源 / 改名`,
      `${color.muted}  - 设置重生点 / 传送到假人`,
      `${color.muted}  - 杀死 / 删除假人`,
      "",
      `${color.accent}▶ 批量上下线`,
      `${color.muted}  在 ${color.gold}在线管理 ${color.muted}中可以批量切换假人的在线状态。`,
      "",
    ],
  },
  {
    title: `${color.bold}${color.accent}≡≡≡ MockPlayer · 命令参考 ≡≡≡`,
    content: [
      "",
      `${color.info}/mp:menu ${color.muted}- 打开主菜单`,
      `${color.info}/mp:create [名称] [坐标] ${color.muted}- 直接创建假人`,
      `${color.info}/mp:listbots ${color.muted}- 列出所有假人`,
      `${color.info}/mp:online <假人> ${color.muted}- 上线指定假人`,
      `${color.info}/mp:offline <假人> ${color.muted}- 下线指定假人`,
      `${color.info}/mp:delete <假人> ${color.muted}- 删除指定假人`,
      `${color.info}/mp:killbot <假人> ${color.muted}- 杀死指定假人`,
      `${color.info}/mp:teleportbot <假人> ${color.muted}- 传送到假人身边`,
      `${color.info}/mp:tphere <假人> ${color.muted}- 将假人传送到身边`,
      `${color.info}/mp:tagmanage <假人> <add|remove|list> [标签] ${color.muted}- 管理标签`,
      `${color.info}/mp:tags ${color.muted}- 列出所有可用标签`,
      `${color.info}/mp:data <假人> ${color.muted}- 查看假人数据`,
      `${color.info}/mp:reclaim <假人> ${color.muted}- 回收假人背包/经验`,
      `${color.info}/mp:respawn <假人> ${color.muted}- 切换自动重生`,
      `${color.info}/mp:setrespawn ${color.muted}- 设置重生点到当前位置`,
    ],
  },
  {
    title: `${color.bold}${color.accent}≡≡≡ MockPlayer · 常见问题 ≡≡≡`,
    content: [
      "",
      `${color.accent}Q: 假人不执行行为？`,
      `${color.muted}A: 检查：①假人在线 ②行为标签已设置 ③附近有目标`,
      `${color.muted}  宝库模式还需检查是否手持钥匙`,
      "",
      `${color.accent}Q: 如何让假人自动挖矿？`,
      `${color.muted}A: 在行为标签中选 ${color.playerName}自动挖掘${color.muted}，假人会破坏面前的方块`,
      "",
      `${color.accent}Q: 宝库模式没反应？`,
      `${color.muted}A: 确保假人主手持有 ${color.playerName}普通钥匙 ${color.muted}或 ${color.playerName}不详钥匙${color.muted}，`,
      `${color.muted}  且面向宝库方块（4 格内）`,
      "",
      `${color.accent}Q: 假人死后不见了？`,
      `${color.muted}A: 开启 ${color.playerName}自动重生 ${color.muted}标签，假人死后自动复活`,
      `${color.muted}  未开启则死亡下线，需手动上线`,
      "",
      `${color.accent}Q: 什么是体态控制？`,
      `${color.muted}A: 开启后假人会跟随你的位置、视角和潜行状态，`,
      `${color.muted}  相当于一个会动的分身`,
    ],
  },
];

/**
 * 向玩家发送完整帮助手册。
 */
export function showHelpGuide(player: Player): void {
  for (const section of HELP_SECTIONS) {
    sendLines(player, section.content);
  }
}