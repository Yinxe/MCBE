# Tasks

> 实施约定:模组命令在仓库根执行并用 `-w @mc-toolchain/spectator-mode` 指定;`mct` 命令用 `mct <cmd> -i mods/spectator-mode`。包目录固定为 `behavior_packs/spectator-mode`(全名,不用 `BP`/`RP`)。

## 1. 脚手架与依赖

- [x] 1.1 用 `mct create spectator-mode tsStarter mc-toolchain -o mods/spectator-mode` 生成模组,并把包目录改名为 `behavior_packs/spectator-mode`、`.env` 的 `PROJECT_NAME` 同步为 `spectator-mode`;验证方式:目录下存在 `just.config.ts`、`tsconfig.json`、`eslint.config.mjs`、`.env`、`scripts/`、`behavior_packs/spectator-mode/manifest.json`,且 `grep PROJECT_NAME .env` 输出 `spectator-mode`。
- [x] 1.2 重写 `package.json`:`name` 为 `@mc-toolchain/spectator-mode`、`version` 为 `1.0.10`、`productName` 为「灵魂出窍」、`private: true`;`dependencies` 为 `@minecraft/server` `2.1.0` 与 `@minecraft/server-ui` `2.0.0`;`devDependencies` 参照 `mods/auto-refill/package.json`(`@mc-toolchain/packaging`、`@mc-toolchain/shared`、`@minecraft/core-build-tasks` 5.5.0、`@typescript-eslint/*` 8.72.1、`eslint-plugin-minecraft-linting` 2.0.10、`prettier` 3.9.10、`source-map`、`ts-node`、`typescript` 5.5.4);`scripts` 含 `lint`/`build`/`clean`/`pack`(`just-scripts pack`)/`local-deploy`/`generate:icon`/`test`;`packing` 为 `{ "mode": "auto", "output": "dist/packages" }`(不写 `minimum_engine_version`,由依赖推导);验证方式:仓库根 `npm install` 成功,`npm ls -w @mc-toolchain/spectator-mode` 能解析到该模组且无 peer 冲突。
- [x] 1.3 对齐构建配置:删除 `mods/spectator-mode/just.config.ts` 中模板自带的 `mcaddon` 自定义打包残留,改为 `mods/auto-refill/just.config.ts` 的形态(`setupEnvironment` + `projectName` + `bundleTask` 的 `external: ["@minecraft/server", "@minecraft/server-ui"]` + `clean-build` + `synchronizePackVersions` + `pack`);`tsconfig.json` 用 `target: es6`、`module: ES2020`、`baseUrl: "."`;新增 `tests/tsconfig.json`(`target: ES2022`、`module: commonjs`、`outDir: ../.test-build`、`rootDir: ..`,include 仅 `../scripts/core/*.ts` 与 `**/*.ts`);复制 `eslint.config.mjs` 与 `.prettierrc.json` 并确认 lint 范围为 `scripts/**/*.ts` 与 `tools/**/*.ts`;验证方式:`npm run build -w @mc-toolchain/spectator-mode` 在只有空 `scripts/main.ts` 时成功产出 `dist/scripts/main.js`,且 `npm run lint -w @mc-toolchain/spectator-mode` 通过。

## 2. 纯逻辑层(`scripts/core/`)

- [x] 2.1 写 `scripts/core/types.ts`(`Vec3`、`SpConfig{enabled,maxDistance,showLink,nightVision}`、`SoulAnchor extends Vec3{dimensionId,gameMode}`)与 `scripts/core/config.ts`(`DEFAULT_MAX_DISTANCE=128`、`MAX_DISTANCE_MIN=5`、`MAX_DISTANCE_MAX=400`、`CONFIG_KEYS{enabled:"sp:enabled",maxDistance:"sp:maxDist",showLink:"sp:showLink",nightVision:"sp:nightVision"}`、`defaultConfig()`、`clampMaxDistance()`);键名常量处 MUST 写注释说明「沿用上游 `sp:*` 是本仓命名规范的例外,理由见 README」;验证方式:`tests/config.test.ts` 覆盖默认值、`clampMaxDistance(3)→5`、`clampMaxDistance(401)→400`、`clampMaxDistance(NaN)→128` 全部通过。
- [x] 2.2 写 `scripts/core/engine.ts`(`SoulEngine`,`update(distance, maxDistance, dtMs)` 返回 `{phase,inRange,ratio,remainingMs,forceReturn}`):范围内保持 `in-range`;首次超限进入 `tolerant` 并把 `remainingMs` 设为容忍时长;容忍内回到范围取消倒计时;倒计时耗尽返回 `forceReturn: true` 并复位;`distance` 为 `Infinity` 时按超限处理,`ratio` 钳到 `[0,1]`;验证方式:`tests/engine.test.ts` 覆盖上述五条路径(含 `Infinity` 与「耗尽后下一 tick 重新计时」)全部通过。
- [x] 2.3 写 `scripts/core/colors.ts`(`RANGE_STOPS` 阈值 `0 / 0.4 / 0.7 / 0.9` 对应 `§a/§e/§6/§c`、`OVER_DISTANCE_COLOR="§4"`、`rangeColor(ratio)` 先钳制再取档)与 `scripts/core/hud.ts`(`buildSoulHud(state)` 生成 8 格进度条、范围内 `§l灵魂出窍§r §7·§r <条> <色>Nm§r §7/ Nm`、容忍区 `<深红条> 超出！ Nm / Nm Ns 后强制回归`、`Infinity` 显示为 `∞`);验证方式:`tests/colors.test.ts` 与 `tests/hud.test.ts` 覆盖各档颜色、`ratio` 越界钳制、范围内/容忍两种文案、`Infinity` 显示,全部通过。
- [x] 2.4 在 `tests/` 下补齐 `node --test` 入口(`import { test } from "node:test"` + `node:assert/strict`),确认测试编译范围不含 `scripts/mc/**`;验证方式:`npm test -w @mc-toolchain/spectator-mode` 输出 4 个测试文件的全部用例通过,且 `.test-build` 中不存在 `mc/` 目录。

## 3. 适配层(`scripts/mc/`)

- [x] 3.1 写 `scripts/mc/store.ts`:世界级 `readConfig()`/`writeConfig()`(缺失或类型不符时回落 `defaultConfig()`,`maxDistance` 写入前钳制),玩家级 `readSoulAnchor()`(JSON 解析失败或字段不全返回 `undefined`)/`writeSoulAnchor()`/`clearSoulAnchor()`;玩家锚点键为 `sp:soul`,MUST NOT 写入世界动态属性;验证方式:源码审查确认无 `world.setDynamicProperty` 写入玩家锚点,且读函数对损坏 JSON 与缺失字段两种情况都返回 `undefined`(可用临时 Node 脚本对解析逻辑做一次冒烟)。
- [x] 3.2 写 `scripts/mc/playerUtil.ts`(`isUsablePlayer`、`allUsablePlayers`、`findUsablePlayer`、`findAnyPlayer`):过滤判据仅基于对象可用性(`instanceof Player` + `id`/`dimension`/`location` 可读,属性访问抛错即剔除),MUST NOT 依赖 tag;验证方式:源码审查确认无 `hasTag`/白名单逻辑,且所有遍历包 `try/catch`。
- [x] 3.3 写 `scripts/mc/particles.ts`:灵魂光环 `minecraft:trial_omen_single`、真身标记 `minecraft:raid_omen_ambient`、双向扫掠连线 `minecraft:colored_flame_particle`(琥珀 `{1,0.7,0.3,1}` 真身→灵魂、灰 `{0.6,0.6,0.6,1}` 灵魂→真身,每支 6 点、相位步进 0.08),并保留 `SOUL_LINK_MODE="sweep"` 与实验分支 `creaking`;每个 `spawnParticle` 调用方 MUST 独立 `try/catch`;验证方式:`npm run build` 通过,且源码中三个粒子 id 与两组 RGBA 取值与 `design.md` D7/上游一致。
- [x] 3.4 写 `scripts/mc/controller.ts`(`SoulController`):`start()` 读配置 + 启动 2 tick 循环 + 向 `HudManager`(`modId: "spectator-mode"`、`slot: "actionbar"`、`priority: 200`)注册 `soul` 源;`toggle()` 分支(有会话→回归;已是旁观者且有锚点→回归;已是旁观者无锚点→仅提示;极限模式→拒绝;功能关闭→提示;否则进入);`enterSoul`/`returnToAnchor`/`resumeSoul`/`restoreOnJoin`/`onPlayerLeave`/`forceReturnAll`/`selfHeal`/`tick` 按 `design.md` D5 实现,容忍时长 `5000ms`、tick 间隔 2、粒子每 3 帧、空闲扫描每 10 次;玩家相关调用全部 `try/catch`,单个玩家失败只跳过该玩家;验证方式:`npm run build` 通过,且源码审查确认 `TOLERANCE_MS = 5000`、`TICK_INTERVAL_TICKS = 2`、`hud.register` 的 priority 为 200、tick 内每处玩家操作都有异常隔离。
- [x] 3.5 在 `controller.ts` 内实现真身侧粒子的区块加载守卫(`getBlock` 探测)与「每玩家只记一次」的粒子失败日志;验证方式:源码审查确认真身粒子前有加载探测、日志用 `Set<string>` 去重。

## 4. 命令与表单

- [x] 4.1 写 `scripts/mc/commands.ts`:只注册一条 `sp:soul`,`permissionLevel: CommandPermissionLevel.Any`、`cheatsRequired: false`、`optionalParameters: [{ name: "action", type: CustomCommandParamType.String }]`;回调内按 `origin.sourceEntity` 取玩家(`instanceof Player` 判定,非玩家来源返回 `{ status: 1, message: "该命令只能由玩家执行" }`),再分三支:`menu` → 权限足够则 `system.run` 打开表单、否则提示仅管理员可操作;其它非空值 → 用法提示;未传 → `controller.toggle()` 并把返回消息发给玩家;验证方式:`npm run build` 通过,且源码审查确认全仓只有一处 `registerCommand`、命令名为 `sp:soul`。
- [x] 4.2 写 `scripts/mc/menu.ts`:用原生 `ModalFormData` 依次添加 `toggle("启用旁观模式", { defaultValue, tooltip })`、`slider("最大移动距离(米)", 5, 400, { valueStep: 1, defaultValue: clampMaxDistance(config.maxDistance), tooltip })`、`toggle("显示连线粒子", { defaultValue, tooltip })`、`toggle("夜视增益", { defaultValue: config.nightVision, tooltip })` 与 `submitButton("保存")`;提交后按 `clampMaxDistance` 收敛距离并调 `controller.setConfig()` 落盘,取消时不改动;验证方式:`npm run build` 通过,且源码审查确认使用 `@minecraft/server-ui` 的 `ModalFormData` 而非任何外部表单构造器。
- [x] 4.3 写 `scripts/main.ts`:订阅 `world.afterEvents.playerJoin`(转 `controller.restoreOnJoin(playerId)`)、`world.afterEvents.playerLeave`(转 `controller.onPlayerLeave`)、`system.beforeEvents.startup`(注册命令),并在 `system.run` 内调 `controller.start()`;验证方式:`npm run build` 通过,产物 `dist/scripts/main.js` 中出现三个事件名与 `start()` 调用。

## 5. 包清单、图标与文档

- [x] 5.1 调整 `behavior_packs/spectator-mode/manifest.json`:`header.name` 为「灵魂出窍」、`description` 用上游文案主体、`min_engine_version` 与 `version` 交给打包写入(先写 `[1,21,100]` 与 `[1,0,10]` 占位)、`dependencies` 为 `@minecraft/server [2,1,0]` 与 `@minecraft/server-ui [2,0,0]`、`metadata.product_type: "addon"`,保留上游 header/module 的 UUID 以维持世界内包身份;验证方式:`mct validate -i mods/spectator-mode` 无 ERROR 且无 `UNLINK` 项。
- [x] 5.2 写 `tools/generate-pack-icon.js`(32×32 逻辑像素 → 4 倍最近邻 → 128×128 RGBA PNG,色板 8–12 色,构图语义为「人形轮廓 + 向外飘离的灵魂光点 + 距离环」),执行一次生成 `behavior_packs/spectator-mode/pack_icon.png`;验证方式:`npm run generate:icon -w @mc-toolchain/spectator-mode` 成功,且用 PNG 头解析确认尺寸 128×128、颜色类型 6(RGBA)。
- [x] 5.3 写 `mods/spectator-mode/README.md`:玩法流程(进入/移动/距离与倒计时/手动回归)、命令与权限表(`/sp:soul` 人人可执行、`/sp:soul menu` 表单仅 OP)、管理表单三项、极限模式禁用说明、持久化与重连恢复行为、构建与打包命令(`npm run pack -w @mc-toolchain/spectator-mode`)、产物路径 `dist/packages/spectator-mode-v1.0.10_bp.mcpack`、兼容下限 1.21.100、`sp:*` 键名作为命名规范例外的理由、以及「不要与上游 `spectator-mode` 包同时安装」的说明;验证方式:文档中的每条命令可复制执行成功,且四项关键说明(权限、极限模式、键名例外、共存禁忌)齐备。

## 6. 集成验证

- [x] 6.1 在仓库根执行 `npm install && npm run lint -w @mc-toolchain/spectator-mode && npm test -w @mc-toolchain/spectator-mode && npm run pack -w @mc-toolchain/spectator-mode`;验证方式:四条命令全部成功,`dist/packages/` 出现 `spectator-mode-v1.0.10_bp.mcpack`,解压后根目录含 `manifest.json` 与 `pack_icon.png`、`scripts/main.js` 存在,且不含 `.ts` 与 `.map`。
- [x] 6.2 校验包清单自洽:打包后读 `behavior_packs/spectator-mode/manifest.json`;验证方式:`header.version` 与各 `modules[].version` 均为 `[1,0,10]`、`header.min_engine_version` 为 `[1,21,100]`、`dependencies` 版本与 `package.json` 一致。
- [x] 6.3 编译期确认兼容下限:用 `@minecraft/server` 2.1.0 的类型面跑一次 `tsc --noEmit`(模组 `node_modules` 已装 2.1.0);验证方式:无类型错误,且不存在对 2.2.0+ 独有 API 的引用。
- [ ] 6.4 实机验证(需 Minecraft 客户端,1.21.100 与最新版各一次):`/sp:soul` 进入旁观并出现真身标记粒子、移动超限出现倒计时与红色警示、回到范围内取消、倒计时耗尽自动回归并还原维度/位置/游戏模式、`/sp:soul menu` 在 OP 下打开表单且非 OP 收到提示、关闭开关时在场灵魂被强制回归、以灵魂状态退出重进后恢复旁观、极限模式世界拒绝进入并给出入服警告、连线粒子默认关闭且开关后可见、以及夜视三项(进入后全程保持夜视;带着剩余 3 分钟夜视进入并在灵魂阶段停留 1 分钟后回归,剩余时长约 2 分钟而非重置为 3 分钟;原本无夜视者回归后夜视消失);验证方式:逐项记录实测结果(截图或文字),任一不符即回到对应任务组修复。
- [ ] 6.5 与 `mods/auto-refill` 同世界共存冒烟:开启 auto-refill 的防误触提示(actionbar priority 60)与本模组的灵魂 HUD(priority 200);验证方式:灵魂出窍时 actionbar 显示距离 HUD,回归后 auto-refill 的提示可正常显示,证明仲裁与让位符合预期。

## 7. 夜视增益

- [ ] 7.1 扩展配置模型:`scripts/core/types.ts` 的 `SpConfig` 加 `nightVision: boolean`;`scripts/core/config.ts` 的 `CONFIG_KEYS` 加 `nightVision: "sp:nightVision"`、`defaultConfig()` 返回 `nightVision: true`;键名注释补充说明「新键沿用同一前缀,不另起 `spectator_mode:*`」;`tests/config.test.ts` 补一条断言 `defaultConfig().nightVision === true`;验证方式:`npm test -w @mc-toolchain/spectator-mode` 全部通过且用例数比原先多 1。
- [ ] 7.2 在 `scripts/mc/store.ts` 加夜视快照读写:`NightVisionSnapshot{amplifier,durationTicks,enteredTick}`、键名 `sp:nvSave`、`readNightVisionSnapshot()`(JSON 损坏或字段不全返回 `undefined`)/`writeNightVisionSnapshot()`/`clearNightVisionSnapshot()`;快照 MUST 只写玩家 DP,且 `clearSoulAnchor()` 调用方在回归时一并清除快照;验证方式:源码审查确认无 `world.setDynamicProperty` 写快照,且读函数对损坏 JSON 返回 `undefined`。
- [ ] 7.3 在 `scripts/mc/controller.ts` 实现夜视生命周期:`NIGHT_VISION_EFFECT="minecraft:night_vision"`、`NIGHT_VISION_REFRESH_TICKS=200`、`NIGHT_VISION_DURATION_TICKS=300`;`enterSoul` 成功后若 `config.nightVision` 为真,先快照 `getEffect()`(无则记 `undefined`)再施加夜视;tick 内每 200 tick 刷新一次;`returnToAnchor` 内按 `system.currentTick - enteredTick` 差值还原(无快照→`removeEffect`;总时长非正→按无限重新施加;剩余>0→按原强度施加剩余;剩余≤0→不施加);`setConfig` 关闭夜视时对在场灵魂 `removeEffect`;所有 `addEffect`/`removeEffect` 调用 MUST 在安全 tick 内(命令路径经 `system.run` 已满足);验证方式:源码审查确认三处调用均在 `system.run`/`runInterval` 回调链上,且快照在 `enterSoul` 与还原在 `returnToAnchor` 成对出现。
- [ ] 7.4 在 `scripts/mc/menu.ts` 加第四项 `toggle("夜视增益", { defaultValue: config.nightVision, tooltip: "灵魂出窍期间为灵魂施加夜视;回归时还原你进入前的夜视状态" })`,并把它纳入提交后的 `controller.setConfig()` 与保存成功提示文案;验证方式:`npm run build` 通过,且表单控件数与 `SpConfig` 字段数一致(4 对 4)。
- [ ] 7.5 在 `mods/spectator-mode/README.md` 补充夜视说明:管理表单由三项改为四项、夜视默认开启、回归时按快照还原(带夜视进入者剩余时长会减少而非重置)、无限时长夜视保持无限、以及「灵魂阶段由模组接管夜视,自饮的夜视药水会在回归时丢失」这一已知取舍;验证方式:README 的管理表单小节列出四项且含上述四条说明。

## Workflow follow-up

- 实施完成并通过评审后,运行 `/opsx-archive` 归档本变更,把 `specs/spectator-mode/spec.md` 同步为 `openspec/specs/spectator-mode/spec.md` 主 spec。
- 归档后确认 `openspec list --specs` 出现 `spectator-mode` 能力,并在 `mods/README.md` 的模组清单表中补一行 `spectator-mode`。
- 上游仓库 `/home/yinxin/coding/MCBE/mcaddon/spectator-mode` 是否停止维护、是否在 README 中指向本仓实现,留待用户决定,不在本变更范围内改动。
