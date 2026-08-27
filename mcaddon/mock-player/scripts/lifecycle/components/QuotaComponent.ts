// ─── 配额守卫组件 ───────────────────────────────
// 拦截创建/上线前的配额校验，抛错中断生命周期流程。
// 管理员豁免、同配额为 0=禁止、999=无限等规则委托 service/QuotaRules。
// 优先级 10：最先执行，尽早失败避免无效生成。

import { world } from "@minecraft/server";
import type { LifecycleComponent, CreateOptions } from "../LifecycleComponent";
import type { LifecycleContext } from "../LifecycleContext";
import type { BotRecord } from "../../rules/Types";
import { UNLIMITED_QUOTA } from "../../rules/Types";
import { canCreateBot, canOnlineBot, remainingOnlineQuota, remainingQuota } from "../../service/QuotaRules";

async function isAdminByName(ctx: LifecycleContext, ownerName: string): Promise<boolean> {
  if (ctx.configStore.get().admins.includes(ownerName)) return true;
  try {
    const ownerPlayer = world.getAllPlayers().find((p: any) => p.name === ownerName);
    if (ownerPlayer) {
      const { isAdmin } = await import("../../interaction/commands/auth");
      return isAdmin(ownerPlayer as any);
    }
  } catch {}
  return false;
}

export class QuotaComponent implements LifecycleComponent {
  readonly id = "quota";
  readonly priority = 10;

  private readonly ctx: LifecycleContext;

  constructor(ctx: LifecycleContext) {
    this.ctx = ctx;
  }

  async onBeforeCreate(_ctx: LifecycleContext, opts: CreateOptions): Promise<void> {
    const ownedCount = this.ctx.registry.all().filter((r) => r.ownerName === opts.ownerName).length;
    const quota = this.ctx.configStore.quotaFor(opts.ownerName);
    const isAdmin = await isAdminByName(this.ctx, opts.ownerName);
    if (!canCreateBot(ownedCount, quota, isAdmin)) {
      const left = remainingQuota(ownedCount, quota, isAdmin);
      throw new Error(`创建失败：${opts.ownerName} 的假人配额已达上限（${quota} 个）${left >= 0 ? `，剩余 ${left} 个` : ""}`);
    }
    const onlineCount = this.ctx.registry.all().filter((r) => r.ownerName === opts.ownerName && r.online).length;
    const onlineQuota = this.ctx.configStore.onlineQuotaFor(opts.ownerName);
    if (!canOnlineBot(onlineCount, onlineQuota, isAdmin)) {
      const left = remainingOnlineQuota(onlineCount, onlineQuota, isAdmin);
      const limitText = onlineQuota >= UNLIMITED_QUOTA ? "无限" : `${onlineQuota}`;
      throw new Error(`创建失败：${opts.ownerName} 同时在线已达上限（${limitText} 个）${left >= 0 ? `，剩余 ${left} 个` : ""}，请先下线部分假人`);
    }
  }

  async onBeforeOnline(_ctx: LifecycleContext, record: BotRecord): Promise<void> {
    const ownerName = record.ownerName;
    if (!ownerName) return;
    const onlineCount = this.ctx.registry.all().filter((r) => r.ownerName === ownerName && r.online).length;
    const quota = this.ctx.configStore.onlineQuotaFor(ownerName);
    const isAdmin = await isAdminByName(this.ctx, ownerName);
    if (!canOnlineBot(onlineCount, quota, isAdmin)) {
      const left = remainingOnlineQuota(onlineCount, quota, isAdmin);
      const limitText = quota >= UNLIMITED_QUOTA ? "无限" : `${quota}`;
      throw new Error(`同时在线已达上限（${limitText}个）${left >= 0 ? `，剩余 ${left} 个` : ""}，请先下线部分假人`);
    }
  }
}
