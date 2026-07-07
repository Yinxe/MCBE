# GitHub Actions Configuration

## Required Variables

在 GitHub 仓库的 Settings → Secrets and variables → Actions 中设置以下变量：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `PROJECT_NAME` | 项目名称（与 `.env` 中的一致） | `my-addon` |

## Variables vs Secrets

- **Variables**（变量）— 项目名称等非敏感信息，在 Repository variables 中设置
- **Secrets**（密钥）— GitHub Token 由 `GITHUB_TOKEN` 自动提供，无需额外配置

## 本地开发

`.env` 文件已随模板提交（git 追踪），首次使用运行初始化脚本即可自动配置：

```bash
node tools/init-project.mjs your-addon-name
```
