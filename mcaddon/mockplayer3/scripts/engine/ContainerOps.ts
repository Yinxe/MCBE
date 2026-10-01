// ─── 容器直读直写复合器（组件路径，永不发右键） ─────────────────────
// F-12：右键开箱的 lid 动画 IsOpened 不复位，开箱态不可靠——箱/桶/潜影盒等
// 带 minecraft:inventory 组件的方块一律组件直读写。
// F-13 写节拍（勿改序）：先操作、后 await 2t 再回读——await 先行会让漏斗在
// 在等待期间插队，会读到被抢走的槽位并造成 setItem 覆盖竞态；纯读无副作用不受此限。
// transferItem 走原生（自动找空槽+清源槽，比手动 setItem 少一步覆盖风险）；
// 回读不符重试一轮，仍不符计入 failed 上报，调用方决策。

import type { Container, ItemStack } from "@minecraft/server";
import type { Vec3 } from "../domain/Coords";
import type { SlotDigest } from "../domain/Fingerprint";
import { blockFloor, botOf, botValid, dimensionOf, inventoryContainer, sleepTicks } from "./Atomic";
import type { CancelToken } from "../domain/Cancellation";
import { gaze } from "./Gaze";
import { inventoryChanged } from "./Hooks";

/** 写操作入口看向容器中心（保留扭头行为；AIM_ONCE 执行即中性化，F-06） */
function aimAtContainer(botId: number, loc: Vec3): void {
  const cell = blockFloor(loc);
  gaze.aimOnce(botId, { x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 });
}

/** 写后回读等待（tick，F-13 节拍） */
const SETTLE_TICKS = 2;

export interface MoveReport {
  /** 成功搬移的源槽（deposit=假人槽；withdraw=容器槽） */
  moved: number[];
  /** 校验失败（含被抢/目标满） */
  failed: number[];
  /** 未执行（目标不可用等） */
  aborted: boolean;
}

const EMPTY_REPORT: MoveReport = { moved: [], failed: [], aborted: true };

/** 方块容器取句柄（未加载/非容器 undefined——readContents 再细分） */
function containerOf(dimId: string, loc: Vec3): Container | undefined {
  const cell = blockFloor(loc);
  const dim = dimensionOf(dimId);
  if (!dim) return undefined;
  try {
    const block = dim.getBlock({ x: cell.x, y: cell.y, z: cell.z });
    if (!block) return undefined;
    return block.getComponent("minecraft:inventory")?.container;
  } catch {
    return undefined;
  }
}

/** 该格是否确定存在且无容器组件（区分"不可读"与"不是容器"） */
function isPlainBlock(dimId: string, loc: Vec3): boolean {
  const cell = blockFloor(loc);
  const dim = dimensionOf(dimId);
  if (!dim) return false;
  try {
    const block = dim.getBlock({ x: cell.x, y: cell.y, z: cell.z });
    return block !== undefined && !block.getComponent("minecraft:inventory");
  } catch {
    return false;
  }
}

function digestAt(container: Container, i: number): SlotDigest | null {
  let item;
  try {
    item = container.getItem(i);
  } catch {
    return null;
  }
  return item ? { typeId: item.typeId, amount: item.amount } : null;
}

function sameDigest(a: SlotDigest | null, b: SlotDigest | null): boolean {
  if (!a || !b) return !a && !b;
  return a.typeId === b.typeId && a.amount === b.amount;
}

function containerHas(container: Container, want: SlotDigest): boolean {
  for (let i = 0; i < container.size; i++) {
    if (sameDigest(digestAt(container, i), want)) return true;
  }
  return false;
}

export class ContainerOps {
  /**
   * 容器内容探测（面板/能力选靶用）。
   * @returns items=内容指纹表；"not-container"=确定非容器；"unreadable"=区块/组件暂不可读
   */
  readContents(dimId: string, loc: Vec3): { items: SlotDigest[]; size: number } | "not-container" | "unreadable" {
    const container = containerOf(dimId, loc);
    if (!container) return isPlainBlock(dimId, loc) ? "not-container" : "unreadable";
    const items: SlotDigest[] = [];
    for (let i = 0; i < container.size; i++) {
      const d = digestAt(container, i);
      if (d) items.push(d);
    }
    return { items, size: container.size };
  }

  /** 存入：假人背包槽 → 方块容器（先操作后验，被抢重试一轮） */
  async deposit(botId: number, dimId: string, loc: Vec3, invSlots: number[], token?: CancelToken): Promise<MoveReport> {
    return this.move(botId, dimId, loc, invSlots, "deposit", token);
  }

  /** 取出：方块容器槽 → 假人背包（同节拍同重试策略） */
  async withdraw(
    botId: number,
    dimId: string,
    loc: Vec3,
    blockSlots: number[],
    token?: CancelToken
  ): Promise<MoveReport> {
    return this.move(botId, dimId, loc, blockSlots, "withdraw", token);
  }

  /**
   * 前 count 格双侧同槽互换（/mp:container 测试缝）：逐格 setItem 对调
   * （transferItem 会打乱目标槽位）；写后 2t 回读节拍（F-13）；单格失败跳过不中断整批。
   */
  async swapSlots(
    botId: number,
    dimId: string,
    loc: Vec3,
    count: number
  ): Promise<"ok" | "offline" | "not-container" | "unreadable"> {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return "offline";
    const botC = inventoryContainer(bot);
    const blockC = containerOf(dimId, loc);
    if (!blockC) return isPlainBlock(dimId, loc) ? "not-container" : "unreadable";
    if (!botC) return "offline";
    const n = Math.min(count, botC.size, blockC.size);
    for (let i = 0; i < n; i++) {
      let a: ItemStack | undefined;
      let b: ItemStack | undefined;
      try {
        a = botC.getItem(i) ?? undefined;
        b = blockC.getItem(i) ?? undefined;
      } catch {
        continue;
      }
      try {
        if (b) botC.setItem(i, b);
        else botC.setItem(i, undefined);
        if (a) blockC.setItem(i, a);
        else blockC.setItem(i, undefined);
      } catch {
        continue;
      }
      await sleepTicks(SETTLE_TICKS); // 操作在前、等待在后（F-13）
    }
    inventoryChanged(botId);
    return "ok";
  }

  // ─── 私有 ──

  private async move(
    botId: number,
    dimId: string,
    loc: Vec3,
    slots: number[],
    dir: "deposit" | "withdraw",
    token?: CancelToken
  ): Promise<MoveReport> {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return { ...EMPTY_REPORT };
    const botContainer = inventoryContainer(bot);
    const blockContainer = containerOf(dimId, loc);
    if (!botContainer || !blockContainer) return { ...EMPTY_REPORT };
    if (slots.length === 0) return { moved: [], failed: [], aborted: false };
    aimAtContainer(botId, loc); // 面向容器再动手
    const src = dir === "deposit" ? botContainer : blockContainer;
    const dest = dir === "deposit" ? blockContainer : botContainer;
    const report: MoveReport = { moved: [], failed: [], aborted: false };
    let pending = [...slots];
    for (let round = 0; round < 2 && pending.length > 0; round++) {
      const expected = new Map<number, SlotDigest | null>();
      for (const slot of pending) {
        const before = digestAt(src, slot);
        if (!before) {
          expected.set(slot, null); // 源槽本就空——按"已搬走"核（上轮被抢后置成对源空判）
          continue;
        }
        expected.set(slot, before);
        try {
          src.transferItem(slot, dest); // 原生搬运：自动寻空+清源
        } catch {
          expected.set(slot, null);
          report.failed.push(slot);
        }
      }
      await sleepTicks(SETTLE_TICKS, token); // 操作在前、等待在后（F-13）
      if (token?.cancelled) {
        for (const slot of pending) {
          if (!report.moved.includes(slot) && !report.failed.includes(slot)) report.failed.push(slot);
        }
        report.aborted = true;
        return report;
      }
      const retry: number[] = [];
      for (const slot of pending) {
        const want = expected.get(slot) ?? null;
        if (want === null) {
          if (!digestAt(src, slot)) report.moved.push(slot);
          else report.failed.push(slot);
          continue;
        }
        const srcCleared = !digestAt(src, slot);
        const destGot = containerHas(dest, want);
        if (srcCleared && destGot) report.moved.push(slot);
        else if (round === 0)
          retry.push(slot); // 被抢/满——重试一轮
        else report.failed.push(slot);
      }
      pending = retry;
    }
    if (report.moved.length > 0) inventoryChanged(botId);
    return report;
  }
}

/** 进程级单例 */
export const containerOps = new ContainerOps();
