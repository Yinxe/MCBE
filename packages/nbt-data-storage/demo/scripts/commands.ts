// ── nds-demo:* 命令（配置 / 存取 / 盘点） ────────────────────────────
// 复用 @yinxe/toolkit 的 defineCommand：自动校验玩家、回调包在 system.run 中、
// 参数按名解构。命令仅做薄转发，业务在 storageService / config / ui。
import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import type { CustomCommandRegistry } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { showConfigForm } from "./config";
import { colorOf, storage } from "./storageService";
import { showBatchStore, showBatchTake, showMainMenu } from "./ui";

/** 注册全部 nds-demo:* 命令（main.ts Phase 3 调用一次） */
export function registerDemoCommands(registry: CustomCommandRegistry): void {
  defineCommand(
    registry,
    {
      name: "nds-demo:ui",
      description: "打开 NBT 存储测试管理菜单（存取/统计/配置）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    ({ player }) => {
      showMainMenu(player);
    }
  );

  defineCommand(
    registry,
    {
      name: "nds-demo:config",
      description: "打开 NBT 存储测试配置（维度/锚点/底层Y/开关）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    ({ player }) => {
      showConfigForm(player, { onApply: (cfg) => storage.applyConfig(cfg, true) });
    }
  );

  defineCommand(
    registry,
    {
      name: "nds-demo:store",
      description: "存入手持物品到存储区域",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    ({ player }) => {
      const r = storage.storeHeldItem(player);
      player.sendMessage(`${colorOf(r)}${r.message}`);
    }
  );

  defineCommand(
    registry,
    {
      name: "nds-demo:take",
      description: "按格子 ID 取出物品到背包（背包满自动放回）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "slotId", type: CustomCommandParamType.Integer }],
    },
    ({ player, params }) => {
      const slotId = Number(params.slotId);
      if (!Number.isInteger(slotId) || slotId < 0) {
        player.sendMessage("§c格子号必须是非负整数");
        return;
      }
      const r = storage.takeToPlayer(player, slotId);
      player.sendMessage(`${colorOf(r)}${r.message}`);
    }
  );

  defineCommand(
    registry,
    {
      name: "nds-demo:store-all",
      description: "打开批量存入 UI（背包物品勾选存入）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    ({ player }) => {
      showBatchStore(player);
    }
  );

  defineCommand(
    registry,
    {
      name: "nds-demo:take-all",
      description: "打开批量取出 UI（凭据勾选取出）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    ({ player }) => {
      showBatchTake(player);
    }
  );

  defineCommand(
    registry,
    {
      name: "nds-demo:overwrite",
      description: "手持物品原位覆写到指定格子（旧物品返回背包，slotId 不变）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "slotId", type: CustomCommandParamType.Integer }],
    },
    ({ player, params }) => {
      const slotId = Number(params.slotId);
      if (!Number.isInteger(slotId) || slotId < 0) {
        player.sendMessage("§c格子号必须是非负整数");
        return;
      }
      const r = storage.overwriteToSlot(player, slotId);
      player.sendMessage(`${colorOf(r)}${r.message}`);
    }
  );

  defineCommand(
    registry,
    {
      name: "nds-demo:check",
      description: "阵列自检 + 修复（损坏桶重建/丢失槽回收）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    ({ player }) => {
      storage.checkAndRepair(player);
    }
  );

  defineCommand(
    registry,
    {
      name: "nds-demo:list",
      description: "列出本上下文已存的物品凭据（格子号）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    ({ player }) => {
      player.sendMessage(storage.formatList());
    }
  );

  defineCommand(
    registry,
    {
      name: "nds-demo:stats",
      description: "查看存储区域统计与世界全库汇总",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    ({ player }) => {
      storage.showStats(player);
    }
  );
}
