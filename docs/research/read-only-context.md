# 只读上下文:哪些 API 必须推迟到安全 tick

## 1. 结论速查

Bedrock 的脚本引擎存在两种执行上下文:

| 上下文 | 何时处于该上下文 | 能做什么 |
| --- | --- | --- |
| **只读(受限)** | 自定义命令回调、`beforeEvents` 订阅回调 | 只能读取与发消息;调用受限 API 会抛错 |
| **安全(可写)** | `system.run` / `system.runTimeout` / `system.runInterval` 的回调、`afterEvents` 订阅回调 | 全部 API |

报错文案形如:

```
cannot be called in read-only mode
```

关键点:**受限的不是「写操作」这个语义类别,而是类型声明里被标注的成员**。`sendMessage`、`setDynamicProperty`、`onScreenDisplay.setActionBar` 都是写操作,但它们**不在**受限名单里,在命令回调中可以直接调用。反过来,`subscribe` 这类订阅动作也在受限名单里(见 §3.1)。

因此判断依据只能是 `index.d.ts` 的 doc block,不能凭直觉。

## 2. 两种标注

`@minecraft/server` 的 `index.d.ts` 用两种措辞区分方法与属性:

| 标注 | 适用 | 含义 |
| --- | --- | --- |
| `This function can't be called in read-only mode.` | 方法 | 在只读上下文中**调用**会抛错 |
| `This property can't be edited in read-only mode.` | 属性 | 在只读上下文中**赋值**会抛错 |

`@minecraft/server@2.1.0` 的实测计数:

| 标注 | 条数 |
| --- | --- |
| `can't be called in read-only mode` | 268 |
| `can't be edited in read-only mode` | 73 |
| 合计受限成员 | **341** |

另有 131 条 `can be called in early-execution mode` / 74 条 `can be read in early-execution mode`,那是**另一个维度**的约束(启动期可用性),与只读上下文无关,不要混淆。

## 3. 与本仓库相关的成员

### 3.1 事件订阅本身也受限

所有 `*AfterEventSignal.subscribe()` / `unsubscribe()` 都标注了 `can't be called in read-only mode`。这意味着订阅动作**必须在 startup 阶段完成**,不能在命令回调里动态订阅。

这条容易被忽略,因为「订阅」读起来不像写操作。上游 teleporter 在 `system.beforeEvents.startup` 内一次性订阅,恰好正确。

### 3.2 必须推迟的成员(本仓库实际会用到)

| 成员 | 标注 |
| --- | --- |
| `Entity.teleport()` / `Entity.tryTeleport()` | call |
| `Entity.runCommand()` / `Dimension.runCommand()` | call |
| `Dimension.spawnItem()` / `spawnEntity()` / `spawnParticle()` | call |
| `Dimension.setBlockPermutation()` / `fillBlocks()` / `setWeather()` | call |
| `Dimension.playSound()` / `Player.playSound()` | call |
| `Player.setGameMode()` | call |
| `Player.setSpawnPoint()` | call |
| `Player.spawnParticle()` | call |
| `Player.addLevels()` / `addExperience()` / `resetLevel()` | call |
| `Player.startItemCooldown()` | call |
| `Container.addItem()` / `setItem()` / `clearAll()` / `swapItems()` / `moveItem()` | call |
| `ContainerSlot.setItem()` / `setLore()` / `setCanDestroy()` / `setCanPlaceOn()` | call |
| `ItemStack.setLore()` / `setCanDestroy()` / `setCanPlaceOn()` | call |
| `EntityEquippableComponent.setEquipment()` | call |
| `Entity.addEffect()` / `applyDamage()` / `kill()` / `triggerEvent()` | call |
| `Entity.setRotation()` / `lookAt()` / `clearVelocity()` / `applyImpulse()` | call |
| `Entity.setProperty()` / `resetProperty()` / `addTag()` / `removeTag()` | call |
| `ScreenDisplay.setTitle()` / `updateSubtitle()` / `setActionBar()` | call |
| `System.sendScriptEvent()` | call |
| `World.setTimeOfDay()` / `setDifficulty()` / `setDefaultSpawnLocation()` | call |
| `GameRules.*`(37 个属性) | edit |
| `Entity.isSneaking` / `Entity.nameTag` | edit |
| `Player.commandPermissionLevel` / `selectedSlotIndex` | edit |
| `ItemStack.amount` / `keepOnDeath` / `lockMode` / `nameTag` | edit |

### 3.3 可以安全调用的成员

| 成员 | 说明 |
| --- | --- |
| `Player.sendMessage()` / `World.sendMessage()` | 无标注 |
| `Entity.setDynamicProperty()` / `getDynamicProperty()` | 无标注 |
| `World.setDynamicProperty()` / `getDynamicProperty()` | 无标注 |
| `Player.onScreenDisplay` | 属性本身无标注(其方法受限,见 §3.2) |
| `EntityEquippableComponent.getEquipment()` | 无标注 |

**这解释了为什么上游代码在命令回调里直接 `sendMessage` 不报错,而直接 `teleport` 会失败。**

## 4. 实践规则

1. 回调体**只做参数解析与鉴权**。任何涉及 §3.2 成员的操作都用 `system.run` 推迟。
2. **不要双层包裹**。若已用统一的执行助手(如 `@mc-toolchain/ui` 的安全上下文执行助手),回调体内不再手动 `system.run`,否则多一层 tick 延迟。
3. 推迟后**重新校验对象有效性**:`system.run` 到下一 tick 之间玩家可能离线,应检查 `player.isValid` 后再操作。
4. 执行助手**必须捕获回调抛出的错误**。否则 `system.run` 内的异常会成为 unhandled rejection 静默消失,表现为「点了没反应」。

## 5. 可复现的验证方式

```bash
# 统计某个版本的受限成员条数
DTS=$(npm root)/@minecraft/server/index.d.ts
grep -c "can't be called in read-only mode" "$DTS"
grep -c "can't be edited in read-only mode" "$DTS"

# 查某个具体成员是否受限(取声明前 20 行内的 doc block)
grep -B20 "    teleport(" "$DTS" | grep -c "read-only mode"
```

更完整的逐个成员提取(需要区分 class 归属与 method/property)用下面的脚本:

```js
// node --input-type=module -e "$(cat read-only-scan.mjs)" <path-to-index.d.ts>
import { readFileSync } from "node:fs";

const lines = readFileSync(process.argv[2], "utf8").split("\n");
const clsRe = /^\s*(?:export )?(?:declare )?(?:abstract )?(class|interface|enum|type|namespace)\s+([A-Za-z_]\w*)/;
const declRe = /^(\s{4})((?:readonly )?(?:static )?)(?:get |set )?([A-Za-z_]\w*)\s*(\(|<|:|\?|;)/;

const records = [];
let current = null;
let i = 0;
while (i < lines.length) {
  const cls = clsRe.exec(lines[i]);
  if (cls) current = cls[2];
  if (lines[i].trim().startsWith("/**")) {
    const start = i;
    while (i < lines.length && !lines[i].includes("*/")) i++;
    const end = i;
    // doc block 结束后,中间只允许空行
    let j = end + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    const decl = declRe.exec(lines[j] ?? "");
    if (decl) {
      const block = lines.slice(start, end + 1).join("\n");
      const kind = decl[4] === "(" ? "method" : "property";
      const ro = block.includes("can't be called in read-only")
        ? "call"
        : block.includes("can't be edited in read-only") ? "edit" : null;
      if (ro) records.push({ owner: current, member: decl[3], kind, ro });
    }
  }
  i++;
}

const byOwner = new Map();
for (const r of records) {
  if (!byOwner.has(r.owner)) byOwner.set(r.owner, []);
  byOwner.get(r.owner).push(r);
}
for (const [owner, rs] of [...byOwner].sort()) {
  console.log(`${owner} (${rs.length}): ${rs.map((r) => r.member + (r.kind === "method" ? "()" : "")).join(", ")}`);
}
console.log(`\n合计 ${records.length} 个受限成员`);
```

## 6. 本仓库的承载点

| 位置 | 承担什么 |
| --- | --- |
| `packages/ui` 的安全上下文执行助手 | 唯一的推迟实现;所有模组的回调经它进入安全上下文,并在此捕获异常 |
| `openspec/specs/shared-ui/spec.md` | 「受限上下文的回调必须推迟执行」一条,含判据与场景 |
| `openspec/specs/teleporter/spec.md` | 命令回调只做解包与鉴权,写操作必须推迟 |

在本文档之前,这条知识只存在于两处代码注释里(`mods/auto-refill/scripts/AdminMenu.ts`、`mods/spectator-mode/scripts/mc/commands.ts`),任何新模组都可能漏掉。

## 7. 历史教训

迁移 `teleporter` 时曾计划把外部 `@yinxe/toolkit` 的 `defineCommand` 换成原生 `registry.registerCommand`,并认为这只是「去掉一层语法糖」。实际 `defineCommand` 的内部是:

```ts
registry.registerCommand(config, (origin, ...args) => {
  // ...玩家来源校验
  runSafeAsync(() => { handler({ origin, player, params }); });  // runSafeAsync = system.run + Promise
  return { status: 0, message: undefined };
});
```

它同时隐藏了**自动推迟**与**玩家来源校验**两个契约。把封装换成直连,等于亲手拆掉推迟逻辑,命令会「返回成功但什么都没发生」。

教训:**替换一个封装前,必须读它的实现,并逐条列出它替你承担了什么。** 「等价替换」的等价性要证明,不能假设。
