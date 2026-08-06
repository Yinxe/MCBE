// ─── 选区会话存储：玩家 ID → 会话（纯 TS，可单测） ──────────
import type { ContainerRole } from "../../core/model/Container";
import type { Location } from "../../core/model/types";

/** 会话类型：建仓（含默认角色/启用）或调整区域 */
export type SelectionSession =
  | {
      kind: "createWarehouse";
      name: string;
      defaultRole: ContainerRole;
      defaultEnabled: boolean;
      /** 已选第一个对角点（信物右键记录），完成选区后清除 */
      corner1?: Location;
    }
  | {
      kind: "resizeWarehouse";
      warehouseId: string;
      corner1?: Location;
    };

/** 全局选择会话存储（内存 Map，玩家退出/完成后清除） */
export class SelectionSessionStore {
  private sessions = new Map<string, SelectionSession>();

  set(playerId: string, session: SelectionSession): void {
    this.sessions.set(playerId, session);
  }

  get(playerId: string): SelectionSession | undefined {
    return this.sessions.get(playerId);
  }

  clear(playerId: string): void {
    this.sessions.delete(playerId);
  }

  clearAll(): void {
    this.sessions.clear();
  }
}
