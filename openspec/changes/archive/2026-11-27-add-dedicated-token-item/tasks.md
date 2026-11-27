# Tasks

## 1. 信物核心判定（`core/token.ts`）

- [x] 1.1 新建 `mods/item-route/scripts/core/token.ts`，导出 `TOKEN_TYPE_ID = "itemroute:warehouse_token"` 与 `isWarehouseToken(typeId)`；验证：`npx tsc --noEmit -p tests/tsconfig.json` 通过，且文件不 import `@minecraft/server`
- [x] 1.2 新增 `mods/item-route/tests/token.test.ts`，覆盖 `isWarehouseToken` 对信物 typeId 为真、对 `minecraft:wooden_hoe`/`minecraft:stick`/空串/大小写变体为假；验证：`npm test` 该文件全部用例通过

## 2. 自定义物品与资产（BP/RP）

- [x] 2.1 新建 `behavior_packs/item-route/items/warehouse_token.json`：`format_version` 1.26.30，`description.identifier = itemroute:warehouse_token`、`menu_category.category = items`、`minecraft:display_name`、`minecraft:icon` 短名 `warehouse_token`、`minecraft:glint`；验证：`node -e "JSON.parse(require('fs').readFileSync('...'))"` 可解析，且 identifier 与 `TOKEN_TYPE_ID` 一致
- [x] 2.2 在 `tools/icon-forge/` 新增 16×16 物品纹理生成入口，产出 `resource_packs/item-route/textures/itemroute/items/warehouse_token.png`；验证：产物为 16×16 RGBA PNG（用 icon-forge 的 `decodePng` 读回断言宽高与通道），重复执行两次产物逐字节一致
- [x] 2.3 新建 `resource_packs/item-route/textures/item_texture.json`，登记短名 `warehouse_token` → `textures/itemroute/items/warehouse_token`；验证：短名与 2.1 中 `minecraft:icon` 引用一致，且指向的 PNG 在 2.2 后确实存在
- [x] 2.4 新建 `texts/languages.json` 与 `texts/zh_CN.lang`、`texts/en_US.lang`，写入 `item.itemroute:warehouse_token.name`（中文「仓库信物」）；验证：语言键与物品 identifier 拼写一致，`languages.json` 含 `zh_CN` 与 `en_US`
- [x] 2.5 在 `mods/item-route/package.json` 的 `generate:icon` 中串联调用 2.2 的物品纹理入口；验证：`npm run generate:icon` 成功，且既有 `pack_icon.png`、`textures/ui/item-route/*.png` 逐字节未变
- [x] 2.6 新增资产一致性测试（放入 `tests/token.test.ts` 或独立文件）：读取物品 JSON、`item_texture.json`、两个 `.lang`，断言 identifier/短名/纹理路径/语言键四者互相吻合；验证：`npm test` 通过

## 3. 移除可选信物配置

- [x] 3.1 修改 `scripts/mc/storage/McModConfig.ts`：删除 `tokenItemId` 字段、`TOKEN_OPTIONS`、`setTokenItemId()`、`isToken()`；验证：`npx tsc --noEmit` 报出的所有引用点被 3.2/4.x 修完
- [x] 3.2 修改 `scripts/mc/ui/OPConfigUI.ts`：删除信物下拉与状态行；验证：`grep -rn "TOKEN_OPTIONS\|tokenItemId\|setTokenItemId" scripts/` 无残留
- [x] 3.3 修改 `tests/mc-mod-config.test.ts`：删除两条信物配置用例，保留其余用例；验证：`npm test` 中该文件全部通过，且不再出现 `wooden_hoe`
- [x] 3.4 把 3 处 `config.isToken(...)` 调用改为 `isWarehouseToken(...)`（`interaction/ToolInteractionController.ts` 两处、`bootstrap/persistentBoundary.ts`、`ui/SearchUI.ts` 传入 `startMarkerParticles` 的判定闭包），并清理 `SearchUI` 中 `isToken` 参数命名；验证：`grep -rn "isToken" scripts/` 无残留，`npx tsc --noEmit` 通过

## 4. 信物发放与命令

- [x] 4.1 新建 `scripts/mc/token.ts`：`createWarehouseToken()` 返回 `ItemStack` 并设 `keepOnDeath`、`lockMode: inventory`；`giveWarehouseToken(player)` 优先放背包、满了丢脚下并返回结果枚举；验证：纯决策函数 `decideGiveOutcome` 的单测覆盖「已持有」「有空位」「背包满」三支
- [x] 4.2 新建 `scripts/mc/commands/token.ts` 注册 `ir:token`（`noParamCommand`），已有信物时不重复发放、发放后发提示；验证：`tests/register.test.ts` 风格的单测断言命令注册成功且回调行为符合 4.1 的三种结果
- [x] 4.3 在 `scripts/mc/auth/commands.ts` 的 `COMMAND_MIN_ROLE` 增加 `token: "any"`，并在 `scripts/mc/commands/index.ts` 注册新命令；验证：`tests/command-auth.test.ts` 新增 `token` 行为 `any` 的断言并通过
- [x] 4.4 更新 `scripts/mc/ui/HelpGuide.ts` 与 `scripts/mc/ui/NewPlayerGuide.ts`：命令清单加入 `ir:token`，「信物默认：木锄」改为「仓库信物（`ir:token` 获取）」；验证：`grep -rn "木锄" scripts/` 无残留，帮助输出包含 10 条命令

## 5. 合成配方

- [x] 5.1 新建 `behavior_packs/item-route/recipes/warehouse_token.json`：`minecraft:recipe_shapeless`，原料 `minecraft:chest` + `minecraft:stick`，产物 1 个 `itemroute:warehouse_token`，`tags: ["crafting_table"]`，`unlock: [{item: minecraft:chest}]`；验证：JSON 可解析，产物 identifier 与 `TOKEN_TYPE_ID` 一致
- [x] 5.2 在资产一致性测试中断言配方产物指向信物类型；验证：`npm test` 通过
- [x] 5.3 在 `mods/item-route/README.md` 记录配方与三种获取途径（创造栏 / `/give` / `ir:token`）；验证：README 中「木锄」表述已全部替换，命令表含 `ir:token`

## 6. 集成验证

- [x] 6.1 运行全量校验：`npm test`、`npx tsc --noEmit`、`npm run lint`、`npm run build`（或 `npm run pack`）；验证：全部通过，产出的 `.mcpack`/`.mcaddon` 内含新增 items/recipes/textures/texts 文件
- [ ] 6.2 进游戏端到端验证：`ir:token` 发放 → 手持信物两次点击圈定建仓 → 边界光幕仅在持信物靠近时显示 → 搜索粒子标记在持信物时播放 → 木锄不再触发任何模组交互 → 工作台配方可取产物；验证：逐项截图或文字记录结果
- [x] 6.3 确认版本号未被本次改动带动：`package.json` 与两个 manifest 的 `version` 仍为 `0.1.21`；验证：`grep '"version"' package.json` 与两份 manifest 的 `header.version` 对比一致

## Workflow follow-up

- 归档前完成项目要求的评审（`openspec validate --strict` 通过）。
- 归档该 change，并确认 `openspec/specs/item-route/spec.md` 与 `openspec/specs/mod-icon-art/spec.md` 已吸收本次 delta。
