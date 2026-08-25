// ─── 世界加载自动上线（事件驱动） ─────────────────
// 职责：worldLoad 后对 restore 后仍标记在线的假人异步重建实体
//   仅对在线存活的记录生效；在线死亡且有自动重生的已在 restore 阶段转为在线存活
//   等待 GameTest 就绪（40t 装置延迟 + ticking 创建）再开始，避免全量走 test 时回退模块
// 由 main.ts worldLoad 阶段调用 initAutoOnline() 触发，不在 main 内联业务逻辑

import { system } from "@minecraft/server";

import { botRegistry, saveCoordinator } from "../../bootstrap/context";

export async function initAutoOnline(): Promise<void> {
  const toAutoOnline = botRegistry.all().filter((r) => r.online && !r.death && !r.entityId);
  if (toAutoOnline.length === 0) return;

  console.info(
    `[MockPlayer] 世界重启自动上线 ${toAutoOnline.length} 个假人（等待 GameTest 就绪后排队，safeOnline 内置冷却与模拟4）`
  );
  // 等待 GameTest 装置就绪（最长 80t，够 40t 注册 + 4 区块 ticking 加载）
  await new Promise<void>((res) => system.runTimeout(res, 60));
  const { safeOnline } = await import("./onlineBot");
  for (const r of toAutoOnline) {
    try {
      const res = await safeOnline(r);
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
    // 避免一次性大量生成阻塞（2tick 让步）
    await new Promise<void>((resolve) => system.runTimeout(resolve, 2));
  }
}
