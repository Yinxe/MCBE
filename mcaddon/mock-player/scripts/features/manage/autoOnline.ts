// DEPRECATED: 已内聚至 lifecycle/components/AutoOnlineComponent.onWorldLoad，worldLoad 不再直接调用 initAutoOnline。

// ─── 世界加载自动上线（组件化） ─────────────
// 职责不变：worldLoad 后对仍标记在线的假人异步重建实体。
// 现通过 BotLifecycle 统一入口（队列 + 组件），不再直调 safeOnline。
// 等待 GameTest 就绪后再排队，避免全量走 test 时回退。

import { system } from "@minecraft/server";

import { botRegistry, botLifecycle, saveCoordinator } from "../../bootstrap/context";

export async function initAutoOnline(): Promise<void> {
  const toAutoOnline = botRegistry.all().filter((r) => r.online && !r.death && !r.entityId);
  if (toAutoOnline.length === 0) return;

  console.info(
    `[MockPlayer] 世界重启自动上线 ${toAutoOnline.length} 个假人（等待 GameTest 就绪后编排器排队，组件化）`
  );
  await new Promise<void>((res) => system.runTimeout(res, 60));
  for (const r of toAutoOnline) {
    try {
      const res = await botLifecycle.online(r);
      if (!res.ok) {
        console.warn(`[MockPlayer] 自动上线失败 ${r.name}: ${res.reason}，已置为离线`);
        try {
          r.online = false;
          (r as any).entityId = undefined;
          saveCoordinator.saveRecord(r);
        } catch {}
      } else {
        console.info(`[MockPlayer] 自动上线成功 ${r.name}`);
      }
    } catch (e: any) {
      console.warn(`[MockPlayer] 自动上线异常 ${r.name}: ${e?.message ?? e}`);
      try {
        r.online = false;
        (r as any).entityId = undefined;
        saveCoordinator.saveRecord(r);
      } catch {}
    }
    await new Promise<void>((resolve) => system.runTimeout(resolve, 2));
  }
}
