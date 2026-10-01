// ─── 名字守卫组件 ───────────────────────────────
// 创建前校验：规范化名与世界中真人/在线假人重名则中断。
// 优先级 11：紧随配额之后、生成之前。

import type { LifecycleComponent, CreateOptions } from "../LifecycleComponent";
import type { LifecycleContext } from "../LifecycleContext";

export class NameGuardComponent implements LifecycleComponent {
  readonly id = "nameGuard";
  readonly priority = 11;

  async onBeforeCreate(_ctx: LifecycleContext, opts: CreateOptions): Promise<void> {
    let isNameOccupiedInWorld: (name: string) => boolean;
    try {
      const mod = await import("../../bot/PlayerGateway");
      isNameOccupiedInWorld = mod.isNameOccupiedInWorld;
    } catch {
      return;
    }

    if (opts.rawName.trim() !== opts.name && isNameOccupiedInWorld(opts.rawName.trim())) {
      throw new Error(`名字 ${opts.rawName.trim()} 与真实玩家相同，请更换名字`);
    }
    if (isNameOccupiedInWorld(opts.name)) {
      throw new Error(`世界中已存在同名玩家实体 ${opts.name}，请更换名字`);
    }
  }
}
