// ─── 钓鱼/容器测试命令（管理员） ────────────────────────
// 三个游戏内测试命令：
//   /mp:fishspot <location> [radius]  寻找钓鱼点（星级+瞄准点展示）
//   /mp:fish <name>                   假人完成一次钓鱼（fishOnce）
//   /mp:container <name> <location>   假人与容器互换前 27 格（测试）
// 仅管理员可用（对齐 /mp:test 测试命令先例）。

import { world, system, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import type { Vector3 } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";

import { findFishingSpots } from "../features/task/fishing";
import type { FindSpotsFailure } from "../../rules/FishingRules";
import { fishOnce, failureLabel } from "../features/task/fishingFlow";
import { withContainer, type ContainerOpResult } from "../features/basic/containerInteraction";
import { resolveBotPlayer } from "../adapters/PlayerGateway";
import { botRegistry } from "../bootstrap/context";
import { isAdmin } from "./auth";

/** 钓鱼点互换测试的格子数上限（容器可能只有 27 格，取小者） */
const SWAP_SLOTS = 27;

/** 寻找钓鱼点失败原因 → 中文 */
function spotFailureLabel(reason: FindSpotsFailure): string {
  switch (reason) {
    case "no-water":
      return "范围内没有水面";
    case "no-spot":
      return "有水面但没有满足条件的钓鱼点";
    default:
      return "扫描异常";
  }
}

/** 容器交互结果 → 中文 */
function containerResultLabel(result: ContainerOpResult): string {
  switch (result) {
    case "ok":
      return "完成";
    case "offline":
      return "假人不在线";
    case "not-container":
      return "目标不是容器（箱子/木桶/潜影盒）";
    default:
      return "执行异常";
  }
}

export function registerFishingCommands(registry: any): void {
  // ── /mp:fishspot 寻找钓鱼点 ──
  defineCommand(registry, {
    name: "mp:fishspot",
    description: "寻找钓鱼点（默认以玩家为中心半径 40；可指定坐标与半径）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      { name: "location", type: CustomCommandParamType.Location },
      { name: "radius", type: CustomCommandParamType.Integer },
    ],
  }, ({ player, params }) => {
    if (!isAdmin(player)) {
      player.sendMessage(`${color.error}该命令仅管理员可用`);
      return;
    }
    const center = (params.location as Vector3 | undefined) ?? player.location;
    const radius = (params.radius as number | undefined) ?? 40;

    const result = findFishingSpots(center, player.dimension, radius);
    if (result.reason) {
      player.sendMessage(`${color.error}未找到钓鱼点：${spotFailureLabel(result.reason)}`);
      return;
    }
    // 每个钓鱼点：站立格/支撑块/星级/瞄准点/相邻水面/距离
    const lines = result.spots.slice(0, 10).map((s, i) => {
      const st = s.stand;
      const sp = s.support;
      const aim = s.aim.target;
      const dist = Math.round(Math.hypot(st.x - center.x, st.y - center.y, st.z - center.z));
      const waters =
        s.waters.length <= 4
          ? s.waters.map((w) => `(${w.x}, ${w.y}, ${w.z})`).join(" ")
          : `${s.waters.slice(0, 4).map((w) => `(${w.x}, ${w.y}, ${w.z})`).join(" ")}…×${s.waters.length}`;
      return [
        `${color.muted}${i + 1}. ${color.playerName}站立(${st.x}, ${st.y}, ${st.z})${color.muted} 距离${dist} ${color.accent}${s.aim.level}星`,
        `${color.muted}    支撑(${sp.x}, ${sp.y}, ${sp.z}) 瞄准(${aim.x}, ${aim.y}, ${aim.z})`,
        `${color.muted}    水面: ${waters}`,
      ].join("\n");
    });
    const more = result.spots.length > 10 ? `\n${color.muted}…共 ${result.spots.length} 个（按星级+距离排序）` : "";
    player.sendMessage(
      `${color.accent}[模拟玩家][钓鱼] ${color.success}找到 ${result.spots.length} 个钓鱼点（中心 (${Math.floor(center.x)}, ${Math.floor(center.y)}, ${Math.floor(center.z)})，半径 ${radius}）：\n${lines.join("\n")}${more}`
    );
  });

  // ── /mp:fish 钓鱼一次 ──
  defineCommand(registry, {
    name: "mp:fish",
    description: "让假人完成一次钓鱼（抛竿→稳定→监听上钩→收竿）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    if (!isAdmin(player)) {
      player.sendMessage(`${color.error}该命令仅管理员可用`);
      return;
    }
    const botName = params.name as string;
    const record = botRegistry.get(botName);
    if (!record) {
      player.sendMessage(`${color.error}未找到假人 ${color.playerName}${botName}${color.error} 的记录`);
      return;
    }
    player.sendMessage(`${color.muted}开始钓鱼：${color.playerName}${botName}${color.muted}（抛竿中…）`);
    void (async () => {
      try {
        const outcome = await fishOnce(botName);
        let detail: string;
        if (outcome.kind === "caught") detail = `${color.success}钓到鱼，收竿完成！`;
        else if (outcome.kind === "timeout") detail = `${color.warn}等待 45 秒无鱼上钩，超时收竿`;
        else detail = `${color.error}钓鱼失败：${failureLabel(outcome.reason)}`;
        player.sendMessage(`${color.accent}[模拟玩家][钓鱼] ${color.playerName}${botName} ${detail}`);
      } catch (e) {
        player.sendMessage(`${color.error}[模拟玩家][钓鱼] ${botName} 流程异常: ${e}`);
      }
    })();
  });

  // ── /mp:container 容器互换测试 ──
  defineCommand(registry, {
    name: "mp:container",
    description: "测试：假人与指定容器互换前 27 格（箱子/木桶/潜影盒）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [
      { name: "name", type: CustomCommandParamType.String },
      { name: "location", type: CustomCommandParamType.Location },
    ],
  }, ({ player, params }) => {
    if (!isAdmin(player)) {
      player.sendMessage(`${color.error}该命令仅管理员可用`);
      return;
    }
    const botName = params.name as string;
    const loc = params.location as Vector3;
    const pos = { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) };
    const record = botRegistry.get(botName);
    if (!record) {
      player.sendMessage(`${color.error}未找到假人 ${color.playerName}${botName}${color.error} 的记录`);
      return;
    }
    player.sendMessage(`${color.muted}容器互换开始：${color.playerName}${botName}${color.muted} ↔ (${pos.x}, ${pos.y}, ${pos.z})`);
    void (async () => {
      try {
        const result = await withContainer(botName, pos, async (access) => {
          const bot = resolveBotPlayer(botName);
          if (!bot) return;
          const botInv = (bot.getComponent("minecraft:inventory") as
            | { container?: { size: number; getItem: (i: number) => unknown; setItem: (i: number, v: unknown) => void } }
            | undefined)?.container;
          if (!botInv) return;
          // 互换前 min(27, 两容器尺寸) 格：读不等待，写经 access 自动 2 tick
          const n = Math.min(SWAP_SLOTS, botInv.size, access.size);
          for (let i = 0; i < n; i++) {
            const botItem = botInv.getItem(i);
            const chestItem = await access.getItem(i);
            botInv.setItem(i, chestItem);
            await access.setItem(i, botItem as never);
          }
        });
        if (result === "ok") {
          player.sendMessage(`${color.accent}[模拟玩家][容器] ${color.success}${botName} 与容器互换 ${SWAP_SLOTS} 格完成`);
        } else {
          player.sendMessage(`${color.error}[模拟玩家][容器] ${botName} 互换失败：${containerResultLabel(result)}`);
        }
      } catch (e) {
        player.sendMessage(`${color.error}[模拟玩家][容器] ${botName} 互换异常: ${e}`);
      }
    })();
  });
}
