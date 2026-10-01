// ─── 事件播报渲染器（领域事件 → 中文广播，零逻辑） ──────────────────
// 重连抑制"离开了游戏"，"加入了游戏"不抑制；命令下线/主人离开下线无全服播报。

import { world } from "@minecraft/server";
import { color } from "@yinxe/toolkit";
import { auxChunkCovered } from "../domain/Config";
import { dimensionLabel } from "../domain/Format";
import { services } from "../Composition";

const PREFIX = `${color.muted}[${color.success}假人${color.muted}] `;

/** 全服播报；sendMessage 可能抛，吞异常保证事件链不断 */
function announce(text: string): void {
  try {
    world.sendMessage(text);
  } catch {
    /* 广播失败不影响业务 */
  }
}

/**
 * 安装事件播报订阅（装配末尾调用一次）。
 * @returns 全量退订函数
 */
export function installNotify(): () => void {
  const offs: (() => void)[] = [];
  offs.push(
    services.events.on("botOnline", ({ name }) => {
      announce(`${PREFIX}${color.success}${name} 加入了游戏`);
    })
  );
  offs.push(
    services.events.on("botOffline", ({ name, cause }) => {
      if (cause === "reconnect") return; // 重连中间态对外不可见
      if (cause === "death") {
        announce(`${PREFIX}${color.playerName}${name} 已死亡下线`);
        return;
      }
      if (cause === "abnormal") {
        announce(`${PREFIX}${color.playerName}${name} 离开了游戏`);
        return;
      }
    })
  );
  offs.push(
    services.events.on("botDeath", ({ botId, name }) => {
      const record = services.runtime.record(botId);
      const pos = record?.home;
      const where = pos
        ? ` ${color.muted}@ ${color.muted}[${color.info}${Math.floor(pos.position.x)} ${color.info}${Math.floor(pos.position.y)} ${color.info}${Math.floor(pos.position.z)}${color.muted}] ${color.darkGray}${dimensionLabel(record!.dimensionId)}`
        : "";
      announce(`${PREFIX}${color.error}${name} 死亡了${where}`);
    })
  );
  offs.push(
    services.events.on("botRespawn", ({ name }) => {
      announce(`${PREFIX}${color.accent}${name} 死亡后已自动复活`);
    })
  );
  offs.push(
    services.events.on("botRespawnFailed", ({ name, stage, reason }) => {
      announce(`${PREFIX}${color.error}${name} ${stage === "tail" ? "自动复活失败" : "自动重生失败"}: ${reason}`);
    })
  );
  offs.push(
    services.events.on("botToolGuardFired", ({ name, message }) => {
      announce(`${color.playerName}[${name}] ${message}`);
    })
  );
  offs.push(
    services.events.on("auxCompleted", (e) => {
      if (!e.ownerKey) return;
      if (!e.success) {
        console.warn(`[mockplayer3] 辅助失败 ${e.name}: ${e.reason ?? "未知"} @ ${e.dimId}`);
      }
      const text = e.success
        ? `${color.accent}【${e.name}】辅助已刷新\n${auxAscii(e.name, e.dimId, e.location, e.radius)}`
        : `${color.warn}【${e.name}】常加载辅助失败: ${e.reason ?? "未知"} @ ${dimensionLabel(e.dimId)} ${Math.floor(e.location.x)},${Math.floor(e.location.z)}（不影响在线）`;
      // 成功一路是覆盖图详情（debug 档，默认不推送）；失败属故障（warn 档）
      services.ops.notifyPlayer(e.ownerKey, text, e.success ? "debug" : "warn");
    })
  );
  return () => {
    for (const off of offs) off();
  };
}

/** 共享辅助覆盖 ASCII：以假人区块为中心按模拟N圆档几何渲染（dx²+dz²≤N²，r=4 实占 49 列），零世界查询 */
function auxAscii(name: string, dimId: string, loc: { x: number; y: number; z: number }, radius: number): string {
  const r = Math.max(1, Math.floor(radius));
  let covered = 0;
  const lines: string[] = [
    `${color.accent}┌─ 辅助覆盖 模拟${r}（${name} @ ${dimensionLabel(dimId)} ${Math.floor(loc.x)},${Math.floor(loc.z)}）─┐`,
  ];
  for (let dz = -r; dz <= r; dz++) {
    let row = `${color.muted}│ `;
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dz === 0) row += `${color.gold}◎ ${color.muted}`;
      else if (auxChunkCovered(dx, dz, r)) {
        row += `${color.accent}■ ${color.muted}`;
        covered++;
      } else row += `${color.darkGray}· ${color.muted}`;
    }
    lines.push(`${row}${color.muted}│`);
  }
  lines.push(
    `${color.muted}└─ ${color.gold}◎=假人区块 ${color.accent}■=辅助覆盖(${covered}列) ${color.darkGray}·=圆外 ─┘`
  );
  return lines.join("\n");
}
