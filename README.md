# mc-toolchain

Minecraft Bedrock 模组工具链与模组集合。

## 目录结构

```text
mc-toolchain/
├── mods/                  # Bedrock 模组（游戏内行为包与资源包），规则见 mods/README.md
│   ├── auto-refill/
│   ├── craftablerarities/
│   ├── item-route/
│   ├── keepinventory/
│   ├── mockplayer3/
│   ├── spectator-mode/
│   └── teleporter/
├── packages/              # 仓库内共享包（不对外发布，以 TS 源码被模组直接消费）
│   ├── mod-common/        # 模组通用代码：文本样式码、HUD 仲裁、表单构建器、安全执行助手
│   ├── mod-packaging/     # 打包实现：包目录探测、版本同步、产物归档
│   └── nbt-data-storage/  # 区块锚定木桶阵列：O(1) 槽位寻址、完整 NBT 存取、原子传输
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
| `item-route` | 物品路由仓库：木锄圈定仓库，按物品族自动分拣、容器整理、统计、容量预警与搜索定位；仓库内唯一带资源包（自定义粒子）的模组 | [mods/item-route/README.md](mods/item-route/README.md) |
| `mockplayer3` | 模拟玩家III：创建假人，11 种工作模式（跟随/闲逛/劫掠/宝库/定点挖掘/放置/攻击/资源采集/自动钓鱼等），物品与经验回收；**需开启 Beta APIs 实验开关** | [mods/mockplayer3/README.md](mods/mockplayer3/README.md) |
| `teleporter` | 传送：传送点、死亡点、玩家间传送请求；无需作弊、保留成就 | [mods/teleporter/README.md](mods/teleporter/README.md) |

`mods/` 下的目录布局、`mct` 用法、新建模组流程等共同规则见 [mods/README.md](mods/README.md)。

## 共享包

| 包                          | 说明                                                                                 | 文档                                                             |
| --------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `@mc-toolchain/mod-packaging` | 打包逻辑的唯一实现：包目录探测与类型判定、版本与最低游戏版本同步、按 `mode` 产出归档 | [packages/mod-packaging/README.md](packages/mod-packaging/README.md) |
| `@mc-toolchain/mod-common`    | 模组通用代码：`§` 文本样式码、跨行为包 HUD 逐玩家优先级仲裁、模态/动作/消息表单构建器、受限上下文的安全执行助手、消息提示 | [packages/mod-common/README.md](packages/mod-common/README.md) |
| `@mc-toolchain/nbt-data-storage` | 区块锚定木桶阵列存储：O(1) 槽位寻址、完整 NBT 存取、动态扩容、原子传输、原位覆写、阵列巡检修复、自定义事件总线 | [packages/nbt-data-storage/README.md](packages/nbt-data-storage/README.md) |

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

### 模组（GitHub Release）

模组的发布走 GitHub Actions，**手动触发**，不使用推送 tag 触发。

触发方式：在该仓库的 Actions 页面选择 `Release Mod` → `Run workflow`，填写模组目录名（`mods/` 下的目录名，如 `mockplayer3`），按需勾选 `dry_run`、按需填写 `notes`。

命令行等价形式：

```bash
# 试运行（不建 tag、不建 Release，但会预览正文）
gh workflow run release-mod.yml --repo Yinxe/MCBE -f mod=mockplayer3 -f dry_run=true

# 正式发布，手写说明
gh workflow run release-mod.yml --repo Yinxe/MCBE \
  -f mod=mockplayer3 -f dry_run=false \
  -f notes="- 修复了开箱钥匙复制问题
- 新增自动补货开关"
```

发版顺序：

1. 先提升版本并提交。版本号只有 `mods/<模组>/package.json` 一个来源，workflow **不会**修改它；提升后要先推送，否则发布的仍是旧版本。
2. 用 `dry_run` 跑一遍，核对 Step Summary 里的资产清单、标题与正文。
3. 取消 `dry_run` 正式发布。

### Release 正文（notes）

两种来源，**手写优先**：

- **手写**（推荐）：填 `notes` 输入，内容原样作为正文。玩家能看懂「这个版本改了什么」，比从提交记录推断准确。
- **自动生成**（不填 `notes` 时）：取本模组与 `packages/` 的提交标题。基准为上一个 `HEAD` 可达的同名 tag；历史 tag 全部指向仓库重写前的旧提交（不可达），所以当前实际效果是「最近 3 条提交」。

自动生成**不会**列出全仓历史——早期版本曾因此把一个模组的 Release 写成整仓 32 条提交，现已修复。

约定：

- **Release 标题用中文**：`<productName> <version>`（如 `模拟玩家III 3.0.33`），`productName` 取自模组 `package.json`。
- **资产文件名保持英文原名**：`<name>-v<version>_bp.mcpack` / `_rp.mcpack` / `.mcaddon`，不做重命名（中文文件名在下载与解压链路里有编码问题）。
- tag 名为 `<name>@<version>`；已存在的 tag 不会被覆盖，重发必须提升版本。
- 发布目标固定为 `Yinxe/MCBE`，workflow 文件也住在该仓库。

workflow 定义见 [.github/workflows/release-mod.yml](.github/workflows/release-mod.yml)。推送前可用 `act` 在本地跑通同一份 workflow，见 [docs/research/github-actions-local-act.md](docs/research/github-actions-local-act.md)。

### 工具包（npm）

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
