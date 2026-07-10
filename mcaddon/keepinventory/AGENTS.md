# KeepINventory — 死亡不掉落

死亡不掉落·无需开启作弊·保留成就·极限复活。

> 通用代码规范请参考根目录 `CLAUDE.md`。

---

## 开发命令

```bash
just-scripts build       # TypeScript 编译
just-scripts mcaddon     # 构建 → 打包 .mcpack
just-scripts lint        # ESLint
just-scripts clean       # 清理
```

---

## 架构

```
scripts/
├── main.ts              # 入口
```

核心逻辑：玩家死亡时检测 `keepInventory` 状态，保存/恢复玩家背包。

---

## 依赖

| 包 | 版本 |
|---|------|
| @minecraft/server | 2.0.0 |
| @minecraft/core-build-tasks | 5.5.0 |
