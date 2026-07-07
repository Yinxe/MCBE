# Minecraft Script API 类型定义参考

本目录用于存放 `@minecraft/server` 和 `@minecraft/server-ui` 的类型定义，供离线查阅。

## 文件说明

| 文件 | 来源 | 说明 |
|------|------|------|
| `server.d.ts` | `@minecraft/server` | 核心 Script API 类型（可选，需手动添加） |
| `server-ui.d.ts` | `@minecraft/server-ui` | UI 类型（可选，需手动添加） |
| `minecraft-math.d.ts` | `@minecraft/math` | 数学工具类型（可选，需手动添加） |

## 使用方式

从模板创建新项目后**不包含**这些 `.d.ts` 文件，因为它们体积较大且会随 npm 包版本变化。
实际类型定义始终来自 `node_modules` 中的 npm 包。

```bash
# 查看已安装的 API 版本
npm list @minecraft/server @minecraft/server-ui @minecraft/math
```

## 需要离线查阅？

如果想在项目内保留类型定义参考，安装后从 node_modules 复制：

```bash
# 安装目标版本
npm install @minecraft/server@<version>

# 从 node_modules 复制类型（可选）
cp node_modules/@minecraft/server/types/index.d.ts docs/api/server.d.ts
```

## 官方文档

- [Script API 入门](https://learn.microsoft.com/zh-cn/minecraft/creator/scriptapi/minecraft/server)
- [Script API 参考](https://learn.microsoft.com/zh-cn/minecraft/creator/scriptapi/minecraft/server/afterevents)
- [server-ui 参考](https://learn.microsoft.com/zh-cn/minecraft/creator/scriptapi/minecraft/server-ui)
- [社区 Wiki](https://wiki.bedrock.dev/)
