// Type definitions for Minecraft Bedrock Edition script APIs
// Project: https://docs.microsoft.com/minecraft/creator/
// Definitions by: Jake Shirley <https://github.com/JakeShirley>
//                 Mike Ammerlaan <https://github.com/mammerla>

/* *****************************************************************************
   Copyright (c) Microsoft Corporation.
   ***************************************************************************** */
/**
 * @packageDocumentation
 * `@minecraft/server-ui` 模块包含用于表达简单的基于对话框的用户体验的类型。
 *
 *   * {@link ActionFormData} 包含一系列带有标题和图片的按钮，可用于向玩家呈现一组选项。
 *   * {@link MessageFormData} 是简单的双按钮消息体验，适用于是/否或确定/取消问题。
 *   * {@link ModalFormData} 允许更灵活的"问卷式"控件列表，可用于接收输入。
 *
 * 清单详情
 * ```json
 * {
 *   "module_name": "@minecraft/server-ui",
 *   "version": "2.0.0"
 * }
 * ```
 *
 */
import * as minecraftcommon from '@minecraft/common';
import * as minecraftserver from '@minecraft/server';
export enum FormCancelationReason {
    UserBusy = 'UserBusy',
    UserClosed = 'UserClosed',
}

export enum FormRejectReason {
    MalformedResponse = 'MalformedResponse',
    PlayerQuit = 'PlayerQuit',
    ServerShutdown = 'ServerShutdown',
}

/**
 * 构建一个带有按钮的简单玩家表单，让玩家可以执行操作。
 * @example showActionForm.ts
 * ```typescript
 * import { world, DimensionLocation } from "@minecraft/server";
 * import { ActionFormData, ActionFormResponse } from "@minecraft/server-ui";
 *
 * function showActionForm(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const playerList = world.getPlayers();
 *
 *   if (playerList.length >= 1) {
 *     const form = new ActionFormData()
 *       .title("Test Title")
 *       .body("Body text here!")
 *       .button("btn 1")
 *       .button("btn 2")
 *       .button("btn 3")
 *       .button("btn 4")
 *       .button("btn 5");
 *
 *     form.show(playerList[0]).then((result: ActionFormResponse) => {
 *       if (result.canceled) {
 *         log("Player exited out of the dialog. Note that if the chat window is up, dialogs are automatically canceled.");
 *         return -1;
 *       } else {
 *         log("Your result was: " + result.selection);
 *       }
 *     });
 *   }
 * }
 * ```
 * @example showFavoriteMonth.ts
 * ```typescript
 * import { world, DimensionLocation } from "@minecraft/server";
 * import { ActionFormData, ActionFormResponse } from "@minecraft/server-ui";
 *
 * function showFavoriteMonth(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const players = world.getPlayers();
 *
 *   if (players.length >= 1) {
 *     const form = new ActionFormData()
 *       .title("Months")
 *       .body("Choose your favorite month!")
 *       .button("January")
 *       .button("February")
 *       .button("March")
 *       .button("April")
 *       .button("May");
 *
 *     form.show(players[0]).then((response: ActionFormResponse) => {
 *       if (response.selection === 3) {
 *         log("I like April too!");
 *         return -1;
 *       }
 *     });
 *   }
 * }
 * ```
 */
export class ActionFormData {
    /**
     * @remarks
     * 设置模态表单的正文文本的方法。
     *
     */
    body(bodyText: minecraftserver.RawMessage | string): ActionFormData;
    /**
     * @remarks
     * 向此表单添加一个带有资源包图标的按钮。
     *
     */
    button(text: minecraftserver.RawMessage | string, iconPath?: string): ActionFormData;
    /**
     * @remarks
     * 向表单添加分隔线。
     *
     */
    divider(): ActionFormData;
    /**
     * @remarks
     * 向表单添加标题。
     *
     * @param text
     * 要显示的文本。
     */
    header(text: minecraftserver.RawMessage | string): ActionFormData;
    /**
     * @remarks
     * 向表单添加标签。
     *
     * @param text
     * 要显示的文本。
     */
    label(text: minecraftserver.RawMessage | string): ActionFormData;
    /**
     * @remarks
     * 创建并显示此模态弹出表单。当玩家确认或取消对话框时异步返回。
     *
     * 此函数不能在只读模式下调用。
     *
     * @param player
     * 要显示此对话框的玩家。
     * @throws 此函数可能抛出错误。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link minecraftserver.InvalidEntityError}
     *
     * {@link minecraftserver.RawMessageError}
     */
    show(player: minecraftserver.Player): Promise<ActionFormResponse>;
    /**
     * @remarks
     * 此构建方法设置模态对话框的标题。
     *
     */
    title(titleText: minecraftserver.RawMessage | string): ActionFormData;
}

/**
 * 返回模态操作表单的玩家结果数据。
 * @example showActionForm.ts
 * ```typescript
 * import { world, DimensionLocation } from "@minecraft/server";
 * import { ActionFormData, ActionFormResponse } from "@minecraft/server-ui";
 *
 * function showActionForm(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const playerList = world.getPlayers();
 *
 *   if (playerList.length >= 1) {
 *     const form = new ActionFormData()
 *       .title("Test Title")
 *       .body("Body text here!")
 *       .button("btn 1")
 *       .button("btn 2")
 *       .button("btn 3")
 *       .button("btn 4")
 *       .button("btn 5");
 *
 *     form.show(playerList[0]).then((result: ActionFormResponse) => {
 *       if (result.canceled) {
 *         log("Player exited out of the dialog. Note that if the chat window is up, dialogs are automatically canceled.");
 *         return -1;
 *       } else {
 *         log("Your result was: " + result.selection);
 *       }
 *     });
 *   }
 * }
 * ```
 * @example showFavoriteMonth.ts
 * ```typescript
 * import { world, DimensionLocation } from "@minecraft/server";
 * import { ActionFormData, ActionFormResponse } from "@minecraft/server-ui";
 *
 * function showFavoriteMonth(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const players = world.getPlayers();
 *
 *   if (players.length >= 1) {
 *     const form = new ActionFormData()
 *       .title("Months")
 *       .body("Choose your favorite month!")
 *       .button("January")
 *       .button("February")
 *       .button("March")
 *       .button("April")
 *       .button("May");
 *
 *     form.show(players[0]).then((response: ActionFormResponse) => {
 *       if (response.selection === 3) {
 *         log("I like April too!");
 *         return -1;
 *       }
 *     });
 *   }
 * }
 * ```
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class ActionFormResponse extends FormResponse {
    private constructor();
    /**
     * @remarks
     * 返回被按下的按钮的索引。
     *
     */
    readonly selection?: number;
}

/**
 * 表单响应的基类型。
 */
export class FormResponse {
    private constructor();
    /**
     * @remarks
     * 包含表单被取消原因的附加详细信息。
     *
     */
    readonly cancelationReason?: FormCancelationReason;
    /**
     * @remarks
     * 如果为 true，表单被玩家取消（例如，他们选择了弹出窗口的 X 关闭按钮）。
     *
     */
    readonly canceled: boolean;
}

/**
 * 构建一个简单的双按钮模态对话框。
 * @example showBasicMessageForm.ts
 * ```typescript
 * import { world, DimensionLocation } from "@minecraft/server";
 * import { MessageFormResponse, MessageFormData } from "@minecraft/server-ui";
 *
 * function showBasicMessageForm(
 *   log: (message: string, status?: number) => void,
 *   targetLocation: DimensionLocation
 * ) {
 *   const players = world.getPlayers();
 *
 *   const messageForm = new MessageFormData()
 *     .title("Message Form Example")
 *     .body("This shows a simple example using §o§7MessageFormData§r.")
 *     .button1("Button 1")
 *     .button2("Button 2");
 *
 *   messageForm
 *     .show(players[0])
 *     .then((formData: MessageFormResponse) => {
 *       // 玩家取消了表单，或者另一个对话框已打开。
 *       if (formData.canceled || formData.selection === undefined) {
 *         return;
 *       }
 *
 *       log(`You selected ${formData.selection === 0 ? "Button 1" : "Button 2"}`);
 *     })
 *     .catch((error: Error) => {
 *       log("Failed to show form: " + error);
 *       return -1;
 *     });
 * }
 * ```
 * @example showTranslatedMessageForm.ts
 * ```typescript
 * import { world, DimensionLocation } from "@minecraft/server";
 * import { MessageFormResponse, MessageFormData } from "@minecraft/server-ui";
 *
 * function showTranslatedMessageForm(
 *   log: (message: string, status?: number) => void,
 *   targetLocation: DimensionLocation
 * ) {
 *   const players = world.getPlayers();
 *
 *   const messageForm = new MessageFormData()
 *     .title({ translate: "permissions.removeplayer" })
 *     .body({ translate: "accessibility.list.or.two", with: ["Player 1", "Player 2"] })
 *     .button1("Player 1")
 *     .button2("Player 2");
 *
 *   messageForm
 *     .show(players[0])
 *     .then((formData: MessageFormResponse) => {
 *       // 玩家取消了表单，或者另一个对话框已打开。
 *       if (formData.canceled || formData.selection === undefined) {
 *         return;
 *       }
 *
 *       log(`You selected ${formData.selection === 0 ? "Player 1" : "Player 2"}`);
 *     })
 *     .catch((error: Error) => {
 *       log("Failed to show form: " + error);
 *       return -1;
 *     });
 * }
 * ```
 */
export class MessageFormData {
    /**
     * @remarks
     * 设置模态表单的正文文本的方法。
     *
     */
    body(bodyText: minecraftserver.RawMessage | string): MessageFormData;
    /**
     * @remarks
     * 设置对话框第一个按钮文本的方法。
     *
     */
    button1(text: minecraftserver.RawMessage | string): MessageFormData;
    /**
     * @remarks
     * 此方法设置对话框上第二个按钮的文本。
     *
     */
    button2(text: minecraftserver.RawMessage | string): MessageFormData;
    /**
     * @remarks
     * 创建并显示此模态弹出表单。当玩家确认或取消对话框时异步返回。
     *
     * 此函数不能在只读模式下调用。
     *
     * @param player
     * 要显示此对话框的玩家。
     * @throws 此函数可能抛出错误。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link minecraftserver.InvalidEntityError}
     *
     * {@link minecraftserver.RawMessageError}
     */
    show(player: minecraftserver.Player): Promise<MessageFormResponse>;
    /**
     * @remarks
     * 此构建方法设置模态对话框的标题。
     *
     */
    title(titleText: minecraftserver.RawMessage | string): MessageFormData;
}

/**
 * 返回模态消息表单的玩家结果数据。
 * @example showBasicMessageForm.ts
 * ```typescript
 * import { world, DimensionLocation } from "@minecraft/server";
 * import { MessageFormResponse, MessageFormData } from "@minecraft/server-ui";
 *
 * function showBasicMessageForm(
 *   log: (message: string, status?: number) => void,
 *   targetLocation: DimensionLocation
 * ) {
 *   const players = world.getPlayers();
 *
 *   const messageForm = new MessageFormData()
 *     .title("Message Form Example")
 *     .body("This shows a simple example using §o§7MessageFormData§r.")
 *     .button1("Button 1")
 *     .button2("Button 2");
 *
 *   messageForm
 *     .show(players[0])
 *     .then((formData: MessageFormResponse) => {
 *       // 玩家取消了表单，或者另一个对话框已打开。
 *       if (formData.canceled || formData.selection === undefined) {
 *         return;
 *       }
 *
 *       log(`You selected ${formData.selection === 0 ? "Button 1" : "Button 2"}`);
 *     })
 *     .catch((error: Error) => {
 *       log("Failed to show form: " + error);
 *       return -1;
 *     });
 * }
 * ```
 * @example showTranslatedMessageForm.ts
 * ```typescript
 * import { world, DimensionLocation } from "@minecraft/server";
 * import { MessageFormResponse, MessageFormData } from "@minecraft/server-ui";
 *
 * function showTranslatedMessageForm(
 *   log: (message: string, status?: number) => void,
 *   targetLocation: DimensionLocation
 * ) {
 *   const players = world.getPlayers();
 *
 *   const messageForm = new MessageFormData()
 *     .title({ translate: "permissions.removeplayer" })
 *     .body({ translate: "accessibility.list.or.two", with: ["Player 1", "Player 2"] })
 *     .button1("Player 1")
 *     .button2("Player 2");
 *
 *   messageForm
 *     .show(players[0])
 *     .then((formData: MessageFormResponse) => {
 *       // 玩家取消了表单，或者另一个对话框已打开。
 *       if (formData.canceled || formData.selection === undefined) {
 *         return;
 *       }
 *
 *       log(`You selected ${formData.selection === 0 ? "Player 1" : "Player 2"}`);
 *     })
 *     .catch((error: Error) => {
 *       log("Failed to show form: " + error);
 *       return -1;
 *     });
 * }
 * ```
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class MessageFormResponse extends FormResponse {
    private constructor();
    /**
     * @remarks
     * 返回被按下的按钮的索引。
     *
     */
    readonly selection?: number;
}

/**
 * 用于为玩家创建完全可定制的弹出表单。
 * @example showBasicModalForm.ts
 * ```typescript
 * import { world, DimensionLocation } from "@minecraft/server";
 * import { ModalFormData } from "@minecraft/server-ui";
 *
 * function showBasicModalForm(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const players = world.getPlayers();
 *
 *   const modalForm = new ModalFormData().title("Example Modal Controls for §o§7ModalFormData§r");
 *
 *   modalForm.toggle("Toggle w/o default");
 *   modalForm.toggle("Toggle w/ default", true);
 *
 *   modalForm.slider("Slider w/o default", 0, 50, 5);
 *   modalForm.slider("Slider w/ default", 0, 50, 5, 30);
 *
 *   modalForm.dropdown("Dropdown w/o default", ["option 1", "option 2", "option 3"]);
 *   modalForm.dropdown("Dropdown w/ default", ["option 1", "option 2", "option 3"], 2);
 *
 *   modalForm.textField("Input w/o default", "type text here");
 *   modalForm.textField("Input w/ default", "type text here", "this is default");
 *
 *   modalForm
 *     .show(players[0])
 *     .then((formData) => {
 *       players[0].sendMessage(`Modal form results: ${JSON.stringify(formData.formValues, undefined, 2)}`);
 *     })
 *     .catch((error: Error) => {
 *       log("Failed to show form: " + error);
 *       return -1;
 *     });
 * }
 * ```
 */
export class ModalFormData {
    /**
     * @remarks
     * 向表单添加分隔线。
     *
     */
    divider(): ModalFormData;
    /**
     * @remarks
     * 向表单添加一个带选项的下拉菜单。
     *
     * @param label
     * 下拉菜单显示的标签。
     * @param items
     * 下拉菜单的可选项。
     * @param dropdownOptions
     * 用于创建下拉菜单的可选附加参数。
     */
    dropdown(
        label: minecraftserver.RawMessage | string,
        items: (minecraftserver.RawMessage | string)[],
        dropdownOptions?: ModalFormDataDropdownOptions,
    ): ModalFormData;
    /**
     * @remarks
     * 向表单添加标题。
     *
     * @param text
     * 要显示的文本。
     */
    header(text: minecraftserver.RawMessage | string): ModalFormData;
    /**
     * @remarks
     * 向表单添加标签。
     *
     * @param text
     * 要显示的文本。
     */
    label(text: minecraftserver.RawMessage | string): ModalFormData;
    /**
     * @remarks
     * 创建并显示此模态弹出表单。当玩家确认或取消对话框时异步返回。
     *
     * 此函数不能在只读模式下调用。
     *
     * @param player
     * 要显示此对话框的玩家。
     * @throws 此函数可能抛出错误。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link minecraftserver.InvalidEntityError}
     *
     * {@link minecraftserver.RawMessageError}
     */
    show(player: minecraftserver.Player): Promise<ModalFormResponse>;
    /**
     * @remarks
     * 向表单添加一个数值滑块。
     *
     * @param label
     * 滑块显示的标签。
     * @param minimumValue
     * 可选择的最小值。
     * @param maximumValue
     * 可选择的最大值。
     * @param sliderOptions
     * 用于创建滑块的可选附加参数。
     */
    slider(
        label: minecraftserver.RawMessage | string,
        minimumValue: number,
        maximumValue: number,
        sliderOptions?: ModalFormDataSliderOptions,
    ): ModalFormData;
    submitButton(submitButtonText: minecraftserver.RawMessage | string): ModalFormData;
    /**
     * @remarks
     * 向表单添加一个文本框。
     *
     * @param label
     * 文本框显示的标签。
     * @param placeholderText
     * 要显示的占位符文本。
     * @param textFieldOptions
     * 用于创建文本框的可选附加参数。
     */
    textField(
        label: minecraftserver.RawMessage | string,
        placeholderText: minecraftserver.RawMessage | string,
        textFieldOptions?: ModalFormDataTextFieldOptions,
    ): ModalFormData;
    /**
     * @remarks
     * 此构建方法设置模态对话框的标题。
     *
     */
    title(titleText: minecraftserver.RawMessage | string): ModalFormData;
    /**
     * @remarks
     * 向表单添加一个开关复选框按钮。
     *
     * @param label
     * 开关显示的标签。
     * @param toggleOptions
     * 用于创建开关的可选附加参数。
     */
    toggle(label: minecraftserver.RawMessage | string, toggleOptions?: ModalFormDataToggleOptions): ModalFormData;
}

/**
 * 返回玩家对模态表单的响应数据。
 * @example showBasicModalForm.ts
 * ```typescript
 * import { world, DimensionLocation } from "@minecraft/server";
 * import { ModalFormData } from "@minecraft/server-ui";
 *
 * function showBasicModalForm(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const players = world.getPlayers();
 *
 *   const modalForm = new ModalFormData().title("Example Modal Controls for §o§7ModalFormData§r");
 *
 *   modalForm.toggle("Toggle w/o default");
 *   modalForm.toggle("Toggle w/ default", true);
 *
 *   modalForm.slider("Slider w/o default", 0, 50, 5);
 *   modalForm.slider("Slider w/ default", 0, 50, 5, 30);
 *
 *   modalForm.dropdown("Dropdown w/o default", ["option 1", "option 2", "option 3"]);
 *   modalForm.dropdown("Dropdown w/ default", ["option 1", "option 2", "option 3"], 2);
 *
 *   modalForm.textField("Input w/o default", "type text here");
 *   modalForm.textField("Input w/ default", "type text here", "this is default");
 *
 *   modalForm
 *     .show(players[0])
 *     .then((formData) => {
 *       players[0].sendMessage(`Modal form results: ${JSON.stringify(formData.formValues, undefined, 2)}`);
 *     })
 *     .catch((error: Error) => {
 *       log("Failed to show form: " + error);
 *       return -1;
 *     });
 * }
 * ```
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class ModalFormResponse extends FormResponse {
    private constructor();
    /**
     * @remarks
     * 基于 ModalFormData 指定的控件顺序的一组有序值。
     *
     */
    readonly formValues?: (boolean | number | string | undefined)[];
}

export class UIManager {
    private constructor();
    /**
     * @remarks
     * 此函数不能在只读模式下调用。
     *
     * @throws 此函数可能抛出错误。
     */
    closeAllForms(player: minecraftserver.Player): void;
}

/**
 * 传递给 {@link @minecraft/Server-ui.ModalFormData.dropdown} 的接口，
 * 用于提供下拉菜单创建的附加选项。
 */
export interface ModalFormDataDropdownOptions {
    /**
     * @remarks
     * 默认选中的项目索引。如果不设置此值，则为 0。
     *
     */
    defaultValueIndex?: number;
    /**
     * @remarks
     * 将显示一个感叹号图标，悬停时会显示工具提示。
     *
     */
    tooltip?: minecraftserver.RawMessage | string;
}

/**
 * 传递给 {@link @minecraft/Server-ui.ModalFormData.slider} 的接口，
 * 用于提供滑块创建的附加选项。
 */
export interface ModalFormDataSliderOptions {
    /**
     * @remarks
     * 滑块的默认值。
     *
     */
    defaultValue?: number;
    /**
     * @remarks
     * 将显示一个感叹号图标，悬停时会显示工具提示。
     *
     */
    tooltip?: minecraftserver.RawMessage | string;
    /**
     * @remarks
     * 定义滑块移动时生成值的增量。如果不提供此值，则为 '1'。
     *
     */
    valueStep?: number;
}

/**
 * 传递给 {@link @minecraft/Server-ui.ModalFormData.textField} 的接口，
 * 用于提供文本框创建的附加选项。
 */
export interface ModalFormDataTextFieldOptions {
    /**
     * @remarks
     * 文本框的默认值。
     *
     */
    defaultValue?: string;
    /**
     * @remarks
     * 将显示一个感叹号图标，悬停时会显示工具提示。
     *
     */
    tooltip?: minecraftserver.RawMessage | string;
}

/**
 * 传递给 {@link @minecraft/Server-ui.ModalFormData.toggle} 的接口，
 * 用于提供开关创建的附加选项。
 */
export interface ModalFormDataToggleOptions {
    /**
     * @remarks
     * 开关的默认值。
     *
     */
    defaultValue?: boolean;
    /**
     * @remarks
     * 将显示一个感叹号图标，悬停时会显示工具提示。
     *
     */
    tooltip?: minecraftserver.RawMessage | string;
}

// @ts-ignore Class inheritance allowed for native defined classes
export class FormRejectError extends Error {
    private constructor();
    /**
     * @remarks
     * 此属性可在早期执行模式下读取。
     *
     */
    reason: FormRejectReason;
}

export const uiManager: UIManager;
