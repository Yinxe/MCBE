// ─── 选区流程纯逻辑：两点 → 区域 + 建仓/调整完成（可单测） ──
// 信物"选点建仓/调整区域"的状态机核心，抽成纯函数供 node 单测
// （tests/interaction.test.ts），ToolInteractionController 注入真实 deps 调用。
// 流程：session 无 corner1 → 记录第一个对角点；已有 corner1 → 用当前点击完成，
// 归一化两点为区域（areaFromPoints 自动纠正角点乱序），走 WarehouseService
// createWarehouse / updateArea，成功后清会话 + 触发 boundary-glow 视觉事件。
// 失败返回中文错误消息，会话保持在下一角点前可重试。
import type { WarehouseArea } from "../../core/model/Warehouse";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Location } from "../../core/model/types";
import type { WarehouseService } from "../../core/services/WarehouseService";
import type { EventBus } from "../../core/events/DomainEvents";
import type { SelectionSessionStore } from "./SelectionSessionStore";
import { chat } from "../ui/uiColor";

/** 两点归一化为区域（角点乱序自动纠正） */
export function areaFromPoints(dimension: string, p1: Location, p2: Location): WarehouseArea {
  return {
    dimension,
    corner1: {
      x: Math.min(p1.x, p2.x),
      y: Math.min(p1.y, p2.y),
      z: Math.min(p1.z, p2.z),
    },
    corner2: {
      x: Math.max(p1.x, p2.x),
      y: Math.max(p1.y, p2.y),
      z: Math.max(p1.z, p2.z),
    },
  };
}

/** 选区流程依赖 */
export interface CornerContext {
  session: SelectionSessionStore;
  warehouses: WarehouseService;
  bus: EventBus;
  /** 解析已加载仓库（resize 用） */
  resolveWarehouse: (id: string) => Warehouse | undefined;
}

/** 触发仓库边界光幕（视觉反馈） */
function glow(ctx: CornerContext, warehouseId: string): void {
  ctx.bus.visualEffect.trigger({ type: "visual-effect", kind: "boundary-glow", warehouseId });
}

/**
 * 处理信物点击对角：
 * - 无已记角 → 记录 corner1，等待对角
 * - 已有 corner1 → 建仓/调整区域完成，清会话，返回玩家提示
 */
export function handleCornerClick(
  ctx: CornerContext,
  playerId: string,
  clicked: Location,
  dimension: string
): string {
  const session = ctx.session.get(playerId);
  if (session === undefined) return "";
  if (session.corner1 === undefined) {
    ctx.session.set(playerId, { ...session, corner1: clicked });
    return `${chat.success}已记录第一个对角点，请手持信物右键对角方块完成选区`;
  }
  const area = areaFromPoints(dimension, session.corner1, clicked);
  if (session.kind === "createWarehouse") {
    const result = ctx.warehouses.createWarehouse(session.name, playerId, area, {
      role: session.defaultRole,
      enabled: session.defaultEnabled,
    });
    if (!result.ok) return `${chat.error}${result.error}`; // 失败保留会话，可换对角重试
    ctx.session.clear(playerId);
    glow(ctx, result.warehouse.id);
    return `${chat.success}仓库 "${result.warehouse.displayName}" 创建成功！区域内容器自动注册`;
  }
  // resize
  const wh = ctx.resolveWarehouse(session.warehouseId);
  if (wh === undefined) return `${chat.error}仓库不存在或未加载`;
  const err = ctx.warehouses.updateArea(wh, area);
  if (err !== undefined) return `${chat.error}${err}`; // 失败保留会话，可换对角重试
  ctx.session.clear(playerId);
  glow(ctx, wh.id);
  return `${chat.success}仓库 "${wh.displayName}" 区域已调整`;
}