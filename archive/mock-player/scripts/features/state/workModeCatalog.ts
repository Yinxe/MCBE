// ─── 工作模式目录（命令与界面共用的说明表） ──────────────
// 合并自 v3 的 domain/Catalog.ts 思路：给每个工作模式配一句"人话说明"，
// 供 /mp:work list 与帮助信息使用（我们自己架构内的实现，不引入 v3 机制）。
import type { WorkMode } from "./behavior";

/** 工作模式目录条目 */
export interface WorkModeSpec {
  /** 模式 id（= record.workMode 的取值） */
  id: WorkMode;
  /** 界面/命令显示名 */
  label: string;
  /** 一句话说明（/mp:work list 用） */
  help: string;
}

/** 工作模式目录（顺序即展示顺序；新增模式必须在此补条目） */
export const WORK_MODE_SPECS: readonly WorkModeSpec[] = [
  { id: "none", label: "无", help: "不执行任何自主行为" },
  { id: "wander", label: "闲逛模式", help: "随机游走探索周围方块" },
  { id: "mine", label: "定点挖掘模式", help: "持续挖掉正前方准星命中的方块" },
  { id: "place", label: "定点放置模式", help: "持续把主手方块放到正前方" },
  { id: "attack", label: "定点攻击模式", help: "持续向前方近战挥击" },
  { id: "autoInteract", label: "定点交互模式", help: "只交互准星正对的方块或实体" },
  { id: "raid", label: "劫掠模式", help: "参与袭击并自动战斗" },
  { id: "fishing", label: "自动钓鱼模式", help: "自动抛竿、等咬钩、收竿（可自动存入容器）" },
  { id: "follow", label: "自动跟随", help: "跟随主人移动" },
  { id: "script", label: "编程模式", help: "按自定义工序表逐条执行（走/挖/放/等待/跳转…）" },
  { id: "vault", label: "宝库模式", help: "扫描并自动寻路开启试炼宝库（消耗背包中的钥匙）" },
];

/** 按 id 取目录条目 */
export function workModeSpec(id: string): WorkModeSpec | undefined {
  return WORK_MODE_SPECS.find((s) => s.id === id);
}

/** 按 id 取显示名（查不到时回退 id 本身） */
export function workModeLabel(id: string): string {
  return workModeSpec(id)?.label ?? id;
}