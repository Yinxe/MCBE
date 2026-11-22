# Design

## Context

动机见 `proposal.md — Why`;行为契约见 `specs/teleporter/spec.md`。

现状与约束:

- 传送的执行方式由 `core/transition.ts` 的 `resolveTransitionMode({ style, crossDimension })` 纯函数决定,返回 `"immediate" | "fade" | "cinematic"`。适配层 `mc/teleport.ts` 按结果调用 `teleportImmediate` / `playFadeTransition` / `playTransition`。
- `playFadeTransition` 目前是硬编码时长的:`fadeIn 0.2s / hold 0.15s / fadeOut 0.3s`,合计 0.65 秒。位移在 `fadeIn + hold/2` 处提交(约 5.5 tick)。
- 三个死亡点回传入口都经由同一个函数 `teleportToSavedPoint(player, label, location, dimensionId)`:
  - `mc/commands.ts` — `/tpa:back`
  - `mc/ui/deathPoints.ts` — 死亡点列表
  - `mc/events.ts` — 死亡重生后的回传对话框
- 该函数目前没有表达「这次传送是什么语义」的能力,只能靠全局风格决定。调用点分布在命令、界面、事件三种上下文,但都已经是 `async`,可以 `await`。
- 现有测试分两层:`core/` 的纯逻辑单测(101 项),以及 `tests/harness/` 下用 mock 脚本 API 驱动适配层的验证脚本(`verify:transition`、`verify:token`)。

## Goals / Non-Goals

**Goals:**

- 让「死亡点回传」成为一种**显式声明的传送意图**,由纯逻辑分派,而不是在三个调用点各写一遍 if。
- 快速淡入的时长可配置在代码内(常量),但**不暴露给玩家**——它是安全相关的行为,不是观感偏好。
- 保持既有调用方的默认行为不变:不声明意图时走原逻辑。

**Non-Goals:**

- 不新增玩家可见的配置项。死亡点回传的降档是安全取舍,不给玩家「把回传也变成运镜」的开关。
- 不改动运镜本身的任何参数(时序、高度、抖动、音效)。
- 不为死亡点回传单独做一套音效。快速淡入期间不播音效——0.4 秒内塞音效只会显得杂乱。
- 不改动传送点、公共传送点、玩家间传送、玩家传送界面的行为。

## Decisions

### 用「传送意图」枚举表达语义,而不是布尔开关

```ts
export type TeleportIntent = "normal" | "deathPoint";
```

替代方案一:`teleportToSavedPoint(..., isDeathPoint: boolean)`。否决原因是布尔参数在调用点读不出含义——`teleportToSavedPoint(player, label, loc, dim, true)` 里的 `true` 指什么需要翻签名;枚举名直接说明语义,且将来若出现第三种意图(例如「紧急脱困」)只需扩联合类型。

替代方案二:按目标名称或标签推断(例如 label 为「死亡点」时降档)。否决原因是把行为绑在文案上——改一次提示语就会静默改变传送方式,是隐蔽的耦合。

### 分派规则仍放在 `core/transition.ts`,顺序写死

```ts
export function resolveTransitionMode(input: {
  style: TransitionStyle;
  crossDimension: boolean;
  intent: TeleportIntent;
}): TransitionMode
```

判定顺序:

1. `style === "off"` → `immediate`
2. `intent === "deathPoint"` → `fade`(由适配层用快速时长执行)
3. `crossDimension` → `fade`(常规时长)
4. 其余 → `cinematic`

**顺序即语义**。第 1 条在最前,落实「关闭禁用一切动画」;第 2 条在跨维度判断之前,因为死亡点回传跨维度时也该用快速淡入,而不是常规淡入淡出。

这里有个必须说清的取舍:规则 2 与 3 都返回 `"fade"`,但两者时长不同。**返回值刻意不区分时长**,因为时长是执行细节,不是行为契约;由适配层根据 `intent` 决定传哪组时长。若让纯函数返回 `"fade" | "quickFade"` 两种模式,`TransitionMode` 就混进了「多快」这个维度,将来加第三种时长会继续膨胀。保持 `fade` 单一语义,时长在调用侧选。

### 快速淡入的时长:0.15 / 0.05 / 0.15 秒

合计 0.35 秒,比常规 0.65 秒快约 46%。

- 下限约束:引擎的三段时长之和不足 0.5 秒时,保持段会自动延长到补足 0.5 秒(见 `docs/research/bedrock-camera-api.md` §7)。因此**实际总时长不会低于 0.5 秒**,0.35 的设定值只是让三段尽可能短,最终由引擎夹到 0.5。
- 这个下限是好事:它防止把时长压到玩家来不及感知的程度。
- 保持段取 0.05 秒而不是 0:位移提交点算在 `fadeIn + hold/2`,hold 过小会让提交点贴近淡入结束,存在「淡入还没完全遮黑就位移」的竞态。留 0.05 秒给它一点余量。

### `playFadeTransition` 增加时长参数,而不是复制一份实现

```ts
export interface FadeTiming {
  fadeInTime: number;
  holdTime: number;
  fadeOutTime: number;
}

export function playFadeTransition(
  player: Player,
  target: TransitionTarget,
  timing?: FadeTiming,   // 缺省用常规时长
): Promise<boolean>
```

替代方案:新增 `playQuickFadeTransition`。否决原因是两者逻辑完全相同(遮黑、在 hold 段位移、淡出后清相机),只差三个数字。复制一份会让「位移提交点怎么算」「清相机要几道」这类逻辑出现两份,后续修 bug 必须记得改两处——本项目已经在相机交还上踩过一次这类坑。

### 调用点改动的形态

`teleportToSavedPoint` 与 `teleportPlayerTo` 增加一个**可选**参数:

```ts
export async function teleportToSavedPoint(
  player: Player,
  label: string,
  location: Vector3,
  dimensionId: string,
  intent: TeleportIntent = "normal",
): Promise<boolean>
```

三个死亡点调用点显式传 `"deathPoint"`;其余七个调用点不动。默认值保证既有行为不变,也让「漏标」的表现是退回电影感运镜(可观察、可测试),而不是崩溃。

### 为什么不在配置里暴露

死亡点回传降档的理由是**安全性**:运镜期间输入冻结,玩家在危险位置无法自保。把它做成可配置项,等于给玩家一个「让自己更容易再死一次」的开关。这类取舍应当由模组决定,不交给配置。

## Risks / Trade-offs

- **引擎把总时长夹到 0.5 秒,导致「快速」不够快** → 0.5 秒已比运镜的 3–5 秒快一个数量级,达到目的;若实测仍嫌慢,唯一手段是跳过淡出直接 `clear()`,但会造成画面硬切,不采纳。
- **某个死亡点入口漏传 `intent`** → 该入口退回运镜。用纯逻辑单测钉住分派规则,并在实现时逐条核对三个调用点;`tasks.md` 里把「核对三个入口」列为独立任务。
- **玩家已经习惯死亡点回传有运镜** → README 说明理由;这是刻意的行为变更,不做兼容开关。
- **`TransitionMode` 不区分快慢,可能让后来者误以为死亡点用的是常规时长** → 在 `resolveTransitionMode` 的注释与 README 里写明「`fade` 的时长由调用方按 intent 选择」,避免误解。
- **`playFadeTransition` 增加可选参数,旧调用点行为不变** → 这是有意的向后兼容;但若将来有人给死亡点以外的入口传了 `deathPoint` 意图,会静默变快。风险由 intent 是显式枚举名缓解(误写概率低)。

## Migration Plan

1. 纯逻辑层先行:`TeleportIntent` 类型 + `resolveTransitionMode` 新签名 + 单测。此步不改变任何运行时行为(所有调用点仍传默认 `"normal"`)。
2. 适配层:`playFadeTransition` 加时长参数与两组常量;`teleport.ts` 两个函数加可选参数并透传。
3. 三个死亡点调用点传 `"deathPoint"`。
4. 回归:既有 101 项单测应全部通过(默认意图不变),新增用例覆盖分派顺序与快速时长。

回滚:删除三个调用点传的 `"deathPoint"` 即可退回原行为,不需要动纯逻辑层。

## Open Questions

- 0.15 / 0.05 / 0.15 这组数值是否合适,需要游戏内实测确认「快但不闪」。若实测觉得割裂,可上调到 0.2 / 0.1 / 0.2(合计 0.5,不受引擎下限影响),不改变 spec 的「明显更短」要求。
- 是否需要在快速淡入期间保留一声提示音?当前设计选择不播,理由是 0.5 秒内音效会与画面切换打架。若实测觉得「没有声音不知道传送了」,可以加一声极短的提示,不改变 spec。
