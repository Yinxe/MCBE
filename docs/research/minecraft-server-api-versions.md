# `@minecraft/server` 模块版本 ↔ Minecraft 游戏版本

## 1. 结论速查

| `@minecraft/server` | 发布日期 | 对应 Minecraft | 备注 |
| --- | --- | --- | --- |
| 1.11.0 | 2024-06-13 | 1.21.0 | `world.gameRules` 从此版本可用 |
| 1.12.0 | 2024-08-13 | 1.21.20 | |
| 1.13.0 | 2024-08-13 | 1.21.30 | |
| 1.14.0 | 2024-09-17 | 1.21.40 | |
| 1.15.0 | 2024-10-22 | 1.21.50 | |
| 1.16.0 | 2024-12-03 | 1.21.60 | |
| 1.17.0 | 2025-02-11 | 1.21.70 | |
| 1.18.0 | 2025-03-25 | 1.21.80 | |
| 1.19.0 | 2025-05-06 | 1.21.80 | |
| **2.0.0** | **2025-06-17** | **1.21.90** | `world.afterEvents.worldLoad` 从此版本可用 |
| 2.1.0 | 2025-08-06 | 1.21.100 | |
| 2.2.0 | 2025-09-30 | 1.21.110 | |
| 2.3.0 | 2025-10-28 | 1.21.120 | |
| 2.4.0 | 2025-12-09 | 1.21.130 | |
| 2.5.0 | 2026-02-10 | 1.26.0 | |
| 2.6.0 | 2026-03-24 | 1.26.10 | |
| 2.7.0 | 2026-05-05 | 1.26.20 | |
| 2.8.0 | 2026-06-16 | 1.26.30 | |
| 2.9.0 | 2026-08-04 | 1.26.40 | |
| 2.10.0 | 2026-09-15 | 1.26.50 | 成就限制从此版本所在游戏版本开始 |
| 2.11.0 | 2026-10-27 | 1.26.60 | |

对应关系是**同一天发布**推导出来的:`@minecraft/server` 的 npm 发布时间与 `bedrock-samples` 的 `version.json` 里该游戏版本的日期一一对上。这不是官方声明,而是可复现的实测推断。

## 2. 关键 API 的首次可用版本

| API | 首次可用 | 验证方式 |
| --- | --- | --- |
| `world.gameRules` | `@minecraft/server` 1.11.0(Minecraft 1.21.0) | `grep -c "gameRules" index.d.ts` |
| `GameRule.KeepInventory` / `gameRules.keepInventory` | 同上 | `grep -n "keepInventory" index.d.ts` |
| `world.afterEvents.worldLoad` | **`@minecraft/server` 2.0.0(Minecraft 1.21.90)** | 见下方实测 |

`worldLoad` 的边界实测:

```text
@minecraft/server@1.19.0 -> worldLoad 出现 0 次
@minecraft/server@2.0.0  -> worldLoad 出现 1 次   (readonly worldLoad: WorldLoadAfterEventSignal;)
@minecraft/server@2.1.0  -> worldLoad 出现 1 次
```

因此「用 `worldLoad` 设定 `keepInventory`」这个实现方案的**兼容下限就是 Minecraft 1.21.90**。

## 3. 为什么最终选 2.0.0 而不是 1.11.0

设定 `keepInventory` 只需要 `gameRules`(1.11.0 就有),理论上可以下探到 Minecraft 1.21.0。但:

- 在 1.11.0 上只能依赖 `system.run` / `system.afterEvents.scriptEventReceived` 之类的时机把设置塞进去,**没有可靠的「世界加载完成」事件**,设置时机不确定
- `worldLoad` 是官方给的明确时机,一次设置即可生效,实现最简、行为最可预期
- 用户最终决策是「实现简单可预期优先」,接受把下限抬到 1.21.90

这就是 `min_engine_version` 定为 `[1, 21, 90]`、依赖定为 `[2, 0, 0]` 的原因。

## 4. 可复现的验证方式

```bash
# 版本 ↔ 日期
npm view @minecraft/server time --json

# 游戏版本 ↔ 日期(bedrock-samples 仓库)
node -e 'const v=require(process.env.HOME+"/gitRepos/bedrock-samples/version.json");
for (const k of ["1.21.0.3","1.21.90.3","1.26.50.4","1.26.60.5"]) console.log(k, v[k]?.date)'

# 某 API 的首次可用版本(逐个版本探测)
for v in 1.19.0 2.0.0; do
  echo -n "@minecraft/server@$v worldLoad: "
  curl -s https://unpkg.com/@minecraft/server@$v/index.d.ts | grep -c worldLoad
done
```

> `bedrock-samples` 属于外部参考仓库,按项目约定放在 `~/gitRepos` 而不是本项目目录内。
