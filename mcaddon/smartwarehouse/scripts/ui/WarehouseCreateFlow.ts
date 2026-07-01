import type { Player } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import type { ContainerRole } from "../types";
import { setSession } from "../interaction/SelectionSessionStore";

/**
 * 下拉菜单中显示的容器角色中文标签。
 * 索引顺序必须与 ROLE_VALUES 一一对应（0–4）。
 * - 0: 未启用   → "disabled"（容器被纳入仓库但暂不启用）
 * - 1: 普通仓位 → "normal"（普通存储容器）
 * - 2: 杂物箱   → "misc"（存放杂项物品）
 * - 3: 大宗仓位 → "bulk"（存放大量同类物品）
 * - 4: 入口箱   → "input"（用于物品输入/上货）
 */
const ROLE_LABELS: string[] = ["未启用", "普通仓位", "杂物箱", "大宗仓位", "入口箱"];

/**
 * 与 ROLE_LABELS 对应的 ContainerRole 枚举值数组。
 * 玩家选择的下拉索引直接映射到此数组的相同位置。
 */
const ROLE_VALUES: ContainerRole[] = ["disabled", "normal", "misc", "bulk", "input"];

/**
 * 显示仓库创建表单。
 * 以模态表单（ModalForm）收集仓库名称和默认容器角色，
 * 然后将这些信息保存到玩家的选择会话（SelectionSession）中，
 * 随后提示玩家使用木锄在游戏内选择仓库区域（两个对角点）。
 *
 * @param player - 要创建仓库的玩家
 */
export async function showWarehouseCreateForm(player: Player): Promise<void> {
  // 构建模态表单：标题、仓库名称文本输入框、默认容器角色下拉菜单
  const form = new ModalFormData()
    .title("创建仓库")
    .textField("仓库名称", "输入仓库名称...")
    .dropdown("默认容器角色", ROLE_LABELS, { defaultValueIndex: 0 });

  // 展示表单并等待玩家填写提交
  const response = await form.show(player);
  // 如果玩家取消填写，直接返回
  if (response.canceled) return;

  // 提取表单提交后的数据
  const values = response.formValues;
  // 防御性检查：确保至少有两个字段（仓库名称 + 角色下拉）
  if (!values || values.length < 2) {
    player.sendMessage("§c表单数据异常，请重试");
    return;
  }

  // 解析表单字段值
  const warehouseName = values[0] as string;
  const roleIndex = values[1] as number;

  // 类型校验：确保值的类型符合预期
  if (typeof warehouseName !== "string" || typeof roleIndex !== "number") {
    player.sendMessage("§c表单数据格式错误，请重试");
    return;
  }

  // 校验仓库名称不能为空或全空白字符
  if (!warehouseName || warehouseName.trim() === "") {
    player.sendMessage("§c仓库名称不能为空");
    return;
  }

  // 校验角色索引是否在合法范围内
  if (roleIndex < 0 || roleIndex >= ROLE_VALUES.length) {
    player.sendMessage("§c角色选择无效，请重试");
    return;
  }

  // 获取玩家选择的默认容器角色值
  const defaultNewContainerRole = ROLE_VALUES[roleIndex];

  // 将创建会话信息保存到全局会话存储中，等待后续区域选择操作完成
  setSession(player, {
    type: "createWarehouse",           // 会话类型：创建仓库
    warehouseName: warehouseName.trim(), // 去除首尾空格的仓库名称
    defaultNewContainerRole,            // 新容器的默认角色
  });

  // 提示玩家进入区域选择阶段：使用木锄点击两个对角点来确定仓库范围
  player.sendMessage("§a请在两个对角位置使用木锄点击方块来选择仓库区域");
}
