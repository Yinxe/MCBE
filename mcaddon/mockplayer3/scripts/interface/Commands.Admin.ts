// ─── 管理/测试命令组 ───────────────────────────────────────────────
// 处理器一跳翻译：admin 守卫在包装器 permission 位，世界触碰全走 engine 缝。

import { system, world } from "@minecraft/server";
import type { ItemStack } from "@minecraft/server";
import { color } from "@yinxe/toolkit";
import { ItemStorage } from "@yinxe/nbt-data-storage";
import { services } from "../Composition";
import { Param, type CommandSpec } from "./CmdKit";
import { TEST_DIMENSION, customDimensionFailure } from "../engine/Rig";
import { tickingAreas } from "../engine/TickingAreas";
import { breaker } from "../engine/Breaker";
import { botOf, rayHit } from "../engine/Atomic";
import { angler } from "../engine/Angler";
import { containerOps } from "../engine/ContainerOps";
import { RegionScanner, spotScanner } from "../engine/Scanner";
import { dimensionOf, readBlockIn } from "../engine/Atomic";
import { FISH_DIAG_MAX_STANDS, FISH_SCAN_Y_RADIUS, WATER_BLOCK_IDS, fishFailureLabel } from "../domain/FishingSpot";
import { modeSpec } from "../domain/Catalog";
import { dimensionFailureNotice } from "../domain/Compat";
import { EQUIP_SLOT_NAMES, INVENTORY_SIZE } from "../domain/Record";
import type { Vec3 } from "../domain/Coords";
import type { BreakResult } from "../engine/Breaker";

// ─── 小工具 ──

const BREAK_DISTANCE = 6;

/** 一次性破坏结果 → 中文 */
function resultLabel(result: BreakResult): string {
  switch (result) {
    case "broken":
      return `${color.success}方块已破坏`;
    case "far":
      return `${color.warn}目标超出距离（放弃）`;
    case "aborted":
      return `${color.warn}流程中止`;
    case "offline":
      return `${color.error}假人不可用`;
    case "busy":
      return `${color.warn}已有破坏进行中（拒绝重复）`;
    case "blocked":
      return `${color.warn}目标被遮挡（放弃）`;
  }
}

function coordLine(p: Vec3): string {
  return `(${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`;
}

// ─── 目录 ──

export const ADMIN_COMMANDS: CommandSpec[] = [
  {
    name: "mp:test",
    description: "传送到测试维度（默认 0 3 0，可指定坐标）",
    usage: "mp:test [坐标]",
    permission: "admin",
    args: [{ name: "location", type: Param.Location, optional: true }],
    execute: (ctx, a) => {
      let dimensionId: string;
      try {
        dimensionId = world.getDimension(TEST_DIMENSION).id;
      } catch {
        // 刚探测即失败，取成因文案让管理员看到该升到哪个版本
        const failure = customDimensionFailure();
        const notice = failure
          ? dimensionFailureNotice(failure.kind, failure.detail)
          : "测试维度不可用（未注册或加载失败）";
        ctx.say(`${color.error}${notice}`);
        return;
      }
      const loc = ctx.coord(a.location, { x: 0, y: 3, z: 0 });
      try {
        const r = services.ops.tpPlayerTo(ctx.player.name, loc, dimensionId);
        ctx.say(r.ok ? `${color.success}已传送到测试维度 ${coordLine(loc)}` : `${color.error}传送失败: ${r.reason}`);
      } catch (e: any) {
        ctx.say(`${color.error}传送失败: ${e?.message ?? e}`);
      }
    },
  },
  {
    name: "mp:chunkarea",
    description: "常加载区域管理（add 圆档 半径1~8 缺省4 / remove / list）",
    usage: "mp:chunkarea add <x> <y> <z> <name> [radius] | remove <name> | list",
    permission: "admin",
    args: [
      { name: "action", type: Param.Enum, enum: ["add", "remove", "list"] },
      // 后续位置槽保持 String：remove 只给名字，同一槽位无法既坐标又名字（引擎按位填参）
      { name: "arg1", type: Param.String, optional: true },
      { name: "arg2", type: Param.String, optional: true },
      { name: "arg3", type: Param.String, optional: true },
      { name: "arg4", type: Param.String, optional: true },
      { name: "arg5", type: Param.String, optional: true },
    ],
    execute: async (ctx, a) => {
      const action = String(a.action);
      try {
        if (action === "add") {
          const [sx, sy, sz, areaName, sRadius] = [a.arg1, a.arg2, a.arg3, a.arg4, a.arg5] as (string | undefined)[];
          if (sx === undefined || sy === undefined || sz === undefined || !areaName) {
            ctx.say(
              `${color.error}用法: /mp:chunkarea add <x> <y> <z> <name> [radius]  （即 tickingarea add circle <xyz> <radius 1~8 缺省4> <name>）`
            );
            return;
          }
          const [x, y, z] = [Number(sx), Number(sy), Number(sz)];
          if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
            ctx.say(`${color.error}坐标必须为数字: ${sx} ${sy} ${sz}`);
            return;
          }
          const radius = sRadius === undefined ? 4 : Number(sRadius);
          if (!Number.isInteger(radius) || radius < 1 || radius > 8) {
            ctx.say(`${color.error}半径需为 1~8 的整数（模拟4/6/8 常用档）: ${sRadius}`);
            return;
          }
          const dim = ctx.player.dimension;
          const res = tickingAreas.ensureManual(String(areaName), dim.id, { x, y, z }, radius);
          ctx.say(
            res.ok
              ? `${color.success}已创建模拟${radius}常加载区域 ${color.playerName}${areaName}${color.success} @ ${dim.id} ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)}（tickingarea add circle r=${radius}）`
              : `${color.error}创建常加载区域失败: ${res.reason}`
          );
        } else if (action === "remove") {
          const areaName = (a.arg1 ?? a.arg4) as string | undefined;
          if (!areaName) {
            ctx.say(`${color.error}用法: /mp:chunkarea remove <name>  （等价 tickingarea remove <name>）`);
            return;
          }
          const ok = tickingAreas.release(`mpm:${areaName}`, ctx.player.dimension.id);
          ctx.say(
            ok
              ? `${color.success}已移除常加载区域 ${color.playerName}${areaName}${color.success}（等价 tickingarea remove）`
              : `${color.error}移除常加载区域失败: 区域不存在或卸载被拒`
          );
        } else {
          const areas = world.tickingAreaManager.getAllTickingAreas();
          if (areas.length === 0) {
            ctx.say(`${color.muted}当前无本模组常加载区域（仅显示本包 TickingAreaManager 区域）`);
            return;
          }
          const lines = [`${color.success}本模组常加载区域 (${areas.length}):\n`];
          for (const ar of areas) {
            const bb = ar.boundingBox;
            lines.push(
              `${color.playerName}${ar.identifier}${color.muted} @ ${ar.dimension.id} ${bb.min.x},${bb.min.z}~${bb.max.x},${bb.max.z} ${ar.isFullyLoaded ? color.success + "已加载" : color.warn + "加载中"}`
            );
          }
          ctx.say(lines.join("\n"));
        }
      } catch (e: any) {
        ctx.say(`${color.error}常加载操作失败: ${e?.message ?? e}`);
      }
    },
  },
  {
    name: "mp:breakblock",
    description: "让假人一次性破坏一个方块（无坐标=视线方向方块；带坐标=指定方块）",
    usage: "mp:breakblock <假人> [坐标]",
    permission: "admin",
    args: [
      { name: "name", type: Param.String },
      { name: "location", type: Param.Location, optional: true },
    ],
    execute: async (ctx, a) => {
      const resolved = ctx.bot(a.name as string | undefined);
      if (!resolved) return;
      const { botId, record } = resolved;
      let target: Vec3;
      if (a.location !== undefined) {
        target = ctx.coord(a.location, ctx.player.location);
      } else {
        const entityId = services.runtime.session(botId)?.entityId;
        const bot = botOf(botId, entityId ?? undefined);
        if (!bot) {
          ctx.say(`${color.error}假人 ${color.playerName}${record.name}${color.error} 不在线`);
          return;
        }
        const hit = rayHit(bot, BREAK_DISTANCE);
        if (!hit) {
          ctx.say(`${color.warn}${record.name} 视线方向 ${BREAK_DISTANCE} 格内没有可破坏方块`);
          return;
        }
        target = hit.location;
      }
      ctx.say(
        `${color.muted}开始破坏：${color.playerName}${record.name}${color.muted} → (${Math.floor(target.x)}, ${Math.floor(target.y)}, ${Math.floor(target.z)})`
      );
      try {
        const result = await breaker.breakAt(botId, target, { maxDistance: BREAK_DISTANCE, skipLook: false });
        ctx.say(`${color.accent}[模拟玩家][破坏] ${color.playerName}${record.name} ${resultLabel(result)}`);
      } catch (e: any) {
        ctx.say(`${color.error}[模拟玩家][破坏] ${record.name} 流程异常: ${e?.message ?? e}`);
      }
    },
  },
  {
    name: "mp:storage",
    description: "查看假人 NBT 存储绑定与实存物品（调试）",
    usage: "mp:storage <假人名>",
    permission: "admin",
    args: [{ name: "name", type: Param.String, optional: true }],
    execute: (ctx, a) => {
      const nameInput = (a.name as string | undefined)?.trim() ?? "";
      if (!nameInput) {
        ctx.say(`${color.error}用法: /mp:storage <假人名>`);
        return;
      }
      const resolved = ctx.bot(nameInput);
      if (!resolved) return;
      const { botId, record } = resolved;
      const lines: string[] = [
        `${color.gold}===== ${color.playerName}${record.name} ${color.gold}Storage 绑定调试 =====`,
      ];
      const binding = services.vault.getBinding(botId);
      if (!binding) {
        lines.push(`${color.muted}未绑定任何存储槽位（绑定表不存在）——从未保存过物品`);
      } else {
        lines.push(`${color.muted}存储区域: ${color.info}${binding.regionId}`);
        // 区块态与滞留项分别报出：区分"读不到"与"没存过"
        lines.push(
          services.ops.vaultReadable(botId)
            ? `${color.muted}区块状态: ${color.success}可读可写`
            : `${color.muted}区块状态: ${color.error}未加载（上线/回收会改期，物品暂存内存）`
        );
        const pending = services.ops.pendingExportList().find((p) => p.botId === botId);
        if (pending) lines.push(`${color.error}滞留导出: ${pending.items} 件待补写`);
        const inv = services.vault.readInventory(botId);
        lines.push(`${color.muted}━━ 背包绑定（${INVENTORY_SIZE} 格） ━━`);
        for (let i = 0; i < INVENTORY_SIZE; i++) {
          const label = i < 9 ? `快捷${i}` : `背包${i - 9}`;
          const sid = binding.inv[String(i)];
          if (sid === undefined) {
            lines.push(` ${color.muted}${label}: ${color.darkGray}[未绑定]`);
          } else {
            const actual = inv?.[i];
            lines.push(
              ` ${color.muted}${label}: ${color.accent}slot#${sid} ${color.muted}→ ${actual ? `${color.info}${itemDesc(actual)}` : `${color.darkGray}[占位/空]`}`
            );
          }
        }
        const equip = services.vault.readEquipment(botId);
        lines.push(`${color.muted}━━ 装备绑定 ━━`);
        for (const slot of EQUIP_SLOT_NAMES) {
          const sid = binding.equip[slot];
          if (sid === undefined) {
            lines.push(` ${color.muted}${slot}: ${color.darkGray}[未绑定]`);
          } else {
            const actual = equip?.[slot];
            lines.push(
              ` ${color.muted}${slot}: ${color.accent}slot#${sid} ${color.muted}→ ${actual ? `${color.info}${itemDesc(actual)}` : `${color.darkGray}[占位/空]`}`
            );
          }
        }
      }
      lines.push(`${color.muted}━━ 存储区域总览 ━━`);
      try {
        const stats = ItemStorage.totalStats();
        lines.push(
          ` ${color.muted}区域数: ${color.info}${stats.regionCount} ${color.muted}容量: ${color.info}${stats.totalCapacity} ${color.muted}已用: ${color.info}${stats.totalUsed}`
        );
      } catch (e: any) {
        lines.push(`${color.muted}存储区域统计失败: ${color.error}${e?.message ?? e}`);
      }
      lines.push(`${color.gold}============================`);
      for (const l of lines) ctx.say(l);
    },
  },
  {
    name: "mp:fishspot",
    description: "寻找钓鱼点（默认以玩家为中心半径 16；可指定坐标与半径）",
    usage: "mp:fishspot [坐标] [半径]",
    permission: "admin",
    args: [
      { name: "location", type: Param.Location, optional: true },
      { name: "radius", type: Param.Integer, optional: true },
    ],
    execute: (ctx, a) => {
      const rawR = Number(a.radius);
      const radius = Number.isFinite(rawR) ? Math.max(1, Math.floor(rawR)) : 16;
      const center = ctx.coord(a.location, ctx.player.location);
      const dimId = ctx.player.dimension.id;
      ctx.say(`${color.muted}[模拟玩家][钓鱼] 开始搜索钓鱼点（半径 ${color.info}${radius}${color.muted}）…`);
      const rect = {
        min: {
          x: Math.floor(center.x) - radius,
          y: Math.max(-64, Math.floor(center.y) - FISH_SCAN_Y_RADIUS),
          z: Math.floor(center.z) - radius,
        },
        max: {
          x: Math.floor(center.x) + radius,
          y: Math.min(320, Math.floor(center.y) + FISH_SCAN_Y_RADIUS),
          z: Math.floor(center.z) + radius,
        },
      };
      system.run(() => {
        // 诊断扫描逐 tick 喂一片（约 10ms/片），整卷一次查会卡顿一帧以上
        const scanner = new RegionScanner(dimId, rect, WATER_BLOCK_IDS);
        const water: Vec3[] = [];
        const report = (): void => {
          if (!scanner.ok) {
            ctx.say(`${color.error}未找到钓鱼点：水面采集失败（区块未加载？半径过大？），缩小半径或进加载区后重试`);
            return;
          }
          if (water.length === 0) {
            ctx.say(`${color.error}未找到钓鱼点：范围内没有水面`);
            return;
          }
          const spots = spotScanner.composeSpots(dimId, water, center, FISH_DIAG_MAX_STANDS);
          if (spots.length === 0) {
            ctx.say(`${color.error}未找到钓鱼点：有水面但没有满足条件的钓鱼点`);
            return;
          }
          const lines = [
            `${color.accent}[模拟玩家][钓鱼] ${color.success}找到 ${spots.length} 个钓鱼点（中心 (${Math.floor(center.x)}, ${Math.floor(center.y)}, ${Math.floor(center.z)})，半径 ${radius}）：`,
          ];
          for (let i = 0; i < Math.min(10, spots.length); i++) {
            const s = spots[i];
            const dist = Math.round(Math.hypot(s.stand.x - center.x, s.stand.y - center.y, s.stand.z - center.z));
            lines.push(
              `${color.muted}${i + 1}. ${color.playerName}站立(${s.stand.x}, ${s.stand.y}, ${s.stand.z})${color.muted} 距离${dist} ${color.accent}${s.aim.level}星`
            );
            lines.push(
              `${color.muted}    支撑(${s.stand.x}, ${s.stand.y - 1}, ${s.stand.z}) 瞄准(${s.aim.target.x}, ${s.aim.target.y}, ${s.aim.target.z})`
            );
            lines.push(
              `${color.muted}    水面: ${waterListLabel(dimId, { x: s.stand.x, y: s.stand.y - 1, z: s.stand.z })}`
            );
          }
          if (spots.length > 10) lines.push(`${color.muted}…共 ${spots.length} 个（按星级+距离排序）`);
          ctx.say(lines.join("\n"));
        };
        const stepScan = (): void => {
          try {
            for (const hit of scanner.step(8192)) water.push(hit);
            if (!scanner.done) {
              system.run(stepScan);
              return;
            }
            report();
          } catch (e: any) {
            ctx.say(`${color.error}未找到钓鱼点：扫描异常 ${e?.message ?? e}`);
          }
        };
        stepScan();
      });
    },
  },
  {
    name: "mp:fish",
    description: "让假人完成一次钓鱼（抛竿→稳定→监听上钩→收竿）",
    usage: "mp:fish <假人>",
    permission: "admin",
    args: [{ name: "name", type: Param.String }],
    execute: async (ctx, a) => {
      const botName = String(a.name ?? "").trim();
      // 测试命令只查记录存在，不做归属守卫
      const botId = services.runtime.findBotIdByName(botName);
      if (botId === undefined) {
        ctx.say(`${color.error}未找到假人 ${color.playerName}${botName}${color.error} 的记录`);
        return;
      }
      // 在位能力与本诊断争用同一钓竿，先拒绝执行
      const activeCap = services.runtime.session(botId)?.capability;
      if (activeCap) {
        ctx.say(
          `${color.error}假人 ${color.playerName}${botName}${color.error} 正在运行「${modeSpec(activeCap.mode).label}」，请先切回空闲再执行钓鱼诊断`
        );
        return;
      }
      ctx.say(`${color.muted}开始钓鱼：${color.playerName}${botName}${color.muted}（抛竿中…）`);
      try {
        const outcome = await angler.fishOnce(botId);
        const detail =
          outcome.result === "caught"
            ? `${color.success}钓到鱼，收竿完成！`
            : outcome.result === "timeout"
              ? `${color.warn}等待 45 秒无鱼上钩，超时收竿`
              : `${color.error}钓鱼失败：${fishFailureLabel(outcome.reason)}`;
        ctx.say(`${color.accent}[模拟玩家][钓鱼] ${color.playerName}${botName} ${detail}`);
      } catch (e: any) {
        ctx.say(`${color.error}[模拟玩家][钓鱼] ${botName} 流程异常: ${e?.message ?? e}`);
      }
    },
  },
  {
    name: "mp:container",
    description: "测试：假人与指定容器互换前 27 格（箱子/木桶/潜影盒）",
    usage: "mp:container <假人> <坐标>",
    permission: "admin",
    args: [
      { name: "name", type: Param.String },
      { name: "location", type: Param.Location },
    ],
    execute: async (ctx, a) => {
      const botName = String(a.name ?? "").trim();
      const botId = services.runtime.findBotIdByName(botName);
      if (botId === undefined) {
        ctx.say(`${color.error}未找到假人 ${color.playerName}${botName}${color.error} 的记录`);
        return;
      }
      const raw = ctx.coord(a.location, ctx.player.location);
      const pos: Vec3 = { x: Math.floor(raw.x), y: Math.floor(raw.y), z: Math.floor(raw.z) };
      ctx.say(
        `${color.muted}容器互换开始：${color.playerName}${botName}${color.muted} ↔ (${pos.x}, ${pos.y}, ${pos.z})`
      );
      try {
        const result = await containerOps.swapSlots(botId, ctx.player.dimension.id, pos, SWAP_SLOTS);
        ctx.say(
          result === "ok"
            ? `${color.accent}[模拟玩家][容器] ${color.success}${botName} 与容器互换 ${SWAP_SLOTS} 格完成`
            : `${color.error}[模拟玩家][容器] ${botName} 互换失败：${containerResultLabel(result)}`
        );
      } catch (e: any) {
        ctx.say(`${color.error}[模拟玩家][容器] ${botName} 互换异常: ${e?.message ?? e}`);
      }
    },
  },
  {
    name: "mp:migrate",
    description: "迁移归档 mock-player 旧数据为 v2（记录/全局配置/旧物品键；名字索引幂等、可重跑；失败保留旧键）",
    usage: "mp:migrate",
    permission: "admin",
    execute: (ctx) => {
      const rep = services.migrator.run();
      if (rep.aborted) {
        ctx.say(`${color.error}[迁移] ${rep.aborted}`);
        return;
      }
      if (rep.found === 0 && !rep.configMigrated && rep.sweptItemKeys === 0 && rep.itemSlots.pending === 0) {
        ctx.say(`${color.muted}[迁移] 未检出旧版数据（记录/配置/物品），无需迁移`);
        return;
      }
      // 会话中途建档：迁出记录直接挂入内存（与重启对账路互不依赖）
      for (const m of rep.migrated) services.runtime.records.set(m.botId, m.record);
      if (rep.configMigrated) services.runtime.config = services.saveGate.loadConfig(); // 迁入配置即时生效
      ctx.say(
        `${color.accent}[迁移] 检出旧记录 ${rep.found}：${color.success}迁入 ${rep.migrated.length}` +
          (rep.skipped.length > 0 ? `${color.muted} 跳过 ${rep.skipped.length}` : "") +
          (rep.failures.length > 0 ? `${color.error} 失败 ${rep.failures.length}` : "") +
          (rep.itemSlots.migrated > 0 || rep.itemSlots.dropped > 0 || rep.sweptItemKeys > 0
            ? `${color.muted}｜旧物品迁入 ${rep.itemSlots.migrated} 格（坏数据弃 ${rep.itemSlots.dropped}、残留清扫 ${rep.sweptItemKeys}）`
            : "") +
          (rep.itemSlots.pending > 0
            ? `${color.warn}｜旧物品 ${rep.itemSlots.pending} 格原样保留（当前版本读不到测试维度仓，升级后重启再迁）`
            : "") +
          (rep.configMigrated ? `${color.muted}｜全局配置已迁入 mp:config` : "")
      );
      for (const n of rep.configNotices) ctx.say(` ${color.warn}· 配置: ${n}`);
      for (const m of rep.migrated) {
        ctx.say(
          ` ${color.success}✔ ${color.playerName}${m.name}${color.muted} → bot#${m.botId}` +
            (m.record.declaredOnline ? "（声明在线，/mp:online 逐个上线）" : "")
        );
        for (const n of m.notices) ctx.say(`    ${color.warn}· ${n}`);
      }
      for (const s of rep.skipped) ctx.say(` ${color.muted}⏭ ${s}（v2 已存在，幂等跳过）`);
      for (const f of rep.failures) ctx.say(` ${color.error}✘ ${f.legacyName}: ${f.error}（保留旧键）`);
    },
  },
];

/** 容器互换测试的格子数上限（容器可能只有 27 格，取小者） */
const SWAP_SLOTS = 27;

function containerResultLabel(result: "offline" | "not-container" | "unreadable"): string {
  switch (result) {
    case "offline":
      return "假人不在线";
    case "not-container":
      return "目标不是容器（箱子/木桶/潜影盒）";
    default:
      return "执行异常";
  }
}

/** 站位邻域水面实况（诊断展示 ≤4 格+溢出计数）；口径同 SpotScanner.checkStand：
 * 支撑层先查、零命中再下探一层，站位层是空气不查
 */
function waterListLabel(dimId: string, stand: Vec3): string {
  const dim = dimensionOf(dimId);
  if (!dim) return `${color.muted}不可读`;
  for (const drop of [1, 2]) {
    const cell = { x: stand.x, y: stand.y - drop, z: stand.z };
    const shown: string[] = [];
    let total = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const p = { x: cell.x + dx, y: cell.y, z: cell.z + dz };
        const info = readBlockIn(dim, p);
        if (info && WATER_BLOCK_IDS.includes(info.id)) {
          total++;
          if (shown.length < 4) shown.push(`${p.x} ${p.y} ${p.z}`);
        }
      }
    }
    if (total > 0) return `${shown.join("  ")}${total > 4 ? ` …×${total}` : ""}`;
  }
  return `${color.muted}（邻域水面不可读）`;
}

/** 物品简述：短id ×数量 耐久damage值 名称引号（耐久经组件读取，非直读属性） */
function itemDesc(item: ItemStack): string {
  let s = item.typeId.replace("minecraft:", "");
  if (item.amount > 1) s += `×${item.amount}`;
  const dur = item.getComponent("minecraft:durability");
  if (dur) s += ` 耐久${dur.damage}`;
  if (item.nameTag) s += ` "${item.nameTag}"`;
  return s;
}
