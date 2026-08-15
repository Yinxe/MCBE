// ─── 物品操作 barrel（features/basic/items） ─────────────
// 内聚：所有"操作假人背包/手持物品"的原子能力。
//   - mainhand            主手置换（背包扫描 → 置换到主手，决策在 rules/items/MainhandPolicy）
//   - equip               装备互换（主手/副手/全部装备，领域事件槽位粒度通知）
//   - EquipmentSlots      槽位映射（EquipSlotName ↔ EquipmentSlot 枚举）
//   - useItem             使用物品（闭包异步：按下 → 自动停止 → resolve）
//   - toolHealth          工具耐久（耐久变化 → 背包找同类健康工具替换）
//   - McItemCodec         物品编解码（ItemStack ↔ SerializedItemStack / 容器收集 / 状态捕获）
//   - containerInteraction 容器交互（withContainer：看向容器 → 回调自由取放）
// 非物品类原子能力（control/EntityTags/move/PoseGateway/sneak/teleport）留在 basic/ 根。

export { getMainhandOptions, setMainhandSlot, type MainhandOption } from "./mainhand";
export { swapMainhandWithBot, swapOffhandWithBot, swapEquipmentWithBot } from "./equip";
export { EQUIP_SLOT_MAP, SWAP_SLOTS } from "./EquipmentSlots";
export { useItemOnce, startUseItem, stopUseItem, registerUiSubscriptions } from "./useItem";
export { checkMainHandDurability } from "./toolHealth";
export {
  capturePlayerState, capturePlayerStateFromRotation, captureExperience, captureEffects,
  collectContainerItems, collectEquipment, serializeItemStack, itemStackToPreview,
} from "./McItemCodec";
export { withContainer, type ContainerOpResult, type ContainerAccess } from "./containerInteraction";
