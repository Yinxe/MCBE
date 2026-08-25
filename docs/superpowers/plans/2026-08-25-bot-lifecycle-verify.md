# BOT 上线/下线 持续验证计划

> 对应权威：`mcaddon/mock-player/docs/bot-lifecycle-tickingarea.md` (539行) + Spec `docs/superpowers/specs/2026-08-25-bot-lifecycle-tickingarea-spec.md`
> 分支：`feat/optimize-refactor` | HEAD: `086d538` → 后续每轮 `git log` 可追溯 79dcecf/d747b38/086d538

## 每轮复核清单（已自动化于 /tmp/verify_bot_lifecycle.sh）
- [x] doc/spec 存在性 + 行数 + grep 命中（safeOnline/safeOffline/Sim4/SingleChunk 等）
- [x] `npx tsc --noEmit` 0 error
- [x] 抽样单测 `bot-registry + bot-store` 27 pass（全量 79 pass）
- [x] `git status` clean / committed

## 变更触发再校验
- 任何 `features/manage/{onlineBot,offlineBot,auxiliary,tickingArea/*,gametestContext,spawnMode}` 改动 → 必须重跑验证并追加文档脚注

## 证据链
- 79dcecf：权威 537行 + 20行 Spec + AGENTS 8行
- d747b38：52处安全调用全枚举
- 086d538：4-Phase与双域幂等一致性
