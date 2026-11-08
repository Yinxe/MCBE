# Spec Delta

## Purpose

让调用方以只读方式从 Minecraft Wiki 获取可供程序与 agent 使用的词条数据（搜索、章节、正文、建议），并能在中英文站之间做标题映射。

## ADDED Requirements

### Requirement: 词条搜索

系统 SHALL 接受查询字符串与目标站点，返回按相关度排序的匹配词条，每项至少包含标题、摘要片段与是否重定向；无匹配时 SHALL 返回空列表，而非抛出错误。

#### Scenario: 命中查询

- **WHEN** 对站点发起搜索且存在匹配词条
- **THEN** 返回非空列表，每项含标题与摘要片段

#### Scenario: 无命中

- **WHEN** 查询无任何匹配
- **THEN** 返回空列表且不抛出错误

### Requirement: 章节目录

系统 SHALL 返回指定词条的章节列表，每项包含序号、缩进层级与标题文本，顺序与页面一致。

#### Scenario: 读取章节

- **WHEN** 请求已存在词条的章节列表
- **THEN** 返回有序章节数组，每项含序号、层级与标题

### Requirement: 章节定位

正文读取 SHALL 允许按章节序号、章节编号、锚点或标题文本定位目标章节；无法定位时 SHALL 返回可识别的定位失败错误，而非读取到错误章节。

#### Scenario: 按标题定位

- **WHEN** 以标题文本请求单个章节
- **THEN** 返回该标题对应章节的正文

#### Scenario: 定位失败

- **WHEN** 以不存在的标题请求单个章节
- **THEN** 抛出定位失败错误并附可用章节提示

### Requirement: 正文读取与格式阶梯

系统 SHALL 支持读取整页或单个章节的正文，并提供 `markdown`、`text`、`wikitext` 三种格式；单个章节默认 `markdown`，整页默认 `text`；`wikitext` SHALL 返回未展开的原始标记。

#### Scenario: 单节默认 markdown

- **WHEN** 请求某章节且未指定格式
- **THEN** 返回 Markdown 正文

#### Scenario: 整页默认紧凑纯文本

- **WHEN** 请求整页且未指定格式
- **THEN** 返回不含标记的紧凑纯文本

#### Scenario: 原始标记

- **WHEN** 指定格式为 `wikitext`
- **THEN** 返回未展开的原始 wikitext

### Requirement: Markdown 保留表格数据

当格式为 `markdown` 时，页面中的信息框、掉落表与属性表 SHALL 以 Markdown 表格形式保留其键值或行列数据；装饰性元素（图片、编辑链接、引用标记）SHALL 被移除。

#### Scenario: 信息框转表格

- **WHEN** 将实体的信息框渲染为 Markdown
- **THEN** 输出含该实体键值（如最大生命值、实体 ID）的 Markdown 表格

#### Scenario: 掉落表转表格

- **WHEN** 将掉落物章节渲染为 Markdown
- **THEN** 输出含物品、数量范围与掉落概率的 Markdown 表格

### Requirement: 相近词条建议

系统 SHALL 接受可能不完整的输入并返回候选词条标题列表，用于纠正拼写或近似匹配。

#### Scenario: 前缀输入返回候选

- **WHEN** 提交部分标题
- **THEN** 返回候选标题列表

### Requirement: 跨语言标题解析

当目标语言站不存在所请求标题时，系统 SHALL 尝试在另一支持语言站解析该标题并映射回目标站；解析结果 SHALL 标明实际使用的语言与标题。

#### Scenario: 跨语言回退

- **WHEN** 中文标题在英文站缺失但英文站存在对应条目
- **THEN** 返回映射后的标题与实际使用的语言

#### Scenario: 两站皆缺失

- **WHEN** 两个语言站都不存在该标题
- **THEN** 抛出词条不存在的错误

### Requirement: 站点与语言选择

系统 SHALL 支持简体中文站与英文站，默认使用简体中文站，并允许调用方通过选项覆盖。

#### Scenario: 默认中文

- **WHEN** 未指定语言
- **THEN** 请求发送至 `zh.minecraft.wiki`

#### Scenario: 指定英文

- **WHEN** 指定语言为 `en`
- **THEN** 请求发送至 `minecraft.wiki`

### Requirement: 请求礼仪与容错

系统 SHALL 为每个请求发送可识别的 User-Agent、施加超时，并对瞬时失败（网络错误、5xx）进行有限次重试；重试仍失败时 SHALL 抛出错误。

#### Scenario: 超时

- **WHEN** 请求超过配置的超时时间
- **THEN** 中止请求并抛出超时错误

#### Scenario: 瞬时失败重试

- **WHEN** 首次请求返回 5xx
- **THEN** 重试并在随后成功时返回结果

### Requirement: 错误语义

系统 SHALL 以带分类与可操作提示的错误报告失败（词条不存在、定位失败、网络失败、超时等），且 SHALL 不把失败静默表示为空结果。

#### Scenario: 缺词条抛出带提示错误

- **WHEN** 请求不存在的词条
- **THEN** 抛出词条不存在错误，且提示包含可用操作
