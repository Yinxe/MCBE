# mc-toolchain

Minecraft Bedrock 模组工具链与模组集合。

## 目录结构

```text
mc-toolchain/
├── mods/                  # Bedrock 模组（游戏内行为包与资源包），规则见 mods/README.md
│   ├── auto-refill/
│   ├── craftablerarities/
│   ├── keepinventory/
│   └── spectator-mode/
├── packages/              # 仓库内共享包（不对外发布，以 TS 源码被模组直接消费）
│   ├── packaging/         # 打包实现：包目录探测、版本同步、产物归档
│   └── shared/            # 运行时共享代码：文本样式码、跨包 HUD 总线
├── tools/                 # 可独立发布的工具包
│   └── mcwiki-search/     # Minecraft Wiki 只读查询（库 / CLI / pi 工具）
├── docs/research/         # 调研记录（实测结论与可复现的验证方式）
└── openspec/              # 需求与变更规格
```

## 模组

| 模组            | 说明                                                         | 文档                                                         |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `auto-refill`   | 自动替换：主手消耗品用完/挖坏/触发图腾后自动换补同类，不用作弊 | [mods/auto-refill/README.md](mods/auto-refill/README.md) |
| `keepinventory` | 死亡不掉落：玩家死亡时保留背包物品                           | [mods/keepinventory/README.md](mods/keepinventory/README.md) |
| `craftablerarities` | 合成配方扩展：79 个工作台配方合成稀有、不可再生物品与隐藏方块（纯内容包，无脚本） | [mods/craftablerarities/README.md](mods/craftablerarities/README.md) |
| `spectator-mode` | 灵魂出窍：飞离真身侦查，超出距离容忍 5 秒后自动回归 | [mods/spectator-mode/README.md](mods/spectator-mode/README.md) |

`mods/` 下的目录布局、`mct` 用法、新建模组流程等共同规则见 [mods/README.md](mods/README.md)。

## 共享包

| 包                       | 说明                                                                                     | 文档                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `@mc-toolchain/packaging` | 打包逻辑的唯一实现：包目录探测与类型判定、版本与最低游戏版本同步、按 `mode` 产出归档 | [packages/packaging/README.md](packages/packaging/README.md) |
| `@mc-toolchain/shared`    | 运行时共享代码：`§` 文本样式码、跨行为包 HUD 逐玩家优先级仲裁                       | [packages/shared/README.md](packages/shared/README.md)       |

`packages/` 下的包均为 `private`，不发布到 npm。它们以 TypeScript 源码直出（`main` / `types` 均指向 `src/index.ts`），由模组通过 npm workspace 直接消费，无构建步骤。

## 工具

| 包                            | 说明                                                                                                            | 文档                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `@mc-toolchain/mcwiki-search` | Minecraft Wiki 只读查询：搜索词条、章节目录、正文（Markdown）与相近词条建议；同时提供库、CLI 与 pi 工具三种用法 | [tools/mcwiki-search/README.md](tools/mcwiki-search/README.md) |

## 开发

本仓库使用 npm workspaces，要求 Node.js >= 20。

```bash
npm install                                  # 安装所有 workspace 依赖
npm test -w @mc-toolchain/mcwiki-search      # 运行某个包的测试
npm run typecheck -w @mc-toolchain/mcwiki-search
```

## 发布

`tools/` 下的包可独立发布到 npm。发布为**本地手动执行**，不使用 CI 自动发布。

前置条件：

- 已执行 `npm login`，且该账号是 `@mc-toolchain` scope 的 owner（当前为 `yinxe`）。

发布顺序（在**仓库根**执行，二选一）：

```bash
# 推荐：根目录下的专用脚本，不用切到包目录
npm run publish:mcwiki-search:dry    # 预演：跑 typecheck + test + build，并打印将被上传的文件清单
npm run publish:mcwiki-search        # 正式发布
```

也可在包目录内直接调用：

```bash
cd tools/mcwiki-search
npm run publish:dry
npm run publish:npm
```

`publish:dry` 与 `publish:npm` 都会先触发 `prepublishOnly`（类型检查 → 测试 → 构建），任一步失败即中止，不会上传。因 `dist/` 不纳入版本控制，构建产物始终由当前源码现场生成。

**发布不可撤回。** npm 对已发布版本的重发与 unpublish 有严格限制，故首次发布前务必先跑 `publish:dry` 核对清单与体积。若发布内容有误，正确做法是立即提升 patch 版本并重新发布，而非尝试 unpublish。
