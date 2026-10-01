# MockPlayer UI 图标

从 `request image 1254x1254px`（sha256 `9461ea488dc798a9a7b10e89e5c93168d3e0f953a3250dd7d6ae5923e64d5512`）
按 5x5 网格切成 24 个 256x256 透明背景小图标，输出到本目录。

注意：`投掷物认主` 与 `投三叉戟` 均使用三叉戟图标 `throw_trident`；`claim_trident` 原图标实为名牌，已改名为 `rename` 用于重命名按钮。

## 命名对照

| 文件名 | 中文用途 | RP 路径 |
| --- | --- | --- |
| create_bot | 创建模拟玩家 | `textures/ui/mockplayer/create_bot` |
| bot_list | 模拟玩家列表 | `textures/ui/mockplayer/bot_list` |
| delete_bot | 删除模拟玩家 | `textures/ui/mockplayer/delete_bot` |
| online_management | 在线管理 | `textures/ui/mockplayer/online_management` |
| help | 帮助 | `textures/ui/mockplayer/help` |
| admin_settings | 管理员菜单 | `textures/ui/mockplayer/admin_settings` |
| toggle_online | 安全上线/下线 | `textures/ui/mockplayer/toggle_online` |
| teleport | 传送过去 | `textures/ui/mockplayer/teleport` |
| sync_pose | 同步姿态 | `textures/ui/mockplayer/sync_pose` |
| select_mainhand | 选择主手 | `textures/ui/mockplayer/select_mainhand` |
| swap_items | 物品互换 | `textures/ui/mockplayer/swap_items` |
| reclaim | 回收资源 | `textures/ui/mockplayer/reclaim` |
| discard | 丢弃物品 | `textures/ui/mockplayer/discard` |
| inventory | 背包/库存 | `textures/ui/mockplayer/inventory` |
| use_item | 使用物品 | `textures/ui/mockplayer/use_item` |
| set_spawn | 设置重生点 | `textures/ui/mockplayer/set_spawn` |
| rename | 重命名 | `textures/ui/mockplayer/rename` |
| throw_trident | 投三叉戟 | `textures/ui/mockplayer/throw_trident` |
| recall | 召回假人 | `textures/ui/mockplayer/recall` |
| view_data | 查看数据 | `textures/ui/mockplayer/view_data` |
| kill_bot | 击杀假人 | `textures/ui/mockplayer/kill_bot` |
| clear_equipment | 清除装备 | `textures/ui/mockplayer/clear_equipment` |
| cancel | 取消 | `textures/ui/mockplayer/cancel` |
| back | 返回 | `textures/ui/mockplayer/back` |

## 在 ActionForm 中使用

```ts
.buttonWithIcon(style("删除假人", color.darkRed), "textures/ui/mockplayer/delete_bot", () => trigger("delete"))
```

## 重新切割

```bash
python mcaddon/mock-player/tools/slice_ui_icons.py /path/to/source.png
```
