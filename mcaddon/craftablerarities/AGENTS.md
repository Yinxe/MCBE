# CraftableRarities — 合成配方扩展

合成各种稀有、不可再生物品，创造模式快速获取隐藏方块！

> 通用代码规范请参考根目录 `CLAUDE.md`。

---

## 开发命令

```bash
just-scripts build       # 同步版本
just-scripts mcaddon     # 构建 → 打包 .mcpack
just-scripts clean       # 清理
```

## 配方编辑

配方文件位于 `BP/合成配方扩展&隐藏物品/recipes/`，每个配方一个 `.json` 文件。

格式示例（format_version 1.12）：
```json
{
  "format_version": "1.12",
  "minecraft:recipe_shaped": {
    "description": { "identifier": "craftablerarities:example" },
    "tags": ["crafting_table"],
    "pattern": ["###", "###", "###"],
    "key": { "#": { "item": "minecraft:diamond" } },
    "result": { "item": "minecraft:bedrock" }
  }
}
```

所有配方使用 `format_version 1.12` 以确保兼容性。

---

## 工具

```bash
# 初始化新项目模板（首次迁移用）
node tools/init-project.mjs <new-name>

# 同步版本到 manifest
node tools/sync-version.mjs
```

---

## 依赖

| 包 | 版本 |
|---|------|
| @minecraft/core-build-tasks | 5.5.0 |
| just-scripts | ^2.1.5 |
