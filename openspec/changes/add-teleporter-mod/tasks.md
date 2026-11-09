# Tasks

## 1. 共享界面包 `packages/ui`

- [x] 1.1 新建 `packages/ui/package.json`:`name` 为 `@mc-toolchain/ui`、`private: true`、`main`/`types` 指向 `src/index.ts`、`peerDependencies` 只含 `@minecraft/server` 与 `@minecraft/server-ui`;验证 `npm install` 后 `npm ls -w @mc-toolchain/ui` 解析到本地目录且无第三方运行时依赖
- [x] 1.2 新建 `packages/ui/tsconfig.json`(`target: es6`、`module: ES2020`、`noEmit`、`strict`)与 `tests/tsconfig.json`(输出 `../.test-build`);验证 `npm run typecheck -w @mc-toolchain/ui` 通过
- [x] 1.3 实现安全上下文执行助手(把回调推迟到安全上下文,同步与返回 Promise 的回调都要支持;回调同步抛错与 Promise 拒绝都必须被捕获并交给调用方,不产生 unhandled rejection)与界面消息助手(成功/失败提示,玩家离线时静默跳过);验证 `tests/run-safe.test.ts` 覆盖同步抛错、Promise 拒绝、正常返回三条路径并全绿
- [x] 1.4 实现选项式表单封装:字段名声明文本输入/下拉/开关/滑条,支持标题、正文、分隔线、提交按钮,取消返回「无结果」;验证取消路径不抛异常、各字段类型与值类型对应
- [x] 1.5 实现表单取值解析:同时兼容非输入元素占用下标与不占用下标两种排布;验证 `tests/modal-values.test.ts` 两种排布各有用例且 `npm test -w @mc-toolchain/ui` 全绿
- [x] 1.6 实现按钮式菜单封装与双按钮对话框封装,按钮处理函数通过安全上下文助手执行;验证取消时不执行任何处理函数
- [x] 1.7 写 `packages/ui/README.md`:承载范围表、刻意不包含(HUD 仲裁与样式码归 `@mc-toolchain/shared`)、依赖约束、es6 语法约束;验证 README 中列出的导出与 `src/index.ts` 实际导出一致

## 2. 模组骨架

- [ ] 2.1 新建 `mods/teleporter/package.json`:`name` 为 `@mc-toolchain/teleporter`、`version` 为 `0.0.6`、依赖 `@minecraft/server 2.3.0` 与 `@minecraft/server-ui 2.0.0`、开发依赖含 `@mc-toolchain/packaging` 与 `@mc-toolchain/ui`、`packing` 为 `{ mode: "auto", output: "dist/packages", minimum_engine_version: [1, 21, 120] }`;验证 `npm install` 成功且 `npm run pack -w @mc-toolchain/teleporter` 在包目录就绪后可运行
- [ ] 2.2 按 `mods/auto-refill` 同构创建 `just.config.ts`(只编排任务,打包逻辑全部来自 `@mc-toolchain/packaging`)、`tsconfig.json`、`tests/tsconfig.json`(显式 `include` 只含 `../scripts/core/**/*.ts` 与 `tests/**/*.ts`)、`eslint.config.mjs`、`.env`(`PROJECT_NAME="teleporter"`);验证 `just.config.ts` 中不含打包逻辑实现,`lint` 可运行
- [ ] 2.3 创建 `behavior_packs/teleporter/manifest.json`:保留上游 `header.uuid` 与两个 `modules[].uuid`,版本 `[0,0,6]`,`min_engine_version` 为 `[1,21,120]`,`dependencies` 为 `@minecraft/server [2,3,0]` 与 `@minecraft/server-ui [2,0,0]`,`metadata.product_type` 为 `"addon"`;验证 `mct validate -i .` 通过且清单三项值与 `package.json` 自洽

## 3. 纯逻辑层 `scripts/core/`

- [ ] 3.1 建 `scripts/core/types.ts` 与 `scripts/core/config.ts`:传送点、死亡点、玩家数据、请求、配置的类型,默认值与 DynamicProperty 键名,以及「原始载荷 → 配置」的归一化函数;验证 `npm run typecheck -w @mc-toolchain/teleporter` 通过,且 `config.test.ts` 覆盖缺失、损坏、部分字段缺失三种载荷均回落默认值
- [ ] 3.2 实现 `scripts/core/waypoints.ts`:名称同玩家内唯一、数量受配置上限约束、分类非法时回落、按「置顶优先、其次传送次数降序」排序;验证 `tests/waypoints.test.ts` 覆盖重名拒绝、上限拒绝、排序三条用例并全绿
- [ ] 3.3 实现 `scripts/core/deathPoints.ts`:超出保留上限丢弃最旧、列表最新在前;验证 `tests/death-points.test.ts` 覆盖上限裁剪与排序并全绿
- [ ] 3.4 实现 `scripts/core/requests.ts` 请求簿:按目标玩家键、每目标一条、新请求覆盖旧请求、固定时限过期、读取时惰性清理;验证 `tests/teleport-requests.test.ts` 覆盖覆盖语义与超时边界并全绿
- [ ] 3.5 实现 `scripts/core/naming.ts`:群系中文名称表覆盖主世界/下界/末地、未知群系回落去命名空间的原标识、维度名映射与位置格式化;验证 `tests/naming.test.ts` 覆盖已知群系、未知群系、三种原版维度、一个自定义维度并全绿
- [ ] 3.6 实现 `scripts/core/token.ts`:信物的名称与描述常量、按名称与描述识别判定、死亡不掉的标记字段;验证识别函数对普通纸返回假、对信物返回真
- [ ] 3.7 验证 `core/` 的依赖纯净度:`tests/tsconfig.json` 的 `include` 只含 `../scripts/core/**/*.ts` 与 `tests/**/*.ts`,`npm test -w @mc-toolchain/teleporter` 编译并运行全部 `core` 用例全绿

## 4. 适配层 `scripts/mc/`

- [ ] 4.1 实现 `scripts/mc/store.ts`:沿用 `teleporter:player:<playerId>`、`teleporter:players`、`teleporter:config` 三个 DynamicProperty 键与上游 JSON 结构,读写后交给 `core/config.ts` 归一化;验证读写往返后字段不丢失、键名与上游一致
- [ ] 4.2 实现 `scripts/mc/detection.ts`:`Dimension.getBiome` 检测并映射为中文名(失败回落「未知」)、管理员判定(原生权限等级 + 指定标记);验证无法检测群系时不抛异常、非管理员判定为假
- [ ] 4.3 实现 `scripts/mc/teleport.ts`:传送执行、成功/失败反馈、结果提示组装;验证传送到无效维度时返回失败且给出提示而不是抛异常
- [ ] 4.4 实现 `scripts/mc/token.ts`:信物的物品创建(带名称、描述、死亡不掉落)、发放时优先放入背包空位、背包满时溢出到地面并提示;验证背包已满时物品出现在玩家脚下

## 5. 界面层 `scripts/mc/ui/`

> 本目录是本模组的 7 个屏幕,与共享包 `packages/ui`(`@mc-toolchain/ui`)不是同一层。

- [ ] 5.1 实现主菜单与待处理请求优先展示(有未处理请求时先弹请求界面,否则弹主菜单,管理员多一个入口);验证非管理员看不到管理入口、有待处理请求时不直接进主菜单
- [ ] 5.2 实现传送点相关界面:快速选择、管理列表、单个传送点操作、新建(含群系检测与分类推荐);验证「更新坐标/传送到此/删除」三项互斥时拒绝执行并提示
- [ ] 5.3 实现死亡点列表界面:最新在前、显示相对时间、同维度显示距离、分页;验证无记录时提示未找到死亡记录
- [ ] 5.4 实现公共传送点列表界面:汇总所有玩家的公开传送点、标注所有者、按传送次数降序、分页;验证功能关闭时列表为空且不报错
- [ ] 5.5 实现玩家传送界面与方向选择(传到对方身边 / 让对方过来),双方各自收到提示;验证除自己外无在线玩家时给出提示
- [ ] 5.6 实现管理员配置界面(单人上限滑条 + 公共传送点开关,一次保存);验证保存后重新打开界面显示新值

## 6. 命令、事件与组合根

- [ ] 6.1 实现 `scripts/mc/commands.ts` 的 16 条命令注册:菜单、传送点增删改查、回传、死亡点、玩家间传送四件、公共传送点两件、管理员两件、信物;每条回调体只做参数解包、来源校验与鉴权,受限操作一律交给 `@mc-toolchain/ui` 的执行助手;验证 `mct validate -i .` 通过且命令清单与规格一致
- [ ] 6.2 为所有命令加玩家来源守卫:控制台与命令方块执行时返回失败并说明只能由玩家执行;验证在命令方块中执行任一命令不打开界面且返回失败信息
- [ ] 6.3 实现 `scripts/mc/events.ts` 的死亡订阅:只处理玩家死亡,记录死亡点;验证僵尸死亡不产生死亡点
- [ ] 6.4 实现 `scripts/mc/events.ts` 的重生订阅:首次进入时补发信物(背包无信物且有空位才发),死亡重生时若存在死亡点则弹出回传对话框;验证首次进入不弹回传对话框、背包已满不发放
- [ ] 6.5 实现 `scripts/mc/events.ts` 的物品使用订阅:信物通过 `itemUse` 与 `playerInteractWithBlock` 两条路径拦截并打开菜单,取消事件、不消耗物品;验证普通纸不触发菜单
- [ ] 6.6 实现 `scripts/main.ts` 组合根:在 startup 一次性注册全部命令与事件,日志不硬编码版本号;验证启动后命令与事件均可用、日志版本与 `package.json#version` 一致
- [ ] 6.7 逐条验证命令的受限操作确实生效:回传命令后玩家位置真的改变、菜单命令后界面真的弹出、信物命令后物品真的进入背包;验证控制台无 `cannot be called in read-only mode` 报错,且 `grep -n "system.run" scripts/mc/commands.ts` 无匹配(推迟统一由执行助手承担,回调体内不手写)

## 7. 图标与文档

- [ ] 7.1 写 `mods/teleporter/tools/generate-pack-icon.js`,按 32×32 逻辑像素 4 倍最近邻放大生成 128×128 RGBA 像素画,画面表达「位置锚点 + 传送箭头」;验证 `npm run generate:icon -w @mc-toolchain/teleporter` 产出的 PNG 为 128×128、8 位 RGBA
- [ ] 7.2 写 `mods/teleporter/README.md`:功能概览、16 条命令表、最低游戏版本 `1.21.120`、`core` / `mc` 分层说明、已知取舍(玩家传送可无同意移动他人、公共传送点索引只增不减);验证命令表与代码中注册的命令名逐条一致
- [ ] 7.3 更新根 `README.md`:模组表增加 `teleporter`,`packages/` 说明增加 `ui`;验证文档中的路径与目录实际一致
- [ ] 7.4 更新 `mods/README.md`(补充「界面/表单封装来自 `@mc-toolchain/ui`」)与 `packages/shared/README.md`(「刻意不包含」一节指向新包);验证两处描述与 `packages/ui` 实际导出不矛盾
- [ ] 7.5 在 `docs/research/README.md` 的索引中加入 `read-only-context.md`,并在 `mods/teleporter/README.md` 的已知约束一节引用它;验证索引链接指向的文件存在

## 8. 集成验证

- [ ] 8.1 在 `mods/teleporter` 下依次运行 `npm run lint`、`npx tsc -p tsconfig.json --noEmit`、`npm test`、`npm run pack`,全部无错误
- [ ] 8.2 检查打包产物:解压 `.mcpack` 确认根目录有 `manifest.json` 与 `scripts/main.js`、无 `.ts` 与 `.map`;确认 `header.version` 与 `modules[].version` 均为 `[0,0,6]`、`header.min_engine_version` 为 `[1,21,120]`、`dependencies[].version` 为 `[2,3,0]` 与 `[2,0,0]`,且与 `package.json` 三处一致
- [ ] 8.3 在 `packages/ui` 下运行 `npm run typecheck` 与 `npm test`,并在仓库根运行 `npm test -w @mc-toolchain/ui -w @mc-toolchain/teleporter`,全部全绿
- [ ] 8.4 运行 `openspec validate add-teleporter-mod --strict`,无错误无警告

## Workflow follow-up

- 待评审通过后归档该 change。
- 归档后确认 `openspec/specs/teleporter/spec.md` 与 `openspec/specs/shared-ui/spec.md` 已生成且 Purpose 段非占位。
