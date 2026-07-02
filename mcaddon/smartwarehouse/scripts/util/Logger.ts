import { world, PlayerPermissionLevel } from "@minecraft/server";

/**
 * 日志工具类，提供统一的日志输出能力。
 * 使用 console.warn 而非 console.info，是因为在 Minecraft Bedrock 
 * Content Log 中，warn 级别的日志更稳定可靠，不会被日志级别过滤忽略。
 */
export class Logger {
  /**
   * @param prefix - 日志前缀，默认为 "SmartWarehouse"，最终输出格式为 [prefix] 消息
   */
  constructor(private readonly prefix = "SmartWarehouse") {}

  /**
   * 输出信息日志（实际使用 console.warn，利用其更高的可见性）
   * @param message - 日志消息内容
   */
  info(message: string): void {
    console.warn(`[${this.prefix}] ${message}`);
  }

  /**
   * 输出错误日志
   * @param message - 错误消息内容
   */
  error(message: string): void {
    console.error(`[${this.prefix}] ${message}`);
  }

  /**
   * 向所有 OP 管理员玩家发送游戏内消息。
   * 权限判定使用 PlayerPermissionLevel.Operator 而非 tag("op")，与 PlayerAuth 保持一致。
   * 消息前缀使用 §e 颜色码（黄色），便于在聊天中区分。
   * @param message - 要发送的消息内容
   */
  tellAdmins(message: string): void {
    for (const player of world.getPlayers()) {
      if (player.playerPermissionLevel >= PlayerPermissionLevel.Operator) {
        player.sendMessage(`§e[${this.prefix}]§r ${message}`);
      }
    }
  }
}
