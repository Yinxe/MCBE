# 研究记录

本目录记录 `mc-toolchain` 项目在设计与实施过程中**实际做过的调研与实测**,每条结论都尽量附上可复现的验证方式,以便日后升级工具链时能快速重新确认。

记录只写「查到了什么、怎么查的、结论是什么」,不复述最终代码;设计取舍的理由在 `openspec/changes/<change>/design.md` 里。

## 目录

| 文档 | 内容 |
| --- | --- |
| [minecraft-creator-tools.md](./minecraft-creator-tools.md) | `mct`(Minecraft Creator Tools)0.21.0 的命令面、模板、项目结构、`mct add` 的落点与命名派生规则、`out/` 报告结构,以及它对模板文件的所有权边界 |
| [core-build-tasks.md](./core-build-tasks.md) | `@minecraft/core-build-tasks` 5.5.0 的导出与各任务实现细节,含 `zipTask` / `mcaddonTask` 的真实行为 |
| [minecraft-server-api-versions.md](./minecraft-server-api-versions.md) | `@minecraft/server` 模块版本 ↔ Minecraft 游戏版本的对应关系,以及关键 API 的首次可用版本 |
| [version-semantics-and-backward-compatibility.md](./version-semantics-and-backward-compatibility.md) | 四个版本号(`min_engine_version` / `header.version` / `dependencies[].version` / `package.json`)各自的作用、高版本游戏跑低声明包的语义化版本承诺与实测验证、方向不对称的失败表现、声明与代码自洽的三条要求、优雅降级的写法 |
| [achievements-and-sideloading.md](./achievements-and-sideloading.md) | 侧载行为包与成就的关系:平台 bug MCPE-242529 的边界与实测观察 |
| [packaging-naming-and-modes.md](./packaging-naming-and-modes.md) | 打包产物命名、`mode` 语义、包类型判定与只认官方全名目录的约定,以及 `mcaddon` 与 `mcaddon:production` 的实测结论 |
| [lint-and-prettier.md](./lint-and-prettier.md) | 官方模板 lint 链路的结构与它自带的一个缺陷(缺 `@typescript-eslint/eslint-plugin`) |
| [read-only-context.md](./read-only-context.md) | 只读上下文与安全上下文的区别、`@minecraft/server@2.1.0` 中 341 个受限成员的完整清单、判据(以声明标注为准而非「是否写操作」)、实践规则与逐个成员提取的脚本 |
| [bedrock-item-data-values.md](./bedrock-item-data-values.md) | 配方的 `identifier` 与 `result.item` 是两套独立 ID 体系(附原版 50.7% 不一致的实测)、`data` 辅助值的可证明等价改写规则、30 条映射表、`format_version` 与 `unlock` 的关系、本次无法静态证明的部分 |
| [github-actions-local-act.md](./github-actions-local-act.md) | 用 `nektos/act` 在本地跑 `Release Mod` workflow:runner 镜像拉不动时的自建方案、`--pull=false` 与 `--bind` 的必要性、三个代表模组的实测耗时与产物核对 |

## 环境基线

记录中的实测均在该环境下完成:

| 项 | 值 |
| --- | --- |
| 操作系统 | Linux |
| Node.js | v24.21.0 |
| npm | 11.19.0 |
| `mct` | 0.21.0 |
| `@minecraft/core-build-tasks` | 5.5.0 |
| `@minecraft/server`(实测安装) | 2.0.0 |
| 系统日期 | 2026-11-08 |

> 版本相关的结论都有时效性。`@minecraft/server` 与游戏版本的对应关系、以及成就限制,请以本文档记录的验证方式重新确认,不要直接沿用数字。
