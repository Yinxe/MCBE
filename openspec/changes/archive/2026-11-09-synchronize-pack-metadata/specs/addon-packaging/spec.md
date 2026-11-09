# Spec Delta

## ADDED Requirements

### Requirement: 打包同步清单显示名

`pack` MUST 在压缩之前把每个包 `manifest.json` 的 `header.name` 写为 `package.json` 的 `productName` 加一个空格加 `v` 加 `package.json#version`,覆盖清单中原有的值。`productName` 缺失或为空字符串时 MUST 报错中止且不产生产物,不得回落到模组名。

#### Scenario: 显示名由产品名与版本组成

- **WHEN** `package.json` 的 `productName` 为 `自动替换`、`version` 为 `2.2.0` 并执行 `pack`
- **THEN** 行为包 `manifest.json` 的 `header.name` 为 `自动替换 v2.2.0`

#### Scenario: 覆盖清单中手工维护的显示名

- **WHEN** 清单中 `header.name` 为 `§l§e《合成配方扩展》 v1.0.1`,而 `productName` 为 `合成配方扩展`、`version` 为 `1.0.2`
- **THEN** 清单中的值被改写为 `合成配方扩展 v1.0.2`

#### Scenario: 资源包同样被写入

- **WHEN** 模组同时包含行为包与资源包并执行 `pack`
- **THEN** 两个包的 `manifest.json` 的 `header.name` 都是同一个显示名

#### Scenario: 产品名缺失时中止

- **WHEN** `package.json` 没有 `productName` 字段
- **THEN** 打包报错指明该字段是清单显示名的来源,不产生产物

### Requirement: 打包同步清单描述

`pack` MUST 在压缩之前把每个包 `manifest.json` 的 `header.description` 写为由 `package.json` 派生的多行文本,覆盖清单中原有的值。首行 MUST 为 `package.json#description` 原文,其后按固定顺序逐行追加:作者、邮箱、主页、QQ群、仓库。`package.json#description` 缺失或为空字符串时 MUST 报错中止。

#### Scenario: 描述由简介与联系信息拼接

- **WHEN** `description` 为 `死亡不掉落 · 无需作弊 · 保留成就`、`author.name` 为 `Yinx`、`author.email` 为 `1423716216@qq.com`、`author.url` 为 `https://github.com/Yinxe/`、`packing.qq_group` 为 `632178498`、`repository` 指向 `github.com/Yinxe/MCBE`
- **THEN** `header.description` 为 `死亡不掉落 · 无需作弊 · 保留成就`、`作者：Yinx`、`邮箱：1423716216@qq.com`、`主页：https://github.com/Yinxe/`、`QQ群：632178498`、`仓库：https://github.com/Yinxe/MCBE` 六行以换行符连接

#### Scenario: 缺失的联系信息整行省略

- **WHEN** `package.json` 只有 `author.name`,没有 `author.email`、`author.url`、`packing.qq_group` 与 `repository`
- **THEN** `header.description` 只有简介与 `作者：Yinx` 两行,不出现空行、也不出现「未配置」之类的占位文本

#### Scenario: 简介缺失时中止

- **WHEN** `package.json` 没有 `description` 字段或其为空字符串
- **THEN** 打包报错指明该字段是清单描述的来源,不产生产物

#### Scenario: 颜色符号原样保留

- **WHEN** `description` 或 `author.name` 中含 `§` 颜色与样式符号(如 `§e《合成配方扩展》`)
- **THEN** 写入清单的文本原样保留这些符号,不被转义、剥离或截断

### Requirement: 联系信息字段来源与规范化

清单描述中的联系信息 MUST 只从 `package.json` 读取:`author`(字符串或含 `name`/`email`/`url` 的对象)、`repository`(字符串或含 `url` 的对象)、`packing.qq_group`。`repository` 的 git 形式 URL MUST 规范化为 `https://<host>/<owner>/<repo>` 可读形式,去掉 `git+` 前缀、`git@` 与 `:` 形式的 SSH 分隔符、以及 `.git` 后缀。

#### Scenario: SSH 形式的仓库地址被规范化

- **WHEN** `repository` 为 `git@github.com:Yinxe/MCBE.git`
- **THEN** 清单描述中的仓库行为 `仓库：https://github.com/Yinxe/MCBE`

#### Scenario: 已是 https 形式时保持不变

- **WHEN** `repository` 为 `https://github.com/Yinxe/MCBE.git`
- **THEN** 清单描述中的仓库行为 `仓库：https://github.com/Yinxe/MCBE`

#### Scenario: author 为字符串时按作者名处理

- **WHEN** `author` 为字符串 `Yinx` 而非对象
- **THEN** 清单描述中写入 `作者：Yinx`,且不产生邮箱与主页行

#### Scenario: qq_group 纳入配置白名单

- **WHEN** `packing.qq_group` 被设置
- **THEN** 打包不把它当作未知字段报错;而 `packing` 中出现其它不受支持的字段时仍然报错
