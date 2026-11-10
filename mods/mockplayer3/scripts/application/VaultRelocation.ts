// ─── 兼容物品仓归位（application） ──────────────────────────────
// 升级到支持自定义维度的版本后，把停在末地兼容锚点的假人仓迁回测试维度首选锚点。
// 一拍搬一个假人：单拍最多几十次桶读写（背包 36 格 + 装备 5 槽），拉开间隔避免堆积。
// 区块未就绪与在线假人都回队重试（上限 MIGRATE_MAX_ROUNDS 轮）：常加载挂载是异步的，
// 首次探测很可能未就绪；轮数耗尽则本轮收尾，下次启动再试（原锚点数据始终可读）。

import { clock } from "../engine/Clock";
import type { ItemVault } from "../engine/ItemVault";
import type { SaveGate } from "../engine/SaveGate";

/** 首次归位延迟（tick）：给世界加载与世界结构注册留出余量 */
const MIGRATE_START_DELAY_TICKS = 40;
/** 每个假人之间的间隔（tick） */
const MIGRATE_STEP_TICKS = 2;
/** 回队重试轮数上限（未就绪/在线都回队；耗尽则下次启动再试） */
const MIGRATE_MAX_ROUNDS = 15;

/**
 * 装配兼容物品仓归位（启动调用一次；首选锚点不可用时不做任何事）。
 * @param vault - 物品仓
 * @param saveGate - 档案读写（归位后同步 inventoryRef）
 * @param isBusy - 在线判定（在线假人的仓留到下次启动）
 */
export function installVaultRelocation(vault: ItemVault, saveGate: SaveGate, isBusy: (botId: number) => boolean): void {
  clock.after(MIGRATE_START_DELAY_TICKS, () => {
    let queue: number[] = [];
    try {
      queue = vault.fallbackBindingBotIds(isBusy);
    } catch (e: any) {
      console.error(`[mockplayer3] 兼容仓归位扫描失败：${e?.message ?? e}`);
      return;
    }
    if (queue.length === 0) return;
    const total = queue.length;
    let migratedBots = 0;
    let moved = 0;
    let skippedSlots = 0;
    let retry = 0;
    let pending: number[] = [];
    let wait = 0;
    console.info(`[mockplayer3] 兼容仓归位开始：待搬假人 ${total}（末地锚点 → 测试维度）`);
    const off = clock.onTick(() => {
      if (wait > 0) {
        wait--;
        return;
      }
      wait = MIGRATE_STEP_TICKS;
      const botId = queue.shift();
      if (botId === undefined) {
        // 一轮走完：没搬成的回队；轮数耗尽则以当前进度收尾
        if (pending.length === 0) {
          off();
          console.info(
            `[mockplayer3] 兼容仓归位结束：假人 ${migratedBots}/${total} 搬入 ${moved} 件，未搬格 ${skippedSlots}`
          );
          return;
        }
        retry++;
        if (retry > MIGRATE_MAX_ROUNDS) {
          off();
          console.warn(
            `[mockplayer3] 兼容仓归位停止：假人 ${migratedBots}/${total} 搬入 ${moved} 件，` +
              `${pending.length} 个未就绪（下次启动再试）`
          );
          return;
        }
        queue = pending;
        pending = [];
        return;
      }
      if (isBusy(botId)) {
        pending.push(botId);
        return;
      }
      try {
        const result = vault.migrateBindingToPrimary(botId);
        if (!result) {
          pending.push(botId);
          return;
        }
        migratedBots++;
        moved += result.moved;
        skippedSlots += result.skipped;
        syncRecordVaultRef(saveGate, botId, result.regionId);
      } catch (e: any) {
        pending.push(botId);
        console.error(`[mockplayer3] 兼容仓归位异常 bot=${botId}：${e?.message ?? e}`);
      }
    });
  });
}

/** 档案里的仓引用是与绑定表冗余的同一指针：归位后同步盖章，保持两者一致 */
function syncRecordVaultRef(saveGate: SaveGate, botId: number, regionId: string): void {
  const record = saveGate.loadRecord(botId);
  if (record && record.inventoryRef?.regionId !== regionId) {
    record.inventoryRef = { regionId };
    saveGate.saveRecord(record);
  }
}
