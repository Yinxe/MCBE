// ─── 模组配置 UI：信物/全局开关/速度上限/全服统计（仅管理员可进） ──
// 由 MainMenu 的 OP（canManage）入口打开。全局配置写穿 McModConfig（单键 ir2:modcfg），
// 运行时立即应用到 RouteService（setGlobalEnabled/setGlobalSpeedLimit）。
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import type { WarehouseSpec } from "../../core/services/WarehouseService";
import { TOKEN_OPTIONS } from "../storage/McModConfig";
import * as uiColor from "./uiColor";

/** 全局速度上限可选项（tick/槽）；默认 index 1 = 8 tick */
const SPEED_OPTIONS: number[] = [4, 8, 16, 20, 30, 40];
/** 单仓最大规格预置项（v1 口径：各轴最大边长**规格**，非体积格数；默认 index 1 = 32×16×32） */
const SPEC_OPTIONS: WarehouseSpec[] = [
  { x: 16, y: 8, z: 16 },
  { x: 32, y: 16, z: 32 },
  { x: 48, y: 16, z: 48 },
  { x: 64, y: 32, z: 64 },
];
/** 单仓最大容器数可选项（v1 ConfigUI 同款：50/100推荐/200/512） */
const CONTAINER_OPTIONS: number[] = [50, 100, 200, 512];

/**
 * 展示模组配置面板（管理员专属）：当前状态总览 + 修改 + 全服统计。
 *
 * @param player - 打开面板的玩家
 * @param deps   - 命令共享依赖门面
 */
export async function showConfigUI(player: Player, deps: CommandDeps): Promise<void> {
  // 按钮文字深色（ActionForm 浅灰按钮背景）
  const form = new ActionFormBuilder()
    .title(`${uiColor.form.title}模组配置`)
    .body(
      [
        `${uiColor.form.muted}全局分拣：${deps.config.globalEnabled ? uiColor.form.success + "开启" : uiColor.form.error + "关闭"}`,
        `${uiColor.form.muted}速度上限：${uiColor.form.body}${deps.config.globalSpeedLimit} tick/槽`,
        `${uiColor.form.muted}信物：${uiColor.form.body}${deps.config.tokenItemId}`,
      ].join("\n")
    )
    .button(`${uiColor.btn.primary}修改设置`, () => void editConfig(player, deps))
    .button(`${uiColor.btn.info}全服统计`, () => void serverStats(player, deps));
  await form.show(player);
}

/** 修改全局配置的表单：全局开关 / 更换信物 / 速度上限 / 建仓限制；保存即写穿 + 运行时生效 */
async function editConfig(player: Player, deps: CommandDeps): Promise<void> {
  const tokenIndex = Math.max(0, TOKEN_OPTIONS.indexOf(deps.config.tokenItemId));
  const speedIndex = Math.max(0, SPEED_OPTIONS.indexOf(deps.config.globalSpeedLimit));
  const spec = deps.config.maxWarehouseSpec;
  const specIndex = Math.max(
    0,
    SPEC_OPTIONS.findIndex((s) => s.x === spec.x && s.y === spec.y && s.z === spec.z)
  );
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}修改配置`)
    .toggle("globalEnabled", "全局分拣", { defaultValue: deps.config.globalEnabled })
    .dropdown("token", "信物", TOKEN_OPTIONS, { defaultValueIndex: tokenIndex })
    .dropdown(
      "speed",
      "全局最快速度限制",
      SPEED_OPTIONS.map((s) => `最快 ${s} tick`),
      {
        defaultValueIndex: speedIndex >= 0 ? speedIndex : 1,
        tooltip: "全服最快分拣速度：快于该值（tick 更小）的仓库将被强制降到此速度，合规仓库不动",
      }
    )
    .dropdown(
      "maxSpec",
      "单仓最大规格",
      SPEC_OPTIONS.map((s) => `${s.x}×${s.y}×${s.z}`),
      {
        defaultValueIndex: specIndex,
        tooltip: "限制单个仓库最大规格（各轴最大边长 X×Y×Z，任一轴超限即拒绝）",
      }
    )
    .dropdown(
      "maxContainers",
      "单仓最大容器数",
      CONTAINER_OPTIONS.map((c) => `${c} 个`),
      {
        defaultValueIndex: Math.max(0, CONTAINER_OPTIONS.indexOf(deps.config.maxContainers)),
        tooltip: "限制每仓最多容器数（建仓/重扫/放置时校验）",
      }
    )
    .slider("maxWarehouses", "每玩家最多仓库数", 1, 5, {
      defaultValue: deps.config.maxWarehousesPerPlayer,
      valueStep: 1,
      tooltip: "限制玩家可创建的仓库数量",
    });
  const values = await form.show(player);
  if (!values) return;
  const maxSpec = SPEC_OPTIONS[values.maxSpec as number] ?? { x: 32, y: 16, z: 32 };
  const maxContainers = CONTAINER_OPTIONS[values.maxContainers as number] ?? 100;
  const maxWarehouses = values.maxWarehouses as number;
  deps.route.setGlobalEnabled(values.globalEnabled as boolean);
  const newSpeedLimit = SPEED_OPTIONS[values.speed as number] ?? deps.config.globalSpeedLimit;
  deps.config.setGlobalSpeedLimit(newSpeedLimit);
  deps.route.setGlobalSpeedLimit(newSpeedLimit); // 运行时立即生效（Scheduler 违规降速 + 重建 interval）
  // 违规（快于新上限）的仓库速度降到上限并**持久化**（v1 同款：遍历已加载仓库整改）
  for (const w of deps.loadedWarehouses()) {
    if (w.settings.processingSpeed < newSpeedLimit)
      deps.warehouses.updateSettings(w, { processingSpeed: newSpeedLimit });
  }
  deps.config.setTokenItemId(TOKEN_OPTIONS[values.token as number] ?? TOKEN_OPTIONS[0]!);
  deps.config.setMaxWarehouseSpec(maxSpec);
  deps.config.setMaxWarehousesPerPlayer(maxWarehouses);
  deps.config.setMaxContainers(maxContainers);
  deps.warehouses.setLimits({ maxSpec, maxWarehousesPerPlayer: maxWarehouses }); // 建仓限制立即生效
  player.sendMessage(`${uiColor.chat.success}配置已保存`);
}

/** 全服统计汇总：仓库/容器/物品总数 + 按玩家排名（v1 ConfigUI 同款：名字: N仓 N箱） */
function serverStats(player: Player, deps: CommandDeps): void {
  const warehouses = deps.loadedWarehouses();
  // 按玩家聚合（ownerName → 仓数/箱数）；统计是容器内容派生 → 逐仓按需加载容器
  const perPlayer = new Map<string, { name: string; warehouses: number; containers: number }>();
  let totalContainers = 0;
  let totalItems = 0;
  for (const w of warehouses) {
    deps.ensureContainersLoaded(w); // 仓库可能未激活 → 容器按需加载后统计才准确
    const s = deps.stats.getWarehouseStats(w);
    totalContainers += s.containerCount;
    totalItems += s.totalItems;
    const entry = perPlayer.get(w.ownerName) ?? { name: w.ownerName, warehouses: 0, containers: 0 };
    entry.warehouses++;
    entry.containers += s.containerCount;
    perPlayer.set(w.ownerName, entry);
  }

  const lines: string[] = [
    `${uiColor.chat.warn}=== 全服统计 ===`,
    `${uiColor.chat.muted}仓库总数: ${uiColor.chat.info}${warehouses.length}`,
    `${uiColor.chat.muted}容器总数: ${uiColor.chat.info}${totalContainers}`,
    `${uiColor.chat.muted}物品总数: ${uiColor.chat.info}${totalItems}`,
    `${uiColor.chat.muted}玩家数: ${uiColor.chat.info}${perPlayer.size}`,
    ``,
    `${uiColor.chat.warn}玩家排名（按仓库数）:`,
  ];
  for (const p of [...perPlayer.values()].sort((a, b) => b.warehouses - a.warehouses)) {
    lines.push(
      `  ${uiColor.chat.muted}${p.name}: ${uiColor.chat.info}${p.warehouses}${uiColor.chat.muted}仓 ${uiColor.chat.info}${p.containers}${uiColor.chat.muted}箱`
    );
  }
  player.sendMessage(lines.join("\n"));
}
