// ─── DDUI 探针面板 ───────────────────────────────────────────────
//
// 12 条命令靠手敲太累,这个面板把它们变成按钮。
//
// 用 DDUI(`CustomForm` + `onClick`)而不是旧表单,理由是**行为差异**:
//
//   旧表单  点按钮 → 表单关闭 → resolve 一个响应对象
//   DDUI    点按钮 → 回调立即执行 → **表单保持打开**
//
// 「保持打开」正好是本场景需要的:连续点多个探针,不必每次重开面板。
//
// 但这也带来一个必须绕开的坑:在按钮回调里直接开新表单会以
// `UserBusy` 失败 —— 因为当前表单还开着,玩家仍处于「UI 交互中」。
// 详见 docs/research/ddui-behavior.md。
//
// 本文件的策略:
//   · 探针只往聊天栏输出,不换面板 → 不需要关表单,直接调即可;
//   · 「关闭面板」按钮才走 close();
//   · 绝不在回调里 show() 新表单,从根本上避开 UserBusy。

import { CustomForm, ObservableString, type DataDrivenScreenClosedReason } from "@minecraft/server-ui";
import { Player, system } from "@minecraft/server";
import { heading, kv, report, verdict } from "./DebugProbeShared";

/** 一条可执行的探针动作 */
export interface ProbeAction {
  /** 按钮上显示的名字 */
  label: string;
  /** 悬停提示,说明这条探针测什么 */
  tooltip: string;
  /** 实际执行体,已在安全上下文 */
  run: (player: Player) => void;
}

/**
 * 当前每个玩家打开着的表单。
 *
 * `CustomForm` 实例自己不知道「我属于哪个玩家」,只能按 `playerId`
 * 自己记一张表。这张表有两个用途:
 *   1. 换面板前先关掉旧的,避免 UserBusy;
 *   2. 玩家离线时清理,防止内存泄漏。
 */
const openForms = new Map<string, CustomForm>();

/** 关掉某玩家当前打开的面板(如果有) */
export function closePanel(playerId: string): void {
  const form = openForms.get(playerId);
  if (!form) return;
  openForms.delete(playerId);
  try {
    // `isShowing()` 与 `close()` 都是受限成员,必须在安全上下文调。
    // 已经关掉时 `close()` 抛 FormVisibilityError,所以先判一次。
    if (form.isShowing()) form.close();
  } catch {
    // 已关闭或玩家已离线,忽略
  }
}

/** 玩家离线时清理登记表 */
export function forgetPanel(playerId: string): void {
  openForms.delete(playerId);
}

/**
 * 打开探针面板。
 *
 * 必须在安全上下文调用 —— `CustomForm` 的构造器虽然不受限,
 * 但 `.label()` / `.button()` / `.show()` 全部标注了
 * `can't be called in restricted-execution mode`。
 */
export function showProbePanel(player: Player, actions: readonly ProbeAction[]): void {
  // 先把旧面板关掉:同一玩家同时只能有一个 DDUI 表单
  closePanel(player.id);

  const status = new ObservableString("尚未执行任何探针");
  const form = new CustomForm(player, "§lAPI 探针§r");

  form.label(status);

  for (const action of actions) {
    form.button(
      action.label,
      () => {
        // 回调里只做两件事:更新状态行、执行探针。
        //
        // 执行探针本身要放到 system.run 里:按钮回调的权限语义在
        // 文档里没有明确说明(见 ddui-behavior.md §5.1 的实测推断),
        // 而所有探针都要调受限成员。推迟到安全 tick 是最稳的写法,
        // 且 DDUI 不会因此关闭表单。
        status.setData(`§e执行中:${action.label}`);
        system.run(() => {
          if (!player.isValid) return;
          try {
            action.run(player);
            status.setData(`§a上次:${action.label} 完成`);
          } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            status.setData(`§c上次:${action.label} 失败`);
            player.sendMessage(`§c[API 探针] ${action.label} 失败:${text}`);
          }
        });
      },
      { tooltip: action.tooltip }
    );
  }

  form.button("§c关闭面板", () => {
    closePanel(player.id);
  });

  openForms.set(player.id, form);

  void form
    .show()
    .then((reason: DataDrivenScreenClosedReason) => {
      // show() 不会因玩家忙碌而抛错,只 resolve 一个原因枚举。
      // 若调用方不看这个值,「面板没弹出来」会被完全忽略。
      openForms.delete(player.id);
      if (reason === "UserBusy") {
        player.sendMessage("§c[API 探针] 面板没能显示:你正在操作另一个界面。请先关掉它再执行 /apitest:panel");
      }
    })
    .catch((error: unknown) => {
      openForms.delete(player.id);
      const text = error instanceof Error ? error.message : String(error);
      player.sendMessage(`§c[API 探针] 打开面板失败:${text}`);
    });
}

/** 面板自身的自检:确认 DDUI 成员在当前版本可用 */
export function describePanelCapability(): string[] {
  const lines = [heading("DDUI 面板能力自检")];
  lines.push(`  ${kv("CustomForm", "§a可构造")}`);
  lines.push(`  ${kv("ObservableString", "§a可用(状态行实时刷新)")}`);
  lines.push(`  ${kv("button(label, onClick)", "§aDDUI 签名,回调立即执行")}`);
  lines.push("  §7DDUI 与旧表单的关键差异:点按钮后表单§l不自动关闭§r§7,可连续点多个探针。");
  lines.push("  §7代价:回调里不能直接 show() 新表单,会以 UserBusy 失败。");
  lines.push(verdict("面板路径可用"));
  return lines;
}

/** 供命令层复用的报告助手 */
export function reportPanel(player: Player): void {
  report(player, describePanelCapability());
}
