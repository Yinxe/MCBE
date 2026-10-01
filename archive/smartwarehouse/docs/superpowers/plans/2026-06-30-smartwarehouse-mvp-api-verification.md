# SmartWarehouse MVP API Verification

Run these checks in a development world with Content Log enabled.

## Dynamic Property Store

- [ ] **Dynamic property single-key safe length**: verify that a JSON string near `DEFAULT_DYNAMIC_PROPERTY_SAFE_LENGTH` writes successfully.
- [ ] **Dynamic property overflow**: verify oversized writes throw and are caught without corrupting existing warehouse data.

## Tool Interaction (Wooden Hoe)

- [ ] **Wooden hoe `itemUse`**: verify using hoe on air opens the SmartWarehouse menu once.
- [ ] **Wooden hoe `playerInteractWithBlock`**: verify clicking a block does not also open the main menu because of the 250ms de-dupe window. The debounce uses `recentUseOn` map keyed by `player.id`.
- [ ] **Container menu**: verify clicking a chest/trapped chest/barrel/shulker box in a warehouse opens role menu for OP and read-only message for non-OP.
- [ ] **Selection**: verify clicking a non-container block after create flow records point A (first click) and executes the create operation (second click).

## Container Scanning

- [ ] **Double chest**: verify scanning one double chest creates one `StoredContainer` with two `occupiedLocations`.
- [ ] **Inventory access**: verify chest, trapped chest, barrel, and shulker box expose an inventory component (`getComponent("inventory")`).
- [ ] **Unloaded chunk behavior**: verify inaccessible containers are skipped without deleting warehouse records. The scanner/engine should catch exceptions from `dimension.getBlock` and return `undefined` rather than crashing.

## Sorting Engine

- [ ] **Sorting**: verify input chest moves one non-empty slot per scheduler pass into existing same-`typeId` normal container. Scheduler runs every 8 ticks, processing up to 4 warehouses per tick.
- [ ] **Misc fallback**: verify unclassified items move to `misc` if no existing same-`typeId` normal container exists and `autoCreateCategories` is disabled.
- [ ] **Full misc failure**: verify input item remains in input container when no target has space.

## Custom Commands (via `customCommandRegistry`)

- [ ] **Custom commands**: verify `/sw:create`, `/sw:resize`, `/sw:rescan`, `/sw:delete` appear in the in-game command suggestions and execute with command permission level 0 (Admin). Each command requires `cheatsRequired: true`.
- [ ] **Custom command IDs**: verify mixed-case input names normalize consistently for create/resize/rescan/delete. `normalizeWarehouseId` trims whitespace, lowercases, and restricts to `[a-z0-9_-]{1,32}`. Example: `"Main- Room"` becomes `"main- room"` (space rejected → error).
- [ ] **Custom command parameter types**: verify `sw:create` and `sw:resize` accept `name:string` + 6 `int` coordinates; verify `sw:rescan` and `sw:delete` accept `name:string` only.
- [ ] **Custom command player-only enforcement**: verify executing the command from the server console or command block returns an error. Only `minecraft:player` entities are allowed.
- [ ] **Custom command permission enforcement**: verify non-OP players receive "你没有权限执行仓库管理命令" error. Requires `player.isOp()` via `canManageWarehouse`.

## Block Maintenance Events

- [ ] **Block place event**: verify placing a container inside a warehouse area triggers `registerBlockMaintenance` → `rescanWarehouse` and updates the container list.
- [ ] **Block break event**: verify breaking a container inside a warehouse area triggers `registerBlockMaintenance` → `rescanWarehouse` and removes the container from the warehouse record.

## Runtime Model Dirtying

- [ ] **Runtime dirty after role change**: verify changing a container's role marks the runtime model dirty via `markRuntimeDirty`, so the next access rebuilds the model.
- [ ] **Runtime dirty after rescan**: verify rescanning a warehouse marks the runtime model dirty.
- [ ] **Runtime dirty after resize**: verify resizing a warehouse marks the runtime model dirty.
