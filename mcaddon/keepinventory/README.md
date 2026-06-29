# Keep Inventory Add-on 🎮

**死亡不掉落 · 无需作弊 · 保留成就**

一个轻量 Minecraft Bedrock 行为包，加载后自动启用死亡不掉落，无需输入 `/gamerule` 命令，不启用作弊，保留成就获取。

A lightweight Minecraft Bedrock behavior pack that enables keepInventory on world load — no cheats required, achievements preserved.

---

## 使用说明

1. 下载 `KeepInventory.mcpack`
2. 双击文件或用 Minecraft 打开
3. 将包应用到你的世界（设置 → 行为包）
4. 进游戏，死亡后物品保留在身上 ✅

> ⚠️ 确保世界设置中 **允许作弊** 保持关闭，**实验性玩法** 保持关闭，成就即可正常获取。

---

## 技术原理

- 纯行为包，不依赖资源包
- 使用 Script API 在加载世界时自动设置 `gameRules.keepInventory = true`
- 通过 `metadata.product_type: "addon"` 声明为附加包，不触发成就锁定
- 仅依赖 `@minecraft/server` 模块（v2.5.0+）

### 依赖

| 模块 | 版本 |
|------|-------|
| `@minecraft/server` | `^2.5.0` |

---

## 构建

```bash
npm install          # 安装依赖
npm run build        # TypeScript 编译 + 打包
npm run mcaddon      # 生成 KeepInventory.mcpack
```

输出文件位于 `dist/packages/KeepInventory.mcpack`。

---

## 项目结构

```
keepInventory/
├── behavior_packs/
│   └── yinx1423_keepinv/
│       ├── manifest.json     # 包清单
│       └── pack_icon.png     # 图标
├── scripts/
│   └── main.ts               # 脚本源码
├── dist/
│   └── scripts/main.js       # 编译后脚本
├── just.config.ts            # 构建配置
└── package.json              # 依赖
```

---

## 版本要求

- **Minecraft Bedrock** 1.26.0 或更高
- **Script API** @minecraft/server v2.5.0+

---

MIT License
