# 基岩版相机 API:自由相机、淡入淡出、输入冻结与区块预加载

本文记录为移植 GTA 风格传送转场而做的实测与静态核对。每条结论都给出**可复现的验证方式**,
便于日后升级 `@minecraft/server` 时重新确认。

环境基线:`@minecraft/server 2.3.0`、`@minecraft/server-ui 2.0.0`、`min_engine_version 1.21.120`、
系统日期 2026-11-22。

## 1. 结论速查

| 问题 | 结论 |
| --- | --- |
| 能否用脚本驱动任意位姿的相机 | 能。`Camera.setCamera("minecraft:free", { location, rotation })` |
| 相机成员是否受限上下文 | **是,7/7 全部受限**,必须推迟到安全 tick |
| 能否用内置样条代替逐 tick 写入 | 能,但不适合本项目(见 §4) |
| 相邻两次 `setCamera` 之间能否插值 | 能。`easeOptions: { easeTime, easeType }` |
| 跨维度时相机是否存续 | 否。必须降档为淡入淡出 |
| 淡入淡出的三段时长语义 | `fadeInTime` / `holdTime` / `fadeOutTime`,单位秒,各自 ≤ 10 |
| 能否冻结玩家移动与视角 | 能。`InputPermissionCategory.Movement` + `Camera` |
| 能否为落点区块预加载 | 能。`world.tickingAreaManager.createTickingArea()`,返回 Promise |
| 有没有「传送完成」事件 | **没有**。转场结束只能靠自计时 |
| 能否查询「相机当前是否被脚本接管」 | **没有**。因此必须自己记账 |

## 2. 自由相机预设

`minecraft:free` 是**内置预设**,不需要在行为包里放 `camera/presets/*.json`。

验证方式:读 `index.d.ts` 的 `Camera.setCamera` 签名(只接受预设名字符串),再对照中文
Minecraft Wiki 的 [命令/camera](https://zh.minecraft.wiki/w/%E5%91%BD%E4%BB%A4/camera) 页面
「参数」一节列出的合法预设清单:

```
minecraft:first_person / third_person / third_person_front
minecraft:free / fixed_boom / follow_orbit
minecraft:control_scheme_camera   ← 需实验性开关
```

`minecraft:free` 接受的位置与旋转参数:

| 命令参数 | 脚本参数 | 说明 |
| --- | --- | --- |
| `position: x y z` | `location: Vector3` | 相机世界坐标 |
| `xRot` / `yRot` | `rotation: Vector2` | **`x` 是俯仰、`y` 是偏航** |
| `easeTime` | `easeOptions.easeTime` | 平滑过渡时长(秒),仅 `minecraft:free` 有效 |
| `easeType` | `easeOptions.easeType` | 缓动类型,仅 `minecraft:free` 有效 |
| `lookAtPosition` | — | 脚本侧用 `CameraSetPosOptions.facingLocation` 替代 |

> ⚠ `rotation` 的字段顺序与直觉相反:`Vector2` 的 `x` 是 pitch、`y` 是 yaw。
> 本项目在 `writeCamera()` 里显式写成 `{ x: frame.pitch, y: frame.yaw }`,不要用位置顺序去推。

俯仰符号约定:**正值向下**。`pitch = 90` 是正下方俯视,`pitch = -90` 是正上方仰视。
本项目全程使用 `TOP_DOWN_PITCH = 90`,并且抖动只朝更大的正值偏移,因此不会出现朝天的帧。

## 3. 相机成员全部属于受限上下文

验证方式(可复现):

```bash
cd mods/teleporter
awk '/^export class Camera /,/^}/' node_modules/@minecraft/server/index.d.ts \
  | grep -cE "^\s+\w+\("                                  # → 7(方法总数)
awk '/^export class Camera /,/^}/' node_modules/@minecraft/server/index.d.ts \
  | grep -c "can't be called in restricted-execution mode" # → 7(受限数)
```

两者相等,说明**没有任何一个相机方法是可以在只读上下文调用的**。受限的 7 个方法(完整清单)是:

`attachToEntity()`、`clear()`、`fade()`、`playAnimation()`、`setCamera()`、`setDefaultCamera()`、
`setFov()`。

实践规则:

- 命令回调、`beforeEvents` 订阅回调里**不能**碰相机;
- 所有相机写入必须发生在 `system.run` / `system.runInterval` / `system.runTimeout` 的回调内;
- 本项目在 `playTransition()` 里用 `system.run` 做第一层兜底,即使调用方忘了推迟也不会报错。

详见 [`read-only-context.md`](./read-only-context.md) 的受限成员清单与判据。

## 4. 为什么不用 `Camera.playAnimation` 样条

`Camera.playAnimation(CatmullRomSpline | LinearSpline, AnimationOptions)` 能一次播放整条曲线,
但有两个硬限制让它不适合本项目:

1. **无法在曲线中途叠加依赖 tick 的抖动**。上游的镜头微抖是 `sin(tick * 0.105)` 这类
   与绝对 tick 对齐的波形,必须逐帧计算;样条只能给控制点。
2. **无法在曲线中途插入事件**。本项目要在横越第一 tick 提交位移、在 6 个变焦点播音效,
   样条播放期间没有回调钩子。

替代方案是逐 tick 写入 + `easeOptions` 补间,代价是每玩家每秒 20 次 `setCamera` 调用。
这个量级可以忽略,换来的是完全可控。

## 5. `easeOptions` 的插值行为

`CameraSetPosOptions` / `CameraSetRotOptions` / `CameraSetLocationOptions` 都带
`easeOptions?: { easeTime?: number; easeType?: EasingType }`。

本项目的用法:

```ts
player.camera.setCamera("minecraft:free", {
  location: frame.position,
  rotation: { x: frame.pitch, y: frame.yaw },
  easeOptions: { easeTime: 0.05, easeType: EasingType.Linear },  // 1/20 秒 = 1 tick
});
```

`easeTime = 0.05` 恰好是一个 tick 的长度:引擎会在两次写入之间做线性补间,低帧率设备上
不会出现「跳帧后硬切」的观感。选 `Linear` 而非 `InOutSine` 之类的缓动,是因为缓动曲线
已经在 `core/transition.ts` 里算过了,再叠一层会双重平滑。

`EasingType` 共 32 个取值(`Linear` / `InQuad` … `Spring`),与命令侧的 `easeType` 枚举一一对应。

## 6. 跨维度:相机不存续

结论:**相机绑定在玩家连接上,玩家换维度时被引擎重置**。因此无法做「相机横越维度」。

验证方式(游戏内):

1. 用 `/camera @s set minecraft:free ease 0 pos ~ ~10 ~ rot 90 0` 把玩家抬到高空俯视;
2. 执行 `/execute in the_nether run tp @s 0 64 0`;
3. 观察:相机立刻回到第一人称,没有任何过渡。

因此本项目在 `teleportPlayerTo()` 里做维度比对,起点与落点维度不同时**即使风格是电影感**
也走 `playFadeTransition()`。这是 spec 里「跨维度传送降档为淡入淡出」的实现依据。

## 7. 淡入淡出的三段时长

```ts
player.camera.fade({
  fadeColor: { red: 0, green: 0, blue: 0 },
  fadeTime: { fadeInTime: 0.2, holdTime: 0.15, fadeOutTime: 0.3 },
});
```

语义(Wiki「参数」节原文归纳):

- 三段单位是**秒**,各自必须在 `0.0`–`10.0`;
- 三段之和不足 0.5 秒时,保持段自动延长到补足 0.5 秒;
- **多条 fade 会合并**:淡入取较快者,开始淡出与结束取较晚者,透明度以当前值为起点,
  颜色取正在播放的那条;
- 覆盖层淡入完成后是**完全不透明**,不能指定半透明值。

本项目的用法:在 `holdTime` 的中段(约 `0.2 + 0.075 = 0.275` 秒 ≈ 5.5 tick)提交位移,
此时屏幕已完全遮黑。淡出结束后再 `camera.clear()` 交还视角。

## 8. 输入冻结

```ts
player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, false);
player.inputPermissions.setPermissionCategory(InputPermissionCategory.Camera, false);
```

`InputPermissionCategory` 的取值与覆盖范围(据 d.ts 注释):

| 值 | 覆盖 |
| --- | --- |
| `Movement = 2` | **全部移动**:等价于同时关掉 Jump / Sneak / LateralMovement / Mount / Dismount |
| `Camera = 1` | 相机移动 |
| `LateralMovement = 4` | WASD / 摇杆 |
| `Sneak = 5` | 潜行,也影响飞行下降 |
| `Jump = 6` | 跳跃,也影响飞行上升 |
| `Mount = 7` / `Dismount = 8` | 上下载具 |
| `MoveForward = 9` / `MoveBackward = 10` / `MoveLeft = 11` / `MoveRight = 12` | 逐方向移动,粒度比 `LateralMovement` 更细 |

因为 `Movement` 已经覆盖了其它几类,本项目只关 `Movement` + `Camera` 两项,恢复时也只开这两项。
`setPermissionCategory` 同样标注受限上下文,所以冻结与恢复都在安全 tick 内执行。

⚠ 这两项是**布尔开关而非引用计数**。如果将来出现别的系统也要关同一个开关,需要改成引用计数;
当前模组是唯一的写入方,所以直接置 `true` 恢复。

## 9. 落点区块预加载

```ts
await world.tickingAreaManager.createTickingArea(identifier, { dimension, from, to });
world.tickingAreaManager.removeTickingArea(identifier);
```

要点:

- 管理器挂在 **`World`** 上,不是 `Dimension`(容易踩的坑:`dimension.tickingAreaManager` 不存在);
- `TickingAreaOptions` 是 `{ dimension, from, to }` 两个对角点,**不是** `min`/`max`;
- `createTickingArea` 返回 `Promise<void>`,**在区域内所有区块加载完成并开始 tick 后才 resolve**;
- 有容量上限:`maxChunkCount` 与 `chunkCount` 可读,`hasCapacity(options)` 可预检;
  重叠的区块会重复计数;
- 标识符必须唯一。本项目用 `teleporter:transition/<playerId>`,玩家同时只会有一次转场。

本项目把预加载当作**优化而非前置条件**:创建失败(名额已满、维度不可用)只记一条警告,
不改变转场流程。这条取舍对应 spec 的「加载失败仍完成传送」场景。

## 10. 两个「没有」

- **没有传送完成事件**。`PlayerDimensionChangeAfterEvent` 只在真正跨维度时触发,同维度传送
  没有任何 after event。因此「位移是否成功」只能由 `player.teleport()` 的返回值/异常推断,
  「转场何时结束」只能自己计时。
- **没有「相机是否被脚本接管」的查询接口**。`Player.camera` 只能写不能读状态。因此本模组
  自己维护 `active: Map<playerId, Session>` 记账,并在 `playerLeave` / `entityDie` 时主动清理。

## 11. 超时兜底的必要性

由于 §10 的两个缺失,任何「等引擎告诉我结束」的写法都不可靠。本项目的兜底条件是:

```ts
elapsed > timeline.totalTicks * 2 + 20   // 最长转场 182 tick → 兜底 384 tick ≈ 19 秒
```

命中即强制 `finish()`:清相机、恢复输入、释放 ticking area、补一次位移、resolve 挂起的 Promise。
没有这条兜底,一次相机异常就会让玩家永久失去移动能力。

## 12. 复现清单

```bash
cd mods/teleporter

# 1. 相机成员是否全部受限(两个数应相等)
awk '/^export class Camera /,/^}/' node_modules/@minecraft/server/index.d.ts | grep -cE "^\s+\w+\("
awk '/^export class Camera /,/^}/' node_modules/@minecraft/server/index.d.ts | grep -c "can't be called in restricted-execution mode"

# 2. rotation 的字段顺序(x 是俯仰)
grep -n "export interface CameraSetRotOptions" -A 6 node_modules/@minecraft/server/index.d.ts

# 3. fade 三段时长与合并规则
grep -n "export interface CameraFadeTimeOptions" -A 20 node_modules/@minecraft/server/index.d.ts

# 4. InputPermissionCategory 的覆盖范围
grep -n "export enum InputPermissionCategory" -A 60 node_modules/@minecraft/server/index.d.ts

# 5. tickingAreaManager 挂在 World 上
grep -n "readonly tickingAreaManager" node_modules/@minecraft/server/index.d.ts
grep -n "export interface TickingAreaOptions" -A 20 node_modules/@minecraft/server/index.d.ts

# 6. 内置预设清单(外部依据)
#    见 https://zh.minecraft.wiki/w/命令/camera 的「参数」节
```

游戏内侧的复现步骤见 §6(跨维度不存续)。
