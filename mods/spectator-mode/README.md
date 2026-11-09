# 灵魂出窍(spectator-mode)

> 飞离真身侦查:灵魂离真身太远会开始 5 秒容忍倒计时,倒计时结束自动把你拉回本体。

本模组是上游仓库 [`Yinxe/MCBE`](https://github.com/Yinxe/MCBE) 里 `spectator-mode` 的迁移实现,已按本仓 `mc-toolchain` 规范重写(纯行为包、`@mc-toolchain/packaging` 打包、不使用 `@yinxe/toolkit`)。

## 玩法

| 步骤 | 说明 |
| --- | --- |
| 1. 进入 | 输入 `/sp:soul`,角色立即变为旁观模式(灵魂),真身留在原地并持续冒出标记粒子 |
| 2. 移动 | 以旁观者视角自由飞行侦查,可穿墙、可跨维度 |
| 3. 距离监控 | 屏幕 actionbar 实时显示「距离真身 / 最大距离」,进度条与数字由绿变红 |
| 4. 超限容忍 | 超出最大距离(或跨维度)后进入 5 秒容忍倒计时,actionbar 变深红并显示 `Ns 后强制回归` |
| 5. 回归 | 手动再输一次 `/sp:soul`,或倒计时耗尽 —— 灵魂被传送回真身,维度/位置/游戏模式全部还原 |

进入与回归瞬间会有一次真身标记粒子爆发,方便同伴定位你的身体。可选的双向扫掠连线粒子(琥珀:真身→灵魂,灰:灵魂→真身)默认**关闭**,由管理员按需开启。

## 命令与权限

| 命令 | 谁能用 | 作用 |
| --- | --- | --- |
| `/sp:soul` | 所有玩家(无需作弊、保留成就) | 切换:进入旁观 / 回归本体 |
| `/sp:soul menu` | 仅 OP(管理员) | 打开管理表单 |

命令不开启作弊即可使用;非管理员执行 `/sp:soul menu` 会收到「仅管理员可打开管理表单」提示,命令本身仍对所有玩家可见。

## 管理表单

`/sp:soul menu` 提供三项配置,保存后立即生效并持久化到世界:

| 配置项 | 范围 / 默认 | 说明 |
| --- | --- | --- |
| 启用旁观模式 | 开 / **开** | 关闭后玩家无法进入旁观;已在旁观中的灵魂会被强制回归本体 |
| 最大移动距离 | 5 – 400 米,步长 1 / **128** | 灵魂离真身超过该距离后开始 5 秒容忍倒计时 |
| 显示连线粒子 | 开 / 关 / **关** | 在真身与灵魂之间绘制双向扫掠连线 |

## 极限模式

极限模式(Hardcore)世界里本功能**禁用**:游戏的旁观模式切换是单向的,切进去就再也切不回生存,风险不可接受。

- 极限模式下执行 `/sp:soul` 会收到拒绝提示;
- 极限模式世界里的玩家进服时会收到一条禁用警告。

## 持久化与重连

- 世界级配置(启用开关 / 最大距离 / 连线开关)存世界动态属性,随存档走。
- 玩家的灵魂锚点(进入时的维度、坐标、原游戏模式)存**玩家**动态属性,跟着玩家走。
- 因此「以灵魂状态退出游戏」再重连,会自动恢复旁观状态并可随时 `/sp:soul` 回归;若此时功能已被禁用或世界变为极限模式,则直接回归本体。
- 旁观状态带自愈:若因事件漏触等原因出现「已是旁观者但控制器没接管」的情况,后台扫描会重新接管并恢复 HUD。

## 构建与打包

```bash
# 安装依赖(仓库根)
npm install

# 静态检查 + 单元测试
npm run lint -w @mc-toolchain/spectator-mode
npm test -w @mc-toolchain/spectator-mode

# 打包(产物:dist/packages/spectator-mode-v1.0.10_bp.mcpack)
npm run pack -w @mc-toolchain/spectator-mode

# 重新生成图标(32×32 逻辑像素 → 4 倍最近邻 → 128×128 RGBA)
npm run generate:icon -w @mc-toolchain/spectator-mode
```

产物为**纯行为包**(`_bp.mcpack`),无资源包,不需要实验性开关。

## 兼容性

- 依赖 `@minecraft/server` **2.1.0** 的自定义命令 API(`customCommandRegistry`),对应最低引擎版本 **1.21.100**。
- 表单使用原生 `@minecraft/server-ui` `ModalFormData`。
- HUD 走 `@mc-toolchain/shared` 的 `HudManager`(actionbar 槽,priority 200),会按优先级让位给其它模组。

## 命名规范例外:`sp:*` 键名

本仓规范要求配置键名使用完整单词,但本模组的动态属性键名刻意沿用上游的缩写形式:

- 世界级:`sp:enabled`、`sp:maxDist`、`sp:showLink`
- 玩家级:`sp:soul`

原因:这些键名已经在旧存档里落盘。改成 `spectator_mode:*` 会让老世界的管理员配置静默回落到默认值,并让「以灵魂状态离线」的玩家重连后变成没有逃生出口的普通旁观者。这属于规范中「与上游生态约定一致时保留既有缩写」的例外,详见 `scripts/core/config.ts` 与 `scripts/mc/store.ts` 的注释。

## 与上游包共存

**不要**同时安装本模组与上游 `spectator-mode` 包:两者注册同一条 `/sp:soul` 命令、读写同一批 `sp:*` 键名,会互相覆盖配置与状态。迁移时请先移除上游包再导入本产物。

## 目录结构

```
mods/spectator-mode/
├── behavior_packs/spectator-mode/   # 行为包(manifest.json + pack_icon.png)
├── scripts/
│   ├── core/                        # 纯逻辑,零 @minecraft 依赖,可 node 单测
│   │   ├── types.ts                 # 数据类型
│   │   ├── config.ts                # 默认值 / 钳制 / DP 键名
│   │   ├── engine.ts                # 距离与容忍倒计时状态机
│   │   ├── colors.ts                # 距离比例 → §颜色码
│   │   └── hud.ts                   # actionbar 文案组装
│   ├── mc/                          # 适配层,封装 @minecraft API
│   │   ├── store.ts                 # 世界配置 / 玩家锚点读写
│   │   ├── playerUtil.ts            # 假人与失效玩家过滤
│   │   ├── particles.ts             # 光环 / 真身标记 / 扫掠连线
│   │   ├── controller.ts            # 控制器:会话、tick 循环、HUD、自愈
│   │   ├── commands.ts              # /sp:soul
│   │   └── menu.ts                  # 管理表单
│   └── main.ts                      # 组合根
├── tests/                           # core 层单测(node --test)
└── tools/generate-pack-icon.js      # 图标生成器(零依赖)
```
