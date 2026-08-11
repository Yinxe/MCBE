// ── nds:* 管理命令（可选安装，mc 适配层） ──────────────────────────────
// 命令仅做"总存储信息管理/读取"（列出区域、查看统计），不涉及物品读写。
// 重复注册防护：
//   - 本上下文内 installNdsCommands() 幂等（只注册一次）；
//   - 多个模组各自打包本库并都调用它时，重复的 registerCommand 会被捕获忽略，
//     命令由先注册的模组管理，其余模组不报错（直接使用 ItemStorage API 即可）。
import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, Player, system } from "@minecraft/server";
import type { CustomCommand, CustomCommandOrigin, CustomCommandRegistry, CustomCommandResult } from "@minecraft/server";
import { queryWorld, totalStats } from "./ItemStorage";

/** 本上下文是否已注册过命令（幂等守卫） */
let commandsInstalled = false;

/**
 * 注册命令并吞掉"重复注册"错误（其他模组也打包了本库时的常见情况）。
 * 命令注册失败不影响 ItemStorage API，故静默跳过。
 */
function registerCommandSafe(
  registry: CustomCommandRegistry,
  config: CustomCommand,
  handler: (origin: CustomCommandOrigin, ...args: unknown[]) => CustomCommandResult
): void {
  try {
    registry.registerCommand(config, handler);
  } catch (e) {
    console.warn(`[nbt-data-storage] 命令 ${config.name} 已由其他模组注册，跳过`, e);
  }
}

/** 在 system.run 中安全执行回调（自包含，不依赖 toolkit） */
function runSafe(fn: () => void): void {
  system.run(() => {
    try {
      fn();
    } catch (e) {
      console.warn("[nbt-data-storage] 命令执行失败", e);
    }
  });
}

/** 命令来源是否为玩家（nds:* 仅玩家可用） */
function playerOf(origin: CustomCommandOrigin): Player | undefined {
  const source = origin.sourceEntity ?? origin.initiator;
  return source instanceof Player ? source : undefined;
}

/**
 * 注册 `nds:regions`（列出全部区域）与 `nds:stats [键]`（区域详情）命令。
 * 在消费模组的 startup 事件（Phase 3）调用一次即可；幂等，可被多个模组重复调用
 * （重复注册被捕获忽略，命令由先注册者管理）。
 */
export function installNdsCommands(): void {
  if (commandsInstalled) return;
  commandsInstalled = true;
  system.beforeEvents.startup.subscribe((event) => {
    const registry = event.customCommandRegistry;

    registerCommandSafe(
      registry,
      {
        name: "nds:regions",
        description: "列出所有 nbt-data-storage 存储区域",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [],
      },
      (origin: CustomCommandOrigin): CustomCommandResult => {
        const player = playerOf(origin);
        if (!player) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
        runSafe(() => {
          const all = queryWorld();
          const total = totalStats();
          const lines =
            all.length === 0
              ? ["§7（尚未注册任何存储区域）"]
              : all.map(
                  (s) => `§e${s.key}§r §7维度=${s.dimensionId} 层=${s.maxLevels} 容量=${s.capacity} 已用=${s.used}`
                );
          player.sendMessage(
            [
              "§l== nbt-data-storage 存储区域 ==§r",
              ...lines,
              `§7共 ${total.regionCount} 个区域，总容量 ${total.totalCapacity}，已用 ${total.totalUsed}§r`,
            ].join("\n")
          );
        });
        return { status: CustomCommandStatus.Success, message: undefined };
      }
    );

    registerCommandSafe(
      registry,
      {
        name: "nds:stats",
        description: "查看指定存储区域详情",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        optionalParameters: [{ name: "key", type: CustomCommandParamType.String }],
      },
      (origin: CustomCommandOrigin, ...args: unknown[]): CustomCommandResult => {
        const player = playerOf(origin);
        if (!player) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
        const key = args[0] as string | undefined;
        runSafe(() => {
          const all = queryWorld();
          if (!key) {
            player.sendMessage(`用法：/nds:stats <区域ID>；可用：${all.map((s) => s.key).join(", ") || "（无）"}`);
            return;
          }
          const s = all.find((x) => x.key === key);
          if (!s) {
            player.sendMessage(`§c未找到存储区域：${key}§r`);
            return;
          }
          player.sendMessage(
            [
              `§l== ${s.key} ==§r`,
              `维度 ${s.dimensionId}｜区块 ${s.chunkX}, ${s.chunkZ}｜底层 Y=${s.baseY}｜层数 ${s.maxLevels}`,
              `容量 ${s.capacity} 槽｜桶 ${s.barrels}/${s.totalBarrels}｜已用 ${s.used}｜水印 nextFree=${s.nextFree}｜空洞 ${s.freePoolSize}`,
            ].join("\n")
          );
        });
        return { status: CustomCommandStatus.Success, message: undefined };
      }
    );
  });
}
