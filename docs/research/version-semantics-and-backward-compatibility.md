# 版本号语义与向后兼容机制

回答三个反复困扰的问题：

1. `manifest.json` 里的 `min_engine_version` 和 `package.json` 里的 `@minecraft/server` 版本号，作用有什么不同？
2. 游戏版本比包声明的更新时，为什么旧包还能跑？
3. 反过来，游戏版本比包声明的更旧时，会发生什么？

结论都有可复现的验证命令。数字有时效性，**方法**没有。

## 1. 结论速查：四个版本号各管什么

| 字段 | 所在文件 | 作用 | 何时被消费 | 写错/写高的后果 |
| --- | --- | --- | --- | --- |
| `header.min_engine_version` | `manifest.json` | **游戏版本门槛 + 旧行为开关** | 加载阶段 | 高于本机版本 → 包被拒绝加载 |
| `header.version` | `manifest.json` | **包的身份版本**，用于升级覆盖 | 导入阶段 | 只影响「能否替换已装的同 UUID 包」，不影响运行 |
| `modules[].version` | `manifest.json` | 模块版本，仅用于标识变更 | 导入阶段 | 同上，纯标识 |
| `dependencies[].version`（`module_name` 项） | `manifest.json` | **选择 Script API 的 API 面（API surface）** | 脚本引擎启动阶段 | 高于本机提供版本 → 脚本不启动 |
| `package.json#dependencies["@minecraft/server"]` | `package.json` | **仅编译期类型**，不进包 | 开发期 `tsc` | 与 manifest 不一致时，类型检查通过但运行时缺 API |

### 最容易混淆的一对

`min_engine_version` 与 `dependencies[].version` **互不替代**：

- `min_engine_version` 是「**要求游戏至少多新**」
- `dependencies[].version` 是「**要求脚本引擎至少提供哪一版 API 面**」

两者可以不等价。例如 `min_engine_version: [1,21,90]` + 依赖 `2.1.0` 的组合在语义上是矛盾的：1.21.90 的游戏只提供 2.0.0，无法满足 2.1.0 的依赖。这种组合不会在打包期报错，只会在低版本游戏的运行日志里报错。

### `package.json` 的版本号不进包

这一点必须明确：`package.json` 里的 `@minecraft/server` 版本**只是 `npm install` 拿类型定义用的**，打包产物里根本不存在它。游戏只读 `manifest.json`。

因此**两处必须手工保持一致**，否则会出现「编译期用的是 2.1.0 的类型，manifest 声明的是 2.0.0」这种错位——类型检查发现不了，运行时才炸。

> `packages/mod-packaging` 的 `synchronizePackVersions` 只同步 `header.version`、`modules[].version`、`header.min_engine_version` 与「资源包对行为包的依赖版本」，**从不改写 `dependencies[]` 里的 `@minecraft/server` 版本**。那一行是手写常量。

## 2. `min_engine_version` 的双重身份：门槛 + 行为开关

它不只是「能不能装」，还决定包内所有 JSON 内容按**哪个版本的语义**解释。官方定义（[Add-on manifest reference](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/addonsreference/examples/addonmanifest)）：

> This is the minimum version of the game that this pack was written for. … This helps the game identify whether any backwards compatibility is needed for your pack.

「backwards compatibility」指的就是这个开关。`bedrock-wiki` 记录了几处具体表现：

| 受影响的机制 | 分界点 | 出处 |
| --- | --- | --- |
| `execute` 命令语法（新旧两套） | 1.19.50 | `docs/commands/mcfunctions.md` |
| 辅助值（aux value）vs 方块状态 | 1.19.70 | `docs/commands/block-states.md` |
| 配方解锁（`unlock` 数组） | 1.20.11 | `docs/loot/recipes.md` |
| 方块状态可用性 | 1.20.20 | `docs/blocks/block-states.md` |
| Molang 表达式语义 | 分档 | `docs/concepts/molang.md` |
| 实体 `min_engine_version` 上限（persona 皮肤） | ≤ 1.13.0 | `docs/entities/entity-intro-rp.md` |

所以 `min_engine_version` **不能随手写低**——写低会连带把包内 JSON 的语义拉回旧版，可能反而破坏内容。它应当写成「本项目实际开发所依据的版本」。

## 3. 高版本游戏跑低声明包：靠语义化版本承诺

官方承诺（[Script Module Versioning](https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/versioning)）：

> Minor and patch version increments could imply new functionality and API signature additions, but should be backwards-compatible within the same major version.
>
> … if a script module has a dependency on version `1.3.0` of the `@minecraft/server` API, it may actually have that dependency fulfilled with `1.8.0` of the `@minecraft/server` - and those script modules should continue to function as expected. For those familiar with NPM semantic versioning, this is similar to the `^` signifier within version dependencies.

即 **声明 `2.1.0` ≡ 要求「≥2.1.0 且 <3.0.0」，实际由游戏提供它自己的最高 2.x**。

### 实测验证：同 major 内只增不删

用官方 `bedrock-samples` 提供的模块元数据（`metadata/script_modules/@minecraft/server-bindings_<version>.json`）比对类清单：

```bash
cd ~/gitRepos/bedrock-samples/metadata/script_modules/@minecraft
python3 - <<'EOF'
import json
def cls(v):
    d = json.load(open(f"server-bindings_{v}.json"))
    return set(c["name"] for c in d.get("classes", []))
a, b = cls("2.0.0"), cls("2.6.0")
print("2.0.0 类数:", len(a), " 2.6.0 类数:", len(b))
print("2.0.0 有而 2.6.0 没有（破坏性移除）:", sorted(a - b) or "(无)")
print("2.6.0 新增:", len(b - a))
EOF
```

实测输出：

```text
2.0.0 类数: 279  2.6.0 类数: 375
2.0.0 有而 2.6.0 没有（破坏性移除）: (无)
2.6.0 新增: 96
```

结论：2.x 内**没有任何类被移除**，承诺成立。所以低声明包在新版游戏上不仅「能跑」，还能拿到新 API。

### 方向是不对称的

| 场景 | 结果 |
| --- | --- |
| 包声明 `2.1.0`，游戏是 1.26（提供 2.6.0） | ✅ 正常。依赖被 2.6.0 满足，代码拿到 2.6.0 的 API 面 |
| 包声明 `2.6.0`，游戏是 1.21.100（只提供 2.1.0） | ❌ 无法满足，脚本不启动 |
| 包声明 `2.1.0`，但代码调用了 2.6.0 才有的 API | ⚠️ 装 2.1.0 做类型检查会报错；若绕过，运行时是 `undefined` |

第二行的实际表现是脚本引擎日志里的 `requesting a invalid module version`，且**该行为包的脚本完全不执行**（不是部分降级）。

## 4. 关键 API 的首次可用版本（实测）

用 `npm pack` 取各版本的类型定义直接 `grep`：

```bash
cd /tmp && for v in 2.0.0 2.1.0 2.6.0; do
  npm pack @minecraft/server@$v --silent >/dev/null 2>&1
  mkdir -p x-$v && tar xzf minecraft-server-$v.tgz -C x-$v
  echo -n "$v  customCommandRegistry="; grep -c "customCommandRegistry" x-$v/package/index.d.ts
  echo -n "     entityHeal=";               grep -cE "^    readonly entityHeal:" x-$v/package/index.d.ts
done
```

| API | 首次可用 | 用途 |
| --- | --- | --- |
| `StartupEvent.customCommandRegistry` | **2.1.0**（Minecraft 1.21.100） | 注册原生自定义命令 |
| `CommandPermissionLevel` | **2.1.0** | 命令权限等级 |
| `CustomCommandOrigin` | **2.1.0** | 命令来源判定 |
| `world.afterEvents.entityHeal` / `EntityHealAfterEvent` | **2.6.0**（Minecraft 1.26.10） | 观测治愈事件（图腾触发的合成事件） |

`entityHeal` 的探测有个坑：`grep -c "entityHeal"` 在 2.0.0 上会返回 1，因为 `entityHeal` 是 `entityHealthChanged` 的前缀子串。必须带上冒号做精确匹配 `grep -E "^    readonly entityHeal:"`，否则会得到「2.0.0 已有该事件」的错误结论。

实测对照（三列分别是裸 `entityHeal`、带冒号精确匹配、`customCommandRegistry`）：

| 版本 | 裸 `entityHeal` | `readonly entityHeal:` | `customCommandRegistry` |
| --- | --- | --- | --- |
| 2.0.0 | 1（假阳性） | **0** | 0 |
| 2.1.0 | 1（假阳性） | **0** | 1 |
| 2.6.0 | 3 | **2** | 1 |

## 5. 声明与代码必须自洽

一套自洽的声明要同时满足三条：

1. `dependencies[].version` ≤ 目标最低游戏版本所提供的最高 API 版本
2. 代码用到的每个 API 在 `dependencies[].version` 那一档里都存在
3. `package.json` 的 `@minecraft/server` 版本 == `manifest.json` 的 `dependencies[].version`

第 3 条是纯工程约定，不是游戏要求，但不遵守就会让类型检查失去意义。

### 反例：`pnpm overrides` 掩盖错位

上游 `auto-refill` 的实际做法：

```yaml
# ~/gitRepos/../MCBE/pnpm-workspace.yaml
overrides:
  "@minecraft/server": "2.8.0"
```

所有 workspace 包被强制收敛到 2.8.0，**类型检查用的是 2.8.0**；而 `manifest.json` 声明的是 `"version": "2.0.0"`。于是 `entityHeal`、`customCommandRegistry` 在类型检查时畅通无阻，但声明告诉游戏「我只要 2.0.0 的 API 面」。这段错位在 1.21.90 上会真实暴露。

### 优雅降级的写法

当某个 API 在目标最低版本上不存在，但希望在新版本上可用时，必须做**运行时特性侦测**，不能直接解引用：

```ts
// ✅ 事件订阅：属性不存在时静默跳过
if (world.afterEvents.entityHeal) {
  world.afterEvents.entityHeal.subscribe(handler);
}

// ✅ startup 回调：registry 不存在时不注册
system.beforeEvents.startup.subscribe((event) => {
  if (!event.customCommandRegistry) return;
  event.customCommandRegistry.registerCommand(...);
});
```

注意 TypeScript 的陷阱：若 `dependencies[].version` 是 2.1.0，而 `package.json` 也装 2.1.0，那么 `event.customCommandRegistry` 在类型上**总是存在**的，`if (!event.customCommandRegistry)` 会被判定为恒假。这种守卫只对「类型版本低于运行版本」的情况有意义，属于刻意为之的防御，需要注释说明。

## 6. `bedrock-wiki` 的 N-1 建议与本项目的取舍

官方对公开发布内容的建议是「`min_engine_version` 与脚本模块版本都保持在当前版本的前一个次版本（N-1）以内」，理由是玩家升级游戏有滞后。

本项目**不采用** N-1，理由：

- 本项目的模组是自用/小范围分发，不存在大量滞后玩家
- 功能取舍由具体 API 需求决定（例如需要 `customCommandRegistry` 就必须 ≥1.21.100）
- 把 `min_engine_version` 写低会连带改变包内 JSON 的语义（见第 2 节），反而引入风险

因此本项目的原则是：**`min_engine_version` 取「实际用到的最高 API 所需的最低游戏版本」，然后显式写进 `packing.minimum_engine_version`，不依赖推导。**

## 7. 校验工具的态度

`mct validate` 对 `min_engine_version` 有 18 条规则（[Min Engine Version 规则表](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/mctoolsvalreference/minenginever)），关键几条：

| 规则 | 触发条件 | 严重级 |
| --- | --- | --- |
| `MINENGINEVER111` | BP 的 `min_engine_version` **major** 高于当前游戏版本 | 🔴 Error（包可能不加载） |
| `MINENGINEVER121` | BP 的 `min_engine_version` **minor** 高于当前游戏版本 | 🔴 Error |
| `MINENGINEVER131` | BP 的 `min_engine_version` **patch** 高于当前游戏版本 | 🟡 Warning |
| `MINENGINEVER120` | BP 的 `min_engine_version` minor **低于**当前游戏版本 | 🟡 Warning |

注意这是「与**运行 `mct` 时所用工具链内置的游戏版本**比较」，不是与玩家游戏版本比较。所以本地校验通过不代表低版本玩家能装。

`mct validate` **不校验** `dependencies[].version` 与 `min_engine_version` 的一致性，也不校验它与 `package.json` 的一致性。这两项目前只能靠人工约定 + code review。

## 8. 复现环境

| 项 | 值 |
| --- | --- |
| Node.js | v24.21.0 |
| `@minecraft/server`（探测用） | 2.0.0 / 2.1.0 / 2.6.0 / 2.8.0 |
| `bedrock-samples` | `~/gitRepos/bedrock-samples`（`version.json` 截至 1.26.60.5） |
| `bedrock-wiki` | `~/gitRepos/bedrock-wiki` |
| 系统日期 | 2026-11-08 |

> 版本数字会过期，**验证方法不会**。升级工具链或调整兼容下限时，请重跑第 3、4 节的脚本重新确认，不要直接沿用上表。
