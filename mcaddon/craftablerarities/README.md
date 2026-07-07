# mcbe-addon-template

Minecraft Bedrock Edition Add-on 通用模板。基于 `mct create` CLI 生成，参照 SmartWarehouse 项目结构重构。

> **模板版本**: 0.0.1 | **许可证**: MIT
> **项目地址**: https://github.com/YinxSmartHouse/mcbe-addon-template

---

## 快速开始

### 从模板创建新项目

```bash
# 1. 克隆或下载本仓库
git clone <your-repo-url> my-new-addon
cd my-new-addon

# 2. 安装依赖
npm install

# 3. 运行初始化脚本（重命名项目、生成 UUID、完善配置）
node tools/init-project.mjs my-new-addon-name

# 4. 构建验证
npm run build
```

### 初始化脚本做了什么？

运行 `node tools/init-project.mjs <new-name>` 后：

| 操作 | 说明 |
|------|------|
| 重命名 BP/RP 目录 | `BP/<old>/` → `BP/<new>/`, `RP/<old>/` → `RP/<new>/` |
| 更新 .env | 将 `PROJECT_NAME` 设为新名称 |
| 更新 package.json | 将 `name` 设为新名称 |
| 重新生成 UUID | BP 和 RP manifest.json 中所有 6 个 UUID 全部刷新 |
| 更新 GitHub Actions | 工作流中的项目名称同步更新 |

> ⚠ **UUID** 是每个 Add-on 的唯一身份标识。不同模组必须使用不同的 UUID，
> 否则在 Minecraft 中加载会导致冲突。初始化脚本会自动生成全新的 UUID。

### 开发构建

```bash
# 开发构建（版本同步 → TypeScript 编译 → 打包）
npm run build

# 本地部署（监听文件变动，自动部署到本地 Minecraft）
npm run local-deploy

# 打包为 .mcaddon 发布文件
npm run mcaddon

# 代码检查
npm run lint
```

### 版本管理

```bash
npm run version:patch   # 0.0.1 → 0.0.2
npm run version:minor   # 0.0.1 → 0.1.0
npm run version:major   # 0.0.1 → 1.0.0
```

版本号统一在 `package.json` 的 `version` 字段维护。构建时自动同步到：
- `BP/<name>/manifest.json` — header / modules / dependencies 版本
- `RP/<name>/manifest.json` — header / modules / dependencies 版本
- `scripts/version.ts` — 生成 `VERSION`、`BUILD_TIME`、`PROJECT_URL`

---

## 项目结构

```
BP/<project_name>/     行为包（manifest.json + scripts 编译产物）
RP/<project_name>/     资源包（manifest.json + 纹理/声音）
scripts/               TypeScript 源码
  main.ts              入口文件（初始化依赖、注册事件和命令）
  types.ts             集中式类型定义
  version.ts           自动生成的版本号与构建时间
  commands/            命令路由层
  data/                数据文件
  interaction/         工具交互
  runtime/             运行时缓存层
  storage/             持久化层
  ui/                  玩家交互界面
  util/                工具函数
tools/                 维护工具（init-project.mjs 等）
docs/                  文档
  api/                 API 类型定义参考
```

---

## 开发工作流

```
npm install                  ← 安装依赖
     ↓
node tools/init-project.mjs ← 首次初始化（重命名 + 生成 UUID）
     ↓
编写 scripts/  TypeScript    ← 实现功能逻辑
     ↓
npm run build                ← 构建（version → tsc → bundle）
     ↓
npm run local-deploy         ← 本地部署测试
     ↓
npm run version:patch        ← 版本递增
     ↓
git tag v0.0.2               ← 打标签触发 CI/CD
     ↓
GitHub Actions               ← 自动构建 + 发布 Release
```

---

## 技术栈

- **语言**: TypeScript（ES6 target, strict 模式）
- **运行时**: Minecraft Bedrock Script API（`@minecraft/server` ^2.6.0）
- **UI**: `@minecraft/server-ui`（ActionForm / ModalForm）
- **构建**: just-scripts + TypeScript 编译器
- **代码规范**: Prettier + ESLint（eslint-plugin-minecraft-linting）

---

## 编码规范

详见 [AGENTS.md](AGENTS.md)，涵盖以下内容：

- 项目结构和架构分层
- 命名规范（PascalCase / camelCase / UPPER_SNAKE_CASE）
- 导入规范和 JSDoc 文档规范
- 错误处理 5 种模式
- 依赖注入模式
- 类型定义模式（union / discriminated union / Record）
- **system.run() 执行上下文的注意事项**
- Minecraft 特有模式（初始化 Phase、命令注册、UI 交互、区块安全访问）

---

## 许可证

MIT
