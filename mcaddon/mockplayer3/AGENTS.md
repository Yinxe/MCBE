# mockplayer3

This file provides guidance to the AI agent when working with code in this repository.

> 模拟玩家（假人）Addon，OOP 全新重写。

## 分层与依赖纪律（机检级）

`scripts/` 四层：`domain/`（纯逻辑）→ `engine/`（唯一触碰 `@minecraft` 世界行为）→ `application/`（唯一有权改变世界状态的编排：生命周期/模式/调度/能力相位机）→ `interface/`（命令/面板/通知，只翻译意图）。`main.ts` 为 4-Phase 组合根。

- `domain/` 禁止 `@minecraft/*`、`@yinxe/*` import 与任何 IO——全部 `node:test` 可测。
- `@minecraft/server-gametest` 仅 engine（Rig/Compat）。
- `world.getPlayers/getEntity` 仅 `engine/EntityGateway.ts`。
- `as any` 仅 `engine/Compat.ts`（每条注 F 编号台账）。
- interface 不 import engine/domain 持久化；application 不反向依赖 interface。

## 版本与发版纪律（用户规格 2026-09-29，覆盖根 §5 在本模块的适用）

- **版本号只在用户明说"打包/发版"时动**；日常修 bug、写功能、跑验证一律不改 `package.json#version`，也不改 `BP/RP manifest` 版本字段。
- 动的时候**每次只 +patch（+0.0.1）npm version patch**；**未经用户实机验收通过，不得 +0.1.0/+1.0.0**——未验收的功能不占版本号。
- 功能是否"验收通过"由用户判定，不由 agent 推断：agent 不得把"代码写完 + 离线测试绿"当作验收。
- **禁用 `pnpm run build` 做日常验证**：它的 `update-version` 钩子会把 package.json 版本灌进 BP/RP manifest（release-only 副作用，实测污染过工作副本）。类型检查用 `npx tsc --noEmit -p tsconfig.json`，离线测试用 `pnpm run test:core`，两者都不碰版本字段。

## 包标识与数据命名空间

- BP/RP 的 header 与全部 module uuid 沿用 mockplayer v2 基线值：同 uuid 安装即替换旧包，旧包不会与新包共存（同世界如需回退验证，先导出旧包数据）。
- script module 显式 `"module_name": "MockPlayer"`：世界动态属性(DP)按模块命名空间隔离，v2 数据键（`mockplayer:players:*`、`nds:item:*` 等）实际存储为 `MockPlayer:<键>`，命名空间不一致时新包 `getDynamicPropertyIds()` 枚举不到旧键，迁移检测恒假。缺省值取 BP 文件夹名，勿依赖缺省。
- 迁移完成前不得改动以上任何标识；改 UUID 不解决数据读取，改 module_name 才解决。

## 命令

- `pnpm run build` / `pnpm run pack`（产出 `.mcaddon` 双包；BP→RP 依赖由 just.config `update-version` 在 release 时注入，工作副本 manifest 不带）。**二者均属发版动作，须用户明示**，见上节。
- `pnpm run test:core`（`tsconfig.test.json` 编译 + `node --test`）。
- `pnpm run local-deploy`（watch 增量部署）。
- lint 面排除 `lib/**`（tsc 产物，注释指令会报 rule not found）。

## 关键引擎事实速查（详见 04-知识底座，勿凭直觉改）

- GameTest 生成体旋转逐 tick 锁回 (0,-135)：装置只做中转出生 (0,8,0) → 立即 teleport 离开（F-01/F-02）；装置几何/时序实测结论勿改（结构方块 (0,0,0)、注册→40t→tickingarea→runthis）。
- disconnect 名字释放 ≥20t；撞名引擎加 `(2)` → 名字仲裁 + 生成后验名（F-03）。
- `respawn()` 仅 entityDie before 回调内可调（F-04）。
- 假人生成自带空背包：恢复（epoch 提交）前一切保存被 SaveGate 挡下（F-26/ADR-5）。
- 注视一律租约化（HOLD 带 TTL / AIM_ONCE 执行即中性化）（F-06）。
- 容器不走右键，`minecraft:inventory` 组件直读直写 + 写后 2t 回读；interact 节流 ≥4t（F-12/F-13）。
- tickingarea circle r=4 实占 49 列；早期禁 getBlock 探路（F-20）。
- register 篡改游戏规则 → 回调内立即写回（F-21）；世界结构 `mockplayer:void` 由 BP structures 提供，勿删；GameTest 注册标识与测试维度名（`mockplayer:test`）沿用 v2 基线——存档装置命令方块写死旧标识，改名 runthis 复用必败。
- tick 回调同步、短、无 await、无自旋（F-18）；长流程 = 相位机 + nextWakeAt 单一时钟（D-05）。

## 编程模式（script；参考旧版 archive/mock-player 3.1.6 重写）

落位与分工：

- `domain/ScriptRules.ts`：脚本模型（12 种步骤）/ 模块目录 / 文本规格解析 / 存档归一化 / 中文描述 / 上限常量。命令与面板共用同一份解析，不得各自解释。
- `domain/ScriptCursor.ts`：执行游标（顺序 / 整段循环 / 跳转 / 连续跳转死循环护栏）——纯状态机，可离线单测。
- `domain/ScriptStatus.ts`：运行状态板（阶段/当前条/轮次/原因；进程内存活，删假人清）。
- `engine/ScriptStore.ts`：脚本落盘（独立 DP 键 `mp:script:<botId>`；读回归一化、空脚本删键、写入带 24KB 体积护栏）。
- `engine/`：新增原子只有三个——`Mover.navigateFar`（长距离自动分段）、`Placer.placeAt`（按坐标放置）、`EntityOps.say/jump`（说话/跳）。其余全部复用既有原子（`breaker.breakAt`、`panelOps.useItemOnce`、`attacker.swing`、`gaze.forceLook`、`ops.setSneaking`）。
- `application/ScriptLibrary.ts`：脚本库——命令与面板的**唯一读写口**（读缓存 / 归一化写入 / 版本号 / 重跑请求 / 状态板）。
- `application/Capabilities/Script.ts`：常驻协程执行脚本；`tick` 只做看门狗（续 hands/motion 租约 + 存活检查），业务节拍全在协程的 await 里。
- `interface/Commands.Script.ts`（`/mp:script`，动作枚举）与 `interface/Panels/Script.ts`（面板：整段文本编辑为主路径）。

纪律：

1. 运行态只有 `workMode === "script"` 一个真源，不引入 `scriptRunning` 之类的第二标记。
2. 重跑靠版本号（写入即 +1），执行器在**步骤边界**换用新脚本重开；不要用轮询计数或内容指纹。
3. 失败按脚本的 `onFail` 处理（停下并私信主人 / 跳过该条），**模式不自动切换**。
4. 脚本落盘不许塞进 `BotRecord`（档案每次对账整条读写）；坏档一律过 `normalizeProgram`。

测试面：`tests/domain.ScriptRules.test.ts`（解析/归一化/往返/描述）、`tests/domain.ScriptCursor.test.ts`（顺序/循环/跳转/护栏）。

## 注释纪律（按正常项目写：只写事实，不写设计史）

- 注释只陈述**事实与约束本身**——几何口径、时序、不变量、失败语义。不写复盘叙事、验收日期、「用户规格/实测 2026-…」、归档对位；引擎常量注明「实测值、改动需附证据」这类事实来源可以写。
- 进注释的台账只有 **F-NN**（`04-知识底座` 引擎事实，可查）。`ADR-N`/`D-0N`/`FR-xxx`/`NFR-xxx`/`章§` 对就地阅读无信息量，一律不写；**缺NN 只进 `docs/mockplayer/11-…` 与提交信息，不进代码注释**。
- 一行一个事实，每行 ≤110 显示列（汉字计 2 列）；不用 `**加粗**`、`⚠️`、圈号这类 markdown 装饰。
- **平实中文优先**：不写只有作者本人懂的自造比喻（如"吃额度/翻篇/收摊/吞界面/挡门/串账"）；把状态压成单字账目 likewise 不算清楚（"贴靠账/失败账/在途账/出账"要写成"贴靠次数/失败次数/在途状态/移除"），缩写黑话（"黑标/只认/不认/拒收/前嫌/大赦"）要写成完整说法（"进黑名单/只看主手/引擎不认识/池不收/一并清除"）。唯一标准是没读过设计文档的新同事能否只看这一行就看懂；已可读的句子不要为了压指标重写。
- 导出符号的 JSDoc 保留 `@param`/`@returns`/`@throws`（根 §10 规范），散文压到最短可读长度。
- `// eslint-disable*`、`// @ts-*` 等指令注释是功能性的，逐字保留，不得改写或折行。
- 自检：`git grep -nE '(ADR-[0-9]|D-0[0-9]|FR-[A-Z][0-9]+|缺[0-9]{2}|用户(规格|实测) ?20[0-9]|吃额度|翻篇|收摊|吞界面|挡门|串账|黑标|前嫌|大赦|(贴靠|失败|在途|节流|许可)账|出账|入账|只认主手|不认就|拒收)' -- scripts tests`，命中应全在字符串字面量里（管理员可见提示与测试名，另议）；注释内命中数为 0 才算干净。

## 其他

- 游戏内冒烟只做验收级（用户单次测试成本 5 分钟）；先离线核对 d.ts/知识底座再出包。
- 功能增删须在 `docs/mockplayer/11-归档源码对齐差异审查.md` 记缺编号（缺NN），提交信息引用。
