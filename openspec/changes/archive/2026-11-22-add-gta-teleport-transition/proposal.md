# Proposal

## Why

「传送」模组目前的传送是瞬移:玩家按下确认后位置直接跳变,没有任何空间连续性提示,长距离传送尤其容易让人失去方位感。上游 Fabric 客户端模组 `GrandTeleport` 用一套 GTA 风格的运镜解决了这个问题——相机脱离玩家、三段拉远升到 60 格、俯视横越世界、再三段推近落回玩家眼睛——这套镜头语言是它被推荐的核心原因。

基岩版的 `Player.camera.setCamera` 能以任意位姿驱动相机,`system.runInterval` 能提供 20 tick/秒的采样节拍,因此这套运镜在基岩版可以逐帧复刻,而不只是「做个淡入淡出」。同时本模组已经独占了自己的全部传送入口(传送点、死亡点、玩家间请求、玩家传送界面),不需要像上游那样去嗅探 `/tp` 或第三方模组的传送来源,移植面更干净。

## What Changes

- 新增运镜层:按上游 `TeleportTransitionController` 的时序与缓动逐 tick 计算相机位姿并写入 `minecraft:free` 相机,含 90° 俯视、双正弦相机抖动、三段变焦的滑出曲线。
- 新增世界级配置 `transitionEnabled`(总开关,**默认开**)与 `transitionStyle`(`cinematic` 电影感 / `fade` 淡入淡出 / `off` 关闭,默认 `cinematic`);管理员界面与 `/tpa:config` 均可读写。
- 按维度配置三段变焦高度与段时长(主世界 / 下界 / 末地各自一套),默认 20 / 40 / 60 格与 13 / 13 / 13 tick。
- 转场期间冻结玩家输入(`InputPermissionCategory.Movement` + `Camera`),转场结束或被中断时恢复。
- 转场音效复刻上游「原版音效模式」:六个阶段点播 `respawn_anchor.charge`、横越起播 `portal.trigger`、出体与入体各播三层 `ui.toast.out`。上游的自定义音效模式**不移植**(音效文件为 ZapSplat 付费授权,不可随 MIT 代码分发)。
- 跨维度传送降档为黑屏淡入淡出:基岩版相机不随玩家跨维度存续,无法做「相机横越维度」。
- 落点区块预加载:转场开始前用临时 ticking area 拉起落点周边区块,转场结束即释放。
- 全部既有传送入口(传送点、公共传送点、死亡点回传、死亡后对话框、`/tpa:tpa`、`/tpa:tphere`、玩家传送界面两个方向)统一走转场层;转场是**执行方式**,不改变「传送是否成功」的判定与计次规则。
- 补齐 `scripts/core/transition.ts` 的纯逻辑与 `tests/transition.test.ts` 单测,保持 `core/` 不接触 `@minecraft`。

## Capabilities

### New Capabilities

(无。运镜是本模组传送行为的组成部分,不单独成为能力。)

### Modified Capabilities

- `teleporter`: 传送从「瞬移 + 立即反馈」改为「带转场的位移 + 转场结束后反馈」;新增运镜时序与相机位姿、相机抖动、按维度变焦配置、转场开关与风格、转场期间输入冻结、转场音效、跨维度降档、落点预加载、转场中断清理等要求;并明确转场失败时的降级路径与计次时机不变。

## Impact

**新增**

- `mods/teleporter/scripts/core/transition.ts`:时间轴、缓动、抖动、逐帧位姿计算,以及风格/配置的归一化辅助;不 import `@minecraft`。
- `mods/teleporter/scripts/mc/transition.ts`:逐 tick 写相机、淡入淡出降档、输入冻结、音效、落点预加载、转场生命周期与中断清理。
- `mods/teleporter/scripts/mc/teleportPrimitive.ts`:无提示、无相机的位移原语,用来断开 `teleport.ts` 与 `transition.ts` 的循环依赖。
- `mods/teleporter/tests/transition.test.ts`:时间轴布局、横越时长夹取、缓动单调性、抖动方向、各阶段相机高度、位移时刻等断言。

**修改**

- `mods/teleporter/scripts/core/types.ts`、`scripts/core/config.ts`:`ModConfig` 增加 `transitionEnabled`、`transitionStyle`、按维度的三段高度与段时长;归一化函数对缺失/非法值回落默认值,老存档无需迁移。
- `mods/teleporter/scripts/mc/teleport.ts`:两个对外传送函数改为返回 `Promise<boolean>`,内部经转场层;重新导出位移原语以保持调用方 import 路径不变。
- `mods/teleporter/scripts/mc/warpService.ts`、`scripts/mc/requests.ts`、`scripts/mc/events.ts`、`scripts/mc/commands.ts`、`scripts/mc/ui/deathPoints.ts`、`scripts/mc/ui/publicWarps.ts`、`scripts/mc/ui/playerTeleport.ts`:适配异步返回值,保证「成功后才累加传送次数」在异步下仍成立。
- `mods/teleporter/scripts/mc/ui/admin.ts`:管理界面增加转场开关、风格下拉与三段高度/时长的编辑入口。
- `mods/teleporter/README.md`、根 `README.md`:补充转场能力、配置项、与上游的差异说明。
- `docs/research/`:新增一篇基岩版相机 API 调研(自由相机位姿、`easeTime` 插值、跨维度限制、输入权限冻结、音效播放),作为设计取舍的可复现依据。

**兼容性**

- 配置全部为新增字段并带默认值:已装旧包的世界升级后自动获得「电影感」转场,无需任何操作;`teleporter:config` 的既有字段与键名不变。
- 命令名、界面层级、存档键名、包 UUID 全部不变。
- 转场期间位置在横越起点才真正提交,因此「传送成功」的判定时点后移约 1.5–4 秒;这是唯一对既有可观察行为的时间线改变,`/tpa:back` 等命令的提示文案改为在转场结束后发出。
- `@minecraft/server` 版本要求不变(`2.3.0`):`setCamera`、`inputPermissions`、`tickingAreaManager` 均已在当前声明的版本内可用。

**风险**

- 逐 tick `setCamera` 在低端设备或高延迟网络下可能出现位姿跳帧;需要 `easeTime` 插值与失败容错兜底。
- 相机 API 属于「受限上下文」成员,必须在安全上下文调用;命令回调已统一经由执行助手推迟,但仍需在实现时确认没有从只读上下文触达相机。
- 输入冻结若因异常未被恢复,玩家会卡在原地无法移动;必须有超时兜底与离线清理。
- 上游依赖 Voxy / Distant Horizons / Sodium 的远景地形与区块淡入在基岩版没有对应能力,远距离横越时可能出现地形突然出现;ticking area 预加载只能缓解,不能等价替代。
- 工作区里残留着上一次未提交的移植尝试的编译产物(`lib/`、`.test-build/`),缺少对应 `.ts` 源码。实现阶段需明确处置:以其为参考重写,并在完成后清理这些陈旧产物,避免与新实现混淆。
