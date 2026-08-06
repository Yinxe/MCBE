// ─── 中文命名中心：状态/枚举的中文显示名（通知 + UI 菜单统一引用） ──
// 把散落在通知/菜单里的英文状态（deactivating 等）集中成一份中文映射，
// 保证 UI 与播报语义一致、单点维护。纯字符串模块，零依赖（node 单测可引用）。
// 覆盖（对齐需求）：仓库生命周期（路由状态）/ 成员角色 / 预警级别。
import type { WarehouseLifecycle } from "../../core/scheduling/Scheduler";
import type { MemberRole } from "../../core/model/Warehouse";
import type { WarningLevel } from "../../core/events/DomainEvents";

/** 仓库生命周期中文名（HUD/通知/菜单用）：停用 / 路由中 / 停用中 */
export const LIFECYCLE_LABELS: Record<WarehouseLifecycle, string> = {
  inactive: "停用",
  active: "路由中",
  deactivating: "停用中",
};

/** 生命周期变更动作动词（通知消息用，主语是仓库名） */
export const LIFECYCLE_ACTIONS: Record<WarehouseLifecycle, string> = {
  inactive: "已停止路由",
  active: "已启动路由",
  deactivating: "正在停止路由",
};

/** 成员角色中文名（成员列表/下拉） */
export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: "拥有者",
  member: "成员",
  visitor: "访客",
};

/** 预警级别中文名 */
export const WARNING_LEVEL_LABELS: Record<WarningLevel, string> = {
  warning: "警告",
  full: "满仓",
};
