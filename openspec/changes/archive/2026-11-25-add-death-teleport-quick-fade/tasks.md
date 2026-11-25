# Tasks

## 1. 纯逻辑:传送意图与分派规则

- [x] 1.1 在 `mods/teleporter/scripts/core/transition.ts` 新增 `TeleportIntent` 类型(`"normal" | "deathPoint"`)与 `TeleportIntent` 常量,并给 `TransitionModeInput` 增加必填字段 `intent`。验证:`npx tsc --noEmit -p tsconfig.json` 报出所有未传 `intent` 的调用点(证明字段确实是必填),便于下一步逐一补上。
- [x] 1.2 重写 `resolveTransitionMode`,按固定顺序判定:`style === "off"` → `"immediate"`;`intent === "deathPoint"` → `"fade"`;`crossDimension` → `"fade"`;其余 → `"cinematic"`。在函数注释里写明「`fade` 的时长由调用方按 `intent` 选择,本函数不区分快慢」,避免后来者误以为死亡点用的是常规时长。验证:`npx tsc --noEmit -p tsconfig.json` 通过。
- [x] 1.3 在 `mods/teleporter/tests/transition.test.ts` 补充分派用例:总开关关闭时死亡点也返回 `"immediate"`;死亡点同维度返回 `"fade"`;死亡点跨维度返回 `"fade"`;普通传送跨维度返回 `"fade"`;普通传送同维度返回 `"cinematic"`。验证:`npm test -w @mc-toolchain/teleporter` 全部通过,且新增用例数不少于 5 条。

## 2. 适配层:快速淡入时长

- [x] 2.1 在 `mods/teleporter/scripts/mc/transition.ts` 导出 `FadeTiming` 接口(`fadeInTime` / `holdTime` / `fadeOutTime`),把现有三个常量收进 `NORMAL_FADE_TIMING`,新增 `QUICK_FADE_TIMING` 为 `{ fadeInTime: 0.15, holdTime: 0.05, fadeOutTime: 0.15 }`。注释说明:三段之和不足 0.5 秒时引擎会自动补足保持段,因此设定值只是「尽可能短」,实际由引擎夹取。验证:`npx tsc --noEmit -p tsconfig.json` 通过。
- [x] 2.2 给 `playFadeTransition` 增加第三个可选参数 `timing?: FadeTiming`,缺省用 `NORMAL_FADE_TIMING`;内部所有用到三个时长的地方(调用 `camera.fade`、计算位移提交 tick、计算清相机延迟 tick)改为读该参数。验证:既有 `npm run verify:transition` 中「风格 fade」「跨维度降档」两组仍然通过(缺省参数行为不变)。
- [x] 2.3 在 `mods/teleporter/scripts/mc/teleport.ts` 的 `teleportPlayerTo` 与 `teleportToSavedPoint` 增加可选参数 `intent: TeleportIntent = "normal"`,透传给 `resolveTransitionMode`,并在 `mode === "fade"` 时按 `intent === "deathPoint"` 选择 `QUICK_FADE_TIMING`、否则用缺省值。验证:`npx tsc --noEmit -p tsconfig.json` 通过,且 `grep -n "QUICK_FADE_TIMING" scripts/mc/teleport.ts` 有命中。

## 3. 三个死亡点入口

- [x] 3.1 `mods/teleporter/scripts/mc/commands.ts` 的 `/tpa:back` 调用 `teleportToSavedPoint` 时传 `"deathPoint"`。验证:`grep -n "deathPoint" scripts/mc/commands.ts` 有命中,且该文件里其它 `teleportToSavedPoint` 调用(若有)未传。
- [x] 3.2 `mods/teleporter/scripts/mc/ui/deathPoints.ts` 的列表项回调调用 `teleportToSavedPoint` 时传 `"deathPoint"`。验证:`grep -n "deathPoint" scripts/mc/ui/deathPoints.ts` 有命中。
- [x] 3.3 `mods/teleporter/scripts/mc/events.ts` 的死亡重生回传对话框调用 `teleportToSavedPoint` 时传 `"deathPoint"`。验证:`grep -n "deathPoint" scripts/mc/events.ts` 有命中。
- [x] 3.4 核对全部调用点:`grep -rn "teleportToSavedPoint(\|teleportPlayerTo(" scripts/` 逐一确认只有上述三处传了 `"deathPoint"`,传送点、公共传送点、玩家间传送、玩家传送界面四处保持默认。验证:把该 grep 输出与预期清单对照,清单外的任何一处传了 `deathPoint` 都视为错误并改正。

## 4. 适配层验证脚本

- [x] 4.1 在 `mods/teleporter/tests/harness/verify-transition.js` 补一组用例:同维度 + `deathPoint` 意图 → `setCamera` 为 0、`fade` 为 1,且 `fade` 的 `fadeTime` 等于快速时长;同维度 + `normal` 意图 → `setCamera` 大于 0。验证:`npm run verify:transition` 全部通过。
- [x] 4.2 在同一脚本补一组用例:总开关关闭 + `deathPoint` 意图 → `setCamera` 与 `fade` 均为 0,直接位移。验证:`npm run verify:transition` 全部通过。

## 5. 文档与全量校验

- [x] 5.1 更新 `mods/teleporter/README.md`:在「传送转场」一节补一段说明死亡点回传走快速淡入、理由是危险位置需要尽快拿回操作权、以及「总开关关闭时一律无动画」的优先级。验证:`grep -n "死亡点回传" mods/teleporter/README.md` 有命中,且文中同时提到快速淡入与关闭优先。
- [x] 5.2 跑全量校验:`npm test -w @mc-toolchain/teleporter`、`npm run verify:transition`、`npm run verify:token`、`npm run lint -w @mc-toolchain/teleporter`、`npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p tests/tsconfig.json`、`openspec validate add-death-teleport-quick-fade --strict`。验证:全部退出码 0。
- [x] 5.3 用真实目标版本编译一次,防止再次出现「本地装的是高版本、CI 装的是声明版本」的错位:`cp -r node_modules/@minecraft/server /tmp/backup`,换成 `package.json` 声明的 `2.3.0` 解包结果,`npx tsc --noEmit -p tsconfig.json` 与 `-p tests/tsconfig.json` 均应通过,完成后还原。验证:两次 tsc 退出码 0,`node_modules/@minecraft/server` 已还原为原版本。
- [x] 5.4 游戏内手测:总开关开启(电影感)时执行 `/tpa:back`,应看到快速淡入而非运镜;从死亡点列表选择一条,同样快速淡入;死亡重生对话框选「传送」,同样快速淡入;把总开关关闭后再执行 `/tpa:back`,应直接位移无动画;传送到自己的传送点,仍应播放完整运镜。验证:五个场景的结果与 `specs/teleporter/spec.md` 中对应场景的 THEN 描述一致。
