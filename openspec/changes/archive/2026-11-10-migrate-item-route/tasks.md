# Tasks

> 迁移源：`/home/yinxin/coding/MCBE/mcaddon/item-route`（v0.1.20）。所有「与上游一致」的验证命令都以该路径为参照。
> 已在设计阶段用 `/tmp/ir-check` 原型验证过：`@minecraft/server` 2.1.0 + `@minecraft/server-ui` 2.0.0 + 真实 `packages/mod-common`，118 个文件全量编译 0 错误，286 条用例全过。任务里标「已验证」的条目是把原型结论固化，执行时只需复核。

## 1. 模组骨架与工具链

- [x] 1.1 建 `mods/item-route/`，写 `package.json`：`name: "@mc-toolchain/item-route"`、`version: "0.1.20"`、`productName`、`description`、`author`、`repository`、`private: true`、`packing: { mode: "auto", output: "../../release/", minimum_engine_version: [1, 21, 100], qq_group: "632178498" }`；`dependencies` 为 `@minecraft/server: "2.1.0"`、`@minecraft/server-ui: "2.0.0"`、`@minecraft/vanilla-data: "1.26.20"`（三者都精确版本，无 `^`）；`devDependencies` 照 `mods/spectator-mode/package.json` 的形态（含 `@mc-toolchain/mod-common: "*"`、`@mc-toolchain/mod-packaging: "*"`、`@minecraft/core-build-tasks: "5.5.0"`、`typescript`、`just-scripts`、eslint 三件套、`prettier`、`source-map`、`ts-node`、`@types/node`）；`scripts` 含 `lint`/`build`/`clean`/`pack`/`generate:icon`/`local-deploy`/`test`（`test` 为 `tsc -p tests/tsconfig.json && node --test ".test-build/tests/**/*.test.js"`）。
  验证：`node -e "const p=require('./mods/item-route/package.json');const d=p.dependencies;if(d['@minecraft/vanilla-data']!=='1.26.20'||d['@minecraft/server']!=='2.1.0')process.exit(1);if(Object.keys(d).length!==3)process.exit(1)"` 退出码 0。

- [x] 1.2 写 `mods/item-route/just.config.ts`，照 `mods/spectator-mode/just.config.ts`：`copyTaskOptions` 同时给出 `copyToBehaviorPacks: ["./behavior_packs/${projectName}"]` 与 `copyToResourcePacks: ["./resource_packs/${projectName}"]`（`@minecraft/core-build-tasks` 的 `CopyTaskParameters` 支持后者，仓库内此前无模组用过），`copyToScripts: ["./dist/scripts"]`；`bundleTaskOptions.external` 只列 `@minecraft/server` 与 `@minecraft/server-ui`（**不要**加 `@minecraft/vanilla-data`，它必须被内联）；`local-deploy` 的 `watchTask` 通配符要同时含 `behavior_packs/**` 与 `resource_packs/**`；`pack` 任务为 `series("clean-build", "build", "synchronizePackVersions", createPackagesByMode(__dirname))`。
  验证：`grep -c "copyToResourcePacks" mods/item-route/just.config.ts` 输出 1；`grep -q "vanilla-data" mods/item-route/just.config.ts` 失败。

- [x] 1.3 写 `mods/item-route/tsconfig.json`（照 `mods/spectator-mode/tsconfig.json`）、`mods/item-route/tests/tsconfig.json`、`mods/item-route/eslint.config.mjs`、`mods/item-route/.env`（`PROJECT_NAME="item-route"`）。
  `tests/tsconfig.json` 以 `mods/spectator-mode/tests/tsconfig.json` 为底（`outDir: "../.test-build"`、`rootDir: ".."`、`types: ["node"]`），但 `include` **必须**是上游 `tsconfig.test.json` 白名单的等价物（路径前缀改为 `../`）：
  `../scripts/core/**/*.ts`、`../scripts/mc/storage/**/*.ts`、`../scripts/mc/ui/Table.ts`、`../scripts/mc/interaction/SelectionSessionStore.ts`、`../scripts/mc/interaction/interactionLogic.ts`、`../scripts/mc/auth/commands.ts`（注意是 `auth/` 不是 `commands/auth.ts`，见 3.3）、`../scripts/mc/effects/SortEffects.ts`、`../scripts/mc/util/playerName.ts`、`**/*.ts`；`exclude` 含 `../node_modules`、`../.test-build`、`../scripts/mc/storage/DynamicPropertyStore.ts`。
  **不要**简化成 `../scripts/core/**/*.ts` + `**/*.ts`：那 8 个 `scripts/mc/` 文件被 9 个测试直接引用，漏掉会让对应用例静默不编译、不运行（`node --test` 只跑编译产物，缺文件不报错）。
  验证：`grep -c "\.\./scripts/mc/" mods/item-route/tests/tsconfig.json` 至少 7（`storage/**` 算 1 条）。

- [x] 1.4 在仓库根执行 `npm install`，验证：`npm ls @mc-toolchain/item-route` 列出该 workspace 包，`ls mods/item-route/node_modules/@minecraft/` 含 `server`、`server-ui`、`vanilla-data`，且 `node -e "console.log(require('./mods/item-route/node_modules/@minecraft/server/package.json').version)"` 输出 `2.1.0`。

## 2. 两个包与图标

- [x] 2.1 把 `BP/ItemRoute/manifest.json` 迁到 `mods/item-route/behavior_packs/item-route/manifest.json`，UUID 原样保留（`header.uuid` `746aab1e-dd00-4f24-bdbb-42bc411a3003`、`data` 模块 `795cb2a2-6886-45bb-b9fa-7f76d9b6eca5`、`script` 模块 `7b4491b1-8154-4542-80c6-729b91b1faff`）。`header.version`、`header.name`、`header.description`、`modules[].version`、`header.min_engine_version` 都交给 `synchronizePackVersions` 派生，手写值只是占位。
  验证：`node -e "const m=require('./mods/item-route/behavior_packs/item-route/manifest.json');const u=m.header.uuid+'|'+m.modules.map(x=>x.uuid).join(',');console.log(u)"` 输出 `746aab1e-dd00-4f24-bdbb-42bc411a3003|795cb2a2-6886-45bb-b9fa-7f76d9b6eca5,7b4491b1-8154-4542-80c6-729b91b1faff`。

- [x] 2.2 把 `RP/ItemRoute/` 下 5 个文件原样迁到 `mods/item-route/resource_packs/item-route/`：`manifest.json`、`particles/itemroute/deposit.particle.json`、`particles/itemroute/sort.particle.json`、`textures/itemroute/particle/container_gradient.png`、`textures/itemroute/particle/sort_gradient.png`。保留资源包 `header.uuid` `1bc7314d-ae1c-4b79-8015-de48a030b605`、`resources` 模块 `8b952bc1-c4c7-4b4d-acf8-e3378f85bf34`，以及对行为包的 `dependencies` 条目（其版本由 `synchronizePackVersions` 同步为行为包版本）。
  验证：`find mods/item-route/resource_packs -type f | wc -l` 输出 5（完成 2.3 后为 6）。

- [x] 2.3 生成两份 128×128 RGBA `pack_icon.png`，分别写入 `behavior_packs/item-route/` 与 `resource_packs/item-route/`。上游两个包目录都**没有**图标；资源包缺图标会在游戏内显示空白。做法参照 `mods/spectator-mode/tools/generate-pack-icon.js` 写 `mods/item-route/tools/generate-pack-icon.js`（纯 Node 生成 PNG、像素画、有限色板、主题对应「分拣/仓库」），并接到 `generate:icon` 脚本。
  验证：`file mods/item-route/behavior_packs/item-route/pack_icon.png mods/item-route/resource_packs/item-route/pack_icon.png` 两份都报 `PNG image data, 128 x 128`。

## 3. 源码搬迁与分层

- [x] 3.1 把上游 `scripts/core/**` 原样复制到 `mods/item-route/scripts/core/`（子目录 `data/`、`events/`、`index/`、`model/`、`organizing/`、`routing/`、`scheduling/`、`search/`、`services/`、`stats/`、`storage/`、`utils/`）。`core/` 不 import `@minecraft`，除 `data/ItemNameMap.ts:23` 的 `@minecraft/vanilla-data` 外无需改动。
  验证：`find mods/item-route/scripts/core -name '*.ts' | wc -l` 输出 55。

- [x] 3.2 把上游 `scripts/mc/**` 原样复制到 `mods/item-route/scripts/mc/`（子目录 `adapters/`、`bootstrap/`、`commands/`、`container/`、`effects/`、`events/`、`interaction/`、`persistence/`、`storage/`、`ui/`、`util/`），`scripts/main.ts` 一并迁入。
  验证：`find mods/item-route/scripts/mc -name '*.ts' | wc -l` 输出 62（此时 3.3 尚未执行；3.3 完成后应为 63 = 62 - 1 + 2）；`test -f mods/item-route/scripts/main.ts` 成功。

- [x] 3.3 建 `mods/item-route/scripts/mc/auth/`，把上游 `scripts/mc/commands/auth.ts` 移为 `scripts/mc/auth/commands.ts`（纯逻辑，`COMMAND_MIN_ROLE` / `requireRole` / `canRunCommand` / `resolveWarehouseByName`，**不 import `@minecraft`**），并新增 `scripts/mc/auth/admin.ts`：
  ```ts
  import { PlayerPermissionLevel, type Player } from "@minecraft/server";
  export function canManage(player: Player): boolean {
    return player.playerPermissionLevel >= PlayerPermissionLevel.Operator;
  }
  ```
  不加 `hasTag("op")` 兜底（上游没有，加了会扩大 OP 面）。
  **这是移位不是复制**：`scripts/mc/commands/auth.ts` 必须删除，两处并存会留下死文件，且 `grep -rn "commands/auth"` 的校验会失败。
  随之修正三处引用：`scripts/mc/ui/FamilyConfigMenu.ts:9`、`scripts/mc/ui/WarehouseSettingsMenu.ts:11`、`scripts/mc/ui/ContainerRoleMenu.ts:12` 的 `import { requireRole } from "../commands/auth"` → `"../auth/commands"`；`tests/command-auth.test.ts:3` 的 `"../scripts/mc/commands/auth"` → `"../scripts/mc/auth/commands"`。
  验证：`grep -c "@minecraft" mods/item-route/scripts/mc/auth/commands.ts` 输出 0；`grep -rn "commands/auth" mods/item-route/` 无输出。

## 4. 剥离外部私有依赖

> 上游共 **25 个文件** 从 `@yinxe/toolkit` 导入，用到 5 个符号：`defineCommand`（10 文件 / 9 处调用）、`canManage`（9 文件 / 10 处调用）、`ModalFormBuilder`（10 文件）、`ActionFormBuilder`（7 文件）、`HudManager`（1 文件）。

- [x] 4.1 新建 `mods/item-route/scripts/mc/commands/register.ts`，导出 `registerPlayerCommand(registry, config: CustomCommand, handler)`，行为对齐上游 `defineCommand`：`const entity = origin.sourceEntity ?? origin.initiator` → 非 `Player` 返回 `{ status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" }` → 按 `mandatoryParameters` + `optionalParameters` 的 `name` 顺序解包 `args` 成 `params` → `runSafeDetached(() => handler({ origin, player: entity, params }))` → 返回 `{ status: CustomCommandStatus.Success }`。
  **不要**照抄 `~/coding/MCBE/packages/toolkit/src/command/index.ts`：它 import `../ui/runSafe` 的 `runSafeAsync`，会自建执行助手，违反 `mod-common` 规格「执行助手已内含 `system.run`，模组不得再包一层」。推迟只用 `runSafeDetached`。
  验证：`grep -q "runSafeDetached" mods/item-route/scripts/mc/commands/register.ts` 成功；`grep -c "system.run" mods/item-route/scripts/mc/commands/register.ts` 输出 0。

- [x] 4.2 把 9 处 `defineCommand(...)` 改为 `registerPlayerCommand(...)`：`scripts/mc/commands/` 下的 `create.ts:22`、`resize.ts:20`、`rescan.ts:21`、`rescanPreview.ts:23`、`delete.ts:19`、`organize.ts:25`、`menu.ts:16`、`search.ts:20`、`help.ts:13`。`defs.ts` 的四个 `CustomCommand` 工厂（`regionCommand` / `nameCommand` / `queryCommand` / `noParamCommand`）返回值与 `registerPlayerCommand` 的第二参数同构，**无需改动**，继续作为参数传入。
  同时把 9 个文件里 `registry: Parameters<typeof defineCommand>[0]` 的类型标注改为 `registry: CustomCommandRegistry`（从 `@minecraft/server` 导入），并删掉 `scripts/mc/commands/index.ts:31` 的 `export { defineCommand };`。
  验证：`grep -rn "defineCommand" mods/item-route/scripts/` 只剩注释（`create.ts:9` 与 `defs.ts:1` 的注释需一并改写为「registerPlayerCommand」）；`grep -c "Parameters<typeof defineCommand>" -r mods/item-route/scripts` 无输出。

- [x] 4.3 把 9 个文件里 `canManage` 的 import 从 `@yinxe/toolkit` 改为相对路径指向 `../auth/admin`（按各文件所在目录调整层级）。调用点共 10 处，语义不变。
  验证：`grep -rn "canManage" mods/item-route/scripts/ | grep -c "auth/admin"` 至少 9；`grep -rn "from \"@yinxe" mods/item-route/scripts/` 无输出。

- [x] 4.4 把表单与 HUD 的 import 改为 `@mc-toolchain/mod-common`：`ModalFormBuilder`（10 文件）、`ActionFormBuilder`（7 文件）、`HudManager`（`scripts/mc/effects/WarehouseHUD.ts:9`）。三者调用面与上游完全兼容，**不改调用点**，只换 import 来源。
  `WarehouseHUD.ts` 的 `new HudManager({ modId: "item-route", intervalTicks: 10 })`（第 93 行）与两个源（`session` 优先级 100、`warehouse` 优先级 80）保持不变；同时把该文件首行注释里的 `（@yinxe/toolkit）` 改为 `（@mc-toolchain/mod-common）`。
  另外 3 处仅出现在注释里的 `@yinxe/toolkit` 引用一并改词：`scripts/mc/ui/uiColor.ts:4`、`scripts/mc/adapters/McEventBridge.ts:48`、`scripts/core/events/EventSignal.ts:1`。
  验证：`grep -rn "@yinxe/" mods/item-route/` 无输出；`grep -rl "@mc-toolchain/mod-common" mods/item-route/scripts | wc -l` 输出 16。

- [x] 4.5 确认 `mods/item-route/package.json` 的 `devDependencies` 里有 `@mc-toolchain/mod-common: "*"` 与 `@mc-toolchain/mod-packaging: "*"`（1.1 已写），验证：`npm ls @mc-toolchain/mod-common --workspace @mc-toolchain/item-route` 显示已链接到仓库内 `packages/mod-common`。

## 5. 编译闭环

- [x] 5.1 跑 `npm run build -w @mc-toolchain/item-route`。
  **已验证**：`@minecraft/server` 2.1.0 下 118 个文件全量编译 0 错误。`scripts/mc/adapters/McEventBridge.ts:44-60` 的 `blockContainerOpened` / `blockContainerClosed` 用结构类型 + 运行时特性检测订阅（这两个事件在 2.1.0 类型里不存在），本就为低版本类型设计，无需改动。
  验证：该命令退出码 0 且 `mods/item-route/dist/scripts/main.js` 存在；`grep -c "MinecraftItemTypes" mods/item-route/dist/scripts/main.js` 至少 1（证明 `vanilla-data` 被内联，而不是留在 external）。

- [x] 5.2 跑 `npx tsc -p mods/item-route/tsconfig.json --noEmit`，验证：无错误输出。
  若出现 2.1.0 下无法消除的错误（**已验证不会**），才改判为 `@minecraft/server: "2.8.0"` + `packing.minimum_engine_version: [1, 26, 30]`，并在 `mods/item-route/README.md` 记录改判原因。

## 6. 测试迁移

- [x] 6.1 把上游 `tests/` 下 32 个 `*.test.ts` 与 `tests/helpers/InMemoryContainer.ts` 复制到 `mods/item-route/tests/`，修正 import 路径：`../scripts/core/...` 不变；`../scripts/mc/...` 中只有 `command-auth.test.ts` 需要改（见 3.3）；`./helpers/InMemoryContainer` 不变。
  验证：`ls mods/item-route/tests/*.test.ts | wc -l` 输出 32。

- [x] 6.2 跑 `npm test -w @mc-toolchain/item-route`，把 `# pass` 对齐 **286**。
  **已验证**：按 1.3 的白名单 `include` 编译后跑 `node --test`，输出 `# tests 286 / # pass 286 / # fail 0`。
  若 `# pass` 少于 286，逐个补 `tests/tsconfig.json` 的 `include` 条目，**不要**删用例。常见漏项是 `../scripts/mc/storage/**/*.ts`（`ShardStore` / `McModConfig`）与 `../scripts/mc/ui/Table.ts`。
  验证：输出含 `# fail 0` 且 `# pass 286`。

- [x] 6.3 检查脆弱点：`scripts/mc/effects/SortEffects.ts` 与 `scripts/mc/util/playerName.ts` **确实 import `@minecraft/server`**，它们能进测试构建是因为类型可解析、且测试只触及其纯部分（`effects.test.ts` 引用的是 `effects/ParticleIds.ts` 的常量，`player-name.test.ts` 引用的是 `playerNameOf` 纯函数）。
  验证：`grep -n "import" mods/item-route/tests/effects.test.ts mods/item-route/tests/player-name.test.ts` 里不出现这两个文件的**运行时值**导入；`node --test` 不出现 `Cannot find module '@minecraft/server'`。

## 7. 打包验证

- [x] 7.1 跑 `npm run pack -w @mc-toolchain/item-route`。`packing.mode: "auto"` 探测到 2 个包 → 产出 `.mcaddon`；`moduleName` 由 `@mc-toolchain/item-route` 去掉 scope 得到 `item-route`。
  验证：`release/item-route-v0.1.20.mcaddon` 存在，`unzip -l release/item-route-v0.1.20.mcaddon` 同时含 `item-route-v0.1.20_bp.mcpack` 与 `item-route-v0.1.20_rp.mcpack`（`mod-packaging` 只留 `.mcaddon`，中间 mcpack 在临时目录，输出目录不残留）。

- [x] 7.2 检查模组目录无产物残留，验证：`find mods/item-route -name "*.mcaddon" -o -name "*.mcpack" | wc -l` 输出 0。

- [x] 7.3 检查两个 manifest 的派生字段，验证：`node -e "for(const p of ['behavior_packs','resource_packs']){const m=require('./mods/item-route/'+p+'/item-route/manifest.json');console.log(p,m.header.version.join('.'),m.header.min_engine_version.join('.'),m.header.name)}"` 输出两行，版本 `0.1.20`、最低版本 `1.21.100`、名称形如 `物品路由 v0.1.20`（= `productName` + ` v` + `version`），且两个包的 `modules[].version` 都是 `0.1.20`。

- [x] 7.4 检查资源包对行为包的依赖版本已同步，验证：`node -e "const m=require('./mods/item-route/resource_packs/item-route/manifest.json');console.log(JSON.stringify(m.dependencies))"` 中 `uuid` 为 `746aab1e-dd00-4f24-bdbb-42bc411a3003`、`version` 为 `[0,1,20]`。

- [x] 7.5 检查 `release/` 被忽略，验证：`git check-ignore release/item-route-v0.1.20.mcaddon` 有输出。

## 8. 文档

- [x] 8.1 写 `mods/item-route/README.md`：功能概述、9 条 `ir:*` 命令表（`ir:create` / `ir:resize` / `ir:delete` / `ir:rescan` / `ir:rescan_preview` / `ir:organize` / `ir:search` / `ir:menu` / `ir:help`，各含参数与最低角色，角色矩阵抄 `scripts/mc/auth/commands.ts` 的 `COMMAND_MIN_ROLE`）、信物（木锄）交互、五级路由优先级（指定容器 → 已存同类 → 同族 → 溢出 → 丢弃）、`packing.minimum_engine_version` 取值依据（`@minecraft/server` 2.1.0 → `[1, 21, 100]`）、`@minecraft/vanilla-data` 锁 `1.26.20` 的理由、图标生成脚本用法、双包布局说明。
  验证：`grep -c "ir:" mods/item-route/README.md` 至少 9。

- [x] 8.2 在 `mods/README.md` 的模组表（第 14-15 行附近）补 `item-route` 一行，说明它是仓库内唯一带资源包的模组。验证：`grep -q "item-route" mods/README.md` 成功。

- [x] 8.3 在根 `README.md` 的模组表（第 31-32 行附近）补 `item-route` 一行并链到 `mods/item-route/README.md`；同时更新第 13-14 行的目录树。验证：`grep -q "item-route" README.md` 成功。

## 9. 集成验收（游戏内实测）

- [ ] 9.1 逐条实测 9 条命令的**副作用**，不只比对返回值：`ir:create` 建出仓库、`ir:resize` 改到新区域、`ir:delete` 删仓且成员关系清除、`ir:rescan` 登记新容器、`ir:rescan_preview` 只报告不写入、`ir:organize` 合并同类堆叠、`ir:search` 命中并给出位置、`ir:menu` 打开主菜单、`ir:help` 列出全部命令。
  验证：每条命令都产生可见效果，且没有出现「返回成功但无效果」——这是拆掉 `defineCommand` 后推迟职责落空的唯一表现。

- [ ] 9.2 实测权限矩阵：member 执行 `ir:resize` / `ir:delete` 被拒；非成员执行 `ir:rescan` 被拒；owner 移除 member 后该玩家 `ir:organize` 被拒。验证：三次越权都有明确拒绝提示且仓库状态不变。

- [ ] 9.3 实测五级分拣优先级：逐级构造「上一级不可用」的场景，物品落到预期容器（指定容器 → 已存同类 → 同族 → 溢出 → 丢弃）。验证：五级各命中一次。

- [ ] 9.4 实测 HUD 与特效开关：关闭 HUD 后 actionbar 不再有仓库提示且不压制其它模组内容；关闭特效后分拣结果不变。验证：两个开关各测一次。

- [ ] 9.5 实测持久化与 UUID 兼容：用迁移前的包启用过的世界替换为迁移后的包。验证：世界继续识别为同一行为包与资源包（包列表无重复条目），既有仓库、成员、容器角色、全局配置全部读回——持久化键空间（`ShardStore` 的 `ir2:` 前缀等）与全部 UUID 都没改，这一条应当直接通过。

## Workflow follow-up

- 归档时执行 `/opsx-archive`，把 `item-route` 的 delta 合并进 `openspec/specs/item-route/spec.md`。
- 归档后可在上游仓库 `~/coding/MCBE/mcaddon/item-route` 标记迁移完成；本次变更不改动上游仓库。

---

## 归档时遗留的未验证项

任务 9.1–9.5 为游戏内实测，本机无 Bedrock 运行时（无客户端、无 BDS），无法执行。归档时保持未勾选状态，此处记录每一条的验证缺口与已用替代手段，供后续真机验收时对照。

| 任务 | 未验证内容 | 已用替代手段 | 残留风险 |
|---|---|---|---|
| 9.1 命令副作用 | 9 条 `ir:*` 命令在游戏内确实产生副作用（建仓、重扫、整理、搜索、菜单打开） | `tests/register.test.ts` 13 条用例证明注册层会把 handler 推迟到安全上下文执行、参数按名解包正确、非玩家来源被拒；但 handler **内部**对仓库的操作未经真机验证 | 中：若某条命令的回调逻辑依赖只读上下文外的额外前提，静态测试无法发现 |
| 9.2 权限矩阵 | member 执行 `ir:resize`/`ir:delete` 被拒、非成员执行 `ir:rescan` 被拒、移除成员后立即失效 | `tests/command-auth.test.ts` 覆盖 `requireRole`/`canRunCommand`/`COMMAND_MIN_ROLE` 的矩阵逻辑；`tests/register.test.ts` 覆盖 `canManage` 的 OP 判定与「不因 op 标签提权」 | 低-中：矩阵函数本身有测，但「命令回调是否都正确调用了矩阵」未逐条核对 |
| 9.3 五级分拣优先级 | 五个优先级在游戏内各命中一次 | `tests/routing.test.ts`、`tests/family-routing.test.ts`、`tests/family-edge.test.ts`、`tests/family-ranks.test.ts` 覆盖 `core/` 路由策略 | 低：策略为纯逻辑且测试充分，游戏内仅需确认接线 |
| 9.4 HUD 与特效开关 | 关闭 HUD 后不再占用 actionbar 且不压制其它模组；关闭特效后分拣结果不变 | `tests/effects.test.ts` 覆盖粒子 identifier 与边界几何；HUD 仲裁逻辑属 `@mc-toolchain/mod-common`，其 `tests/arbiter.test.ts` 覆盖优先级仲裁 | 中：跨模组 actionbar 互不压制需真机确认 |
| 9.5 迁移后世界读回 | 用迁移后包替换迁移前包，既有世界读回仓库数据 | 五个 UUID 与上游逐一比对相等；持久化键空间 `ir2:` 与上游一致；打包产物内 manifest 已确认 `@minecraft/server [2,1,0]` | 低：标识与键空间已静态核对，仅未实测读回 |

### 归档前额外发现并修复

清单 `@minecraft/server` 依赖版本原为上游的 `[2,0,0]`，而代码使用 `PlayerPermissionLevel`、`CustomCommandStatus` 等 2.1.0 成员。已改为 `[2,1,0]` 并重新打包验证。此为**有意偏离上游**，理由见 `design.md` 与主规格 `item-route` 的「包标识与最低游戏版本」需求。
