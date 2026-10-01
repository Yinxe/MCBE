// Minecraft Bedrock Edition 脚本 API 的类型定义
// 项目：https://docs.microsoft.com/minecraft/creator/
// 定义者：Jake Shirley <https://github.com/JakeShirley>
//          Mike Ammerlaan <https://github.com/mammerla>

/* *****************************************************************************
   Copyright (c) Microsoft Corporation.
   ***************************************************************************** */
/**
 * @packageDocumentation
  * 包含许多与操作 Minecraft 世界相关的类型，
  * 包括实体、方块、维度等。
 *
 * 清单详情
 * ```json
 * {
 *   "module_name": "@minecraft/server",
 *   "version": "2.6.0"
 * }
 * ```
 *
 */
import * as minecraftcommon from '@minecraft/common';
// @ts-ignore Optional types-only package, will decay to any if @minecraft/vanilla-data isn't installed
import type * as minecraftvanilladata from '@minecraft/vanilla-data';
/**
  * 可通过函数 Block.getComponent 访问的方块组件类型。
  * 。
 */
export enum BlockComponentTypes {
    FluidContainer = 'minecraft:fluid_container',
    /**
     * @remarks
      * 表示世界中一个方块的库存。用于
      * 像箱子这样的方块。
     *
     */
    Inventory = 'minecraft:inventory',
    /**
     * @remarks
      * 表示方块在地图上显示时的颜色。
     *
     */
    MapColor = 'minecraft:map_color',
    /**
     * @remarks
      * 表示一个可以移动的方块（如活塞）。
     *
     */
    Movable = 'minecraft:movable',
    /**
     * @remarks
      * 当存在时，此方块具有类似活塞的行为。包含
      * 用于发现方块活塞状态的额外属性。
     *
     */
    Piston = 'minecraft:piston',
    /**
     * @remarks
      * 表示方块与降水（如雨或雪）的交互方式。
      * 。
     *
     */
    PrecipitationInteractions = 'minecraft:precipitation_interactions',
    /**
     * @remarks
      * 表示一个可以播放唱片的方块。
     *
     */
    RecordPlayer = 'minecraft:record_player',
    /**
     * @remarks
      * 表示一个可以输出红石信号的方块。
     *
     */
    RedstoneProducer = 'minecraft:redstone_producer',
    /**
     * @remarks
      * 表示一个可以在其上显示文本的方块。
     *
     */
    Sign = 'minecraft:sign',
}

/**
  * 描述方块活塞状态的枚举。
 */
export enum BlockPistonState {
    /**
     * @remarks
      * 活塞是否完全伸出。
     *
     */
    Expanded = 'Expanded',
    /**
     * @remarks
      * 活塞是否正在伸出。
     *
     */
    Expanding = 'Expanding',
    /**
     * @remarks
      * 活塞是否完全收回。
     *
     */
    Retracted = 'Retracted',
    /**
     * @remarks
      * 活塞是否正在收回。
     *
     */
    Retracting = 'Retracting',
}

/**
  * 对两个 BlockVolume 对象进行交集测试的结果描述
  * 。
 */
export enum BlockVolumeIntersection {
    /**
     * @remarks
      * 体积 B 与体积 A 没有交集点
     *
     */
    Disjoint = 0,
    /**
     * @remarks
      * 体积 B 完全位于体积 A 内部
     *
     */
    Contains = 1,
    /**
     * @remarks
      * 体积 B 与体积 A 部分相交
     *
     */
    Intersects = 2,
}

/**
  * 与使用 {@link ItemBookComponent} 相关的错误原因枚举。
  * ItemBookComponent} 相关的错误原因枚举。
 */
export enum BookErrorReason {
    /**
     * @remarks
      * 请求的页面内容超出了最大页面长度
      * 256。
     *
     */
    ExceedsMaxPageLength = 'ExceedsMaxPageLength',
    /**
     * @remarks
      * 无法创建页面，因为会超出最大
      * 页面数量 50。
     *
     */
    ExceedsMaxPages = 'ExceedsMaxPages',
    /**
     * @remarks
      * 正在签名的标题超出了最大标题长度
      * 16。
     *
     */
    ExceedsTitleLength = 'ExceedsTitleLength',
}

/**
  * 键盘、控制器或触摸界面上按钮的状态。
  * 。
 */
export enum ButtonState {
    Pressed = 'Pressed',
    Released = 'Released',
}

/**
  * 执行自定义命令所需的权限级别。
 */
export enum CommandPermissionLevel {
    /**
     * @remarks
      * 任何对象都可以运行此级别。
     *
     */
    Any = 0,
    /**
     * @remarks
      * 任何操作员都可以运行此命令，包括命令方块。
     *
     */
    GameDirectors = 1,
    /**
     * @remarks
      * 任何操作员都可以运行此命令，但不包括命令方块。
     *
     */
    Admin = 2,
    /**
     * @remarks
      * 任何服务器主机都可以运行此命令。
     *
     */
    Host = 3,
    /**
     * @remarks
      * 仅专用服务器可以运行此命令。
     *
     */
    Owner = 4,
}

/**
  * 抛出 {@link
 * @minecraft/server.ContainerRulesError} 时抛出。
 */
export enum ContainerRulesErrorReason {
    /**
     * @remarks
      * 当尝试添加在 {@link
      * ContainerRules.bannedItems} 中定义的物品时抛出。
     *
     */
    BannedItem = 'BannedItem',
    /**
     * @remarks
      * 当尝试添加具有 `Storage Item` 组件的物品到
      * {@link
      * ContainerRules.allowNestedStorageItems} 设置为 false 的容器时抛出。
     *
     */
    NestedStorageItem = 'NestedStorageItem',
    /**
     * @remarks
      * 当尝试添加不在非空
     * {@link ContainerRules.allowedItems}.
     *
     */
    NotAllowedItem = 'NotAllowedItem',
    /**
     * @remarks
      * 当尝试添加的物品使容器的
      * 重量超过 {@link ContainerRules.weightLimit} 时抛出。
     *
     */
    OverWeightLimit = 'OverWeightLimit',
    /**
     * @remarks
      * 当尝试添加由 `Storage Weight Modifier` 组件定义了零重量的物品到
      * 具有已定义 {@link ContainerRules.weightLimit} 的容器时抛出
      * 。
     *
     */
    ZeroWeightItem = 'ZeroWeightItem',
}

/**
  * 控制方案类型，定义玩家如何响应玩家输入进行移动。
  * 有关控制方案的更多详细信息，请参见以下页面：
 * 有关控制方案的更多详细信息，请参见以下页面：
 * https://learn.microsoft.com/en-us/minecraft/creator/documents/controlschemes
 */
export enum ControlScheme {
    CameraRelative = 'CameraRelative',
    CameraRelativeStrafe = 'CameraRelativeStrafe',
    LockedPlayerRelativeStrafe = 'LockedPlayerRelativeStrafe',
    PlayerRelative = 'PlayerRelative',
    PlayerRelativeStrafe = 'PlayerRelativeStrafe',
}

/**
  * 自定义命令注册失败的原因。
 */
export enum CustomCommandErrorReason {
    /**
     * @remarks
      * 命令名称已注册。
     *
     */
    AlreadyRegistered = 'AlreadyRegistered',
    /**
     * @remarks
      * 自定义命令引用了一个尚未注册的枚举
      * 。
     *
     */
    EnumDependencyMissing = 'EnumDependencyMissing',
    /**
     * @remarks
      * 提供的自定义命令命名空间与此附加包的之前注册不匹配
      * 。
     *
     */
    NamespaceMismatch = 'NamespaceMismatch',
    /**
     * @remarks
      * CustomCommand 中定义的命令参数过多。
     *
     */
    ParameterLimit = 'ParameterLimit',
    /**
     * @remarks
      * 世界初始化事件后无法访问自定义命令注册表
      * 。
     *
     */
    RegistryInvalid = 'RegistryInvalid',
    /**
     * @remarks
      * 重新加载期间不能重新定义命令参数。只有
      * 脚本闭包本身可以更改。
     *
     */
    RegistryReadOnly = 'RegistryReadOnly',
}

/**
  * 自定义命令接受的参数类型。
 */
export enum CustomCommandParamType {
    /**
     * @remarks
      * 方块类型参数提供 {@link BlockType}。
     *
     */
    BlockType = 'BlockType',
    /**
     * @remarks
      * 布尔参数。
     *
     */
    Boolean = 'Boolean',
    /**
     * @remarks
      * 实体选择器参数提供 {@link Entity}。
     *
     */
    EntitySelector = 'EntitySelector',
    /**
     * @remarks
      * 实体类型参数提供 {@link EntityType}。
     *
     */
    EntityType = 'EntityType',
    /**
     * @remarks
      * 命令枚举参数。
     *
     */
    Enum = 'Enum',
    /**
     * @remarks
      * 浮点数参数。
     *
     */
    Float = 'Float',
    /**
     * @remarks
      * 整数参数。
     *
     */
    Integer = 'Integer',
    /**
     * @remarks
      * 物品类型参数提供 {@link ItemType}。
     *
     */
    ItemType = 'ItemType',
    /**
     * @remarks
      * 位置参数提供 {@link
     * @minecraft/server.Location}.
     *
     */
    Location = 'Location',
    /**
     * @remarks
      * 玩家选择器参数提供 {@link Player}。
     *
     */
    PlayerSelector = 'PlayerSelector',
    /**
     * @remarks
      * 字符串参数。
     *
     */
    String = 'String',
}

/**
  * 谁执行了命令。
 */
export enum CustomCommandSource {
    /**
     * @remarks
      * 命令来源于命令方块。
     *
     */
    Block = 'Block',
    /**
     * @remarks
      * 命令来源于实体或玩家。
     *
     */
    Entity = 'Entity',
    NPCDialogue = 'NPCDialogue',
    /**
     * @remarks
      * 命令来源于服务器。
     *
     */
    Server = 'Server',
}

export enum CustomCommandStatus {
    Success = 0,
    Failure = 1,
}

export enum CustomComponentNameErrorReason {
    NoNamespace = 1,
    DisallowedNamespace = 2,
}

/**
  * Minecraft 各种难度级别的枚举。
  * 时间 6,000。
 */
export enum Difficulty {
    /**
     * @remarks
      * 简单难度。
     *
     */
    Easy = 'Easy',
    /**
     * @remarks
      * 困难难度。
     *
     */
    Hard = 'Hard',
    /**
     * @remarks
      * 普通难度。
     *
     */
    Normal = 'Normal',
    /**
     * @remarks
      * 和平难度。
     *
     */
    Peaceful = 'Peaceful',
}

/**
  * 通用的相对方向枚举。
 */
export enum Direction {
    /**
     * @remarks
      * 返回此物品下方的 {@link Block}（y - 1）。
     *
     */
    Down = 'Down',
    /**
     * @remarks
      * 返回此物品东侧的 {@link Block}（x + 1）。
     *
     */
    East = 'East',
    /**
     * @remarks
      * 返回此物品东侧的 {@link Block}（z + 1）。
     *
     */
    North = 'North',
    /**
     * @remarks
      * 返回此物品南侧的 {@link Block}（z - 1）。
     *
     */
    South = 'South',
    /**
     * @remarks
      * 返回此物品上方的 {@link Block}（y + 1）。
     *
     */
    Up = 'Up',
    /**
     * @remarks
      * 返回此物品西侧的 {@link Block}（x - 1）。
     *
     */
    West = 'West',
}

/**
  * 指定在记分板上显示分数的机制。
 */
export enum DisplaySlotId {
    /**
     * @remarks
      * 在玩家名称下方显示分数。
     *
     */
    BelowName = 'BelowName',
    /**
     * @remarks
      * 在暂停屏幕上以列表形式显示分数。
     *
     */
    List = 'List',
    /**
     * @remarks
      * 在玩家屏幕侧面显示分数。
     *
     */
    Sidebar = 'Sidebar',
}

/**
  * 指定用作染料的不同颜色。
 */
export enum DyeColor {
    /**
     * @remarks
      * 黑色染料。
     *
     */
    Black = 'Black',
    /**
     * @remarks
      * 蓝色染料。
     *
     */
    Blue = 'Blue',
    /**
     * @remarks
      * 棕色染料。
     *
     */
    Brown = 'Brown',
    /**
     * @remarks
      * 青色染料。
     *
     */
    Cyan = 'Cyan',
    /**
     * @remarks
      * 灰色染料。
     *
     */
    Gray = 'Gray',
    /**
     * @remarks
      * 绿色染料。
     *
     */
    Green = 'Green',
    /**
     * @remarks
      * 淡蓝色染料。
     *
     */
    LightBlue = 'LightBlue',
    /**
     * @remarks
      * 黄绿色染料。
     *
     */
    Lime = 'Lime',
    /**
     * @remarks
      * 品红色染料。
     *
     */
    Magenta = 'Magenta',
    /**
     * @remarks
      * 橙色染料。
     *
     */
    Orange = 'Orange',
    /**
     * @remarks
      * 粉色染料。
     *
     */
    Pink = 'Pink',
    /**
     * @remarks
      * 紫色染料。
     *
     */
    Purple = 'Purple',
    /**
     * @remarks
      * 红色染料。
     *
     */
    Red = 'Red',
    /**
     * @remarks
      * 淡灰色染料。
     *
     */
    Silver = 'Silver',
    /**
     * @remarks
      * 白色染料。
     *
     */
    White = 'White',
    /**
     * @remarks
      * 黄色染料。
     *
     */
    Yellow = 'Yellow',
}

export enum EasingType {
    InBack = 'InBack',
    InBounce = 'InBounce',
    InCirc = 'InCirc',
    InCubic = 'InCubic',
    InElastic = 'InElastic',
    InExpo = 'InExpo',
    InOutBack = 'InOutBack',
    InOutBounce = 'InOutBounce',
    InOutCirc = 'InOutCirc',
    InOutCubic = 'InOutCubic',
    InOutElastic = 'InOutElastic',
    InOutExpo = 'InOutExpo',
    InOutQuad = 'InOutQuad',
    InOutQuart = 'InOutQuart',
    InOutQuint = 'InOutQuint',
    InOutSine = 'InOutSine',
    InQuad = 'InQuad',
    InQuart = 'InQuart',
    InQuint = 'InQuint',
    InSine = 'InSine',
    Linear = 'Linear',
    OutBack = 'OutBack',
    OutBounce = 'OutBounce',
    OutCirc = 'OutCirc',
    OutCubic = 'OutCubic',
    OutElastic = 'OutElastic',
    OutExpo = 'OutExpo',
    OutQuad = 'OutQuad',
    OutQuart = 'OutQuart',
    OutQuint = 'OutQuint',
    OutSine = 'OutSine',
    Spring = 'Spring',
}

export enum EnchantmentSlot {
    ArmorFeet = 'ArmorFeet',
    ArmorHead = 'ArmorHead',
    ArmorLegs = 'ArmorLegs',
    ArmorTorso = 'ArmorTorso',
    Axe = 'Axe',
    Bow = 'Bow',
    CarrotStick = 'CarrotStick',
    CosmeticHead = 'CosmeticHead',
    Crossbow = 'Crossbow',
    Elytra = 'Elytra',
    FishingRod = 'FishingRod',
    Flintsteel = 'Flintsteel',
    Hoe = 'Hoe',
    MeleeSpear = 'MeleeSpear',
    Pickaxe = 'Pickaxe',
    Shears = 'Shears',
    Shield = 'Shield',
    Shovel = 'Shovel',
    Spear = 'Spear',
    Sword = 'Sword',
}

/**
 * 实体的附着位置点。包含诸如
 * 头部、身体、腿部等用于附着相机的点。
 */
export enum EntityAttachPoint {
    Body = 'Body',
    BreathingPoint = 'BreathingPoint',
    DropAttachPoint = 'DropAttachPoint',
    ExplosionPoint = 'ExplosionPoint',
    Eyes = 'Eyes',
    Feet = 'Feet',
    Head = 'Head',
    Mouth = 'Mouth',
    WeaponAttachPoint = 'WeaponAttachPoint',
}

/**
  * 可通过函数 Entity.getComponent 访问的实体组件类型。
 * 函数 Entity.getComponent。
 */
export enum EntityComponentTypes {
    /**
     * @remarks
     * 添加后，此组件将使实体在生成
    *
     * 时携带指定实体类型的骑乘者。
    *
     *
     */
    AddRider = 'minecraft:addrider',
    /**
     * @remarks
     * 为实体添加成长定时器。可以通过
    *
     * 给予实体其喜好的物品（由 feedItems 定义）来加速成长。
    *
     * 
    *
     *
     */
    Ageable = 'minecraft:ageable',
    /**
     * @remarks
     * 定义此实体可以在哪些方块
    *
     * 中呼吸，并赋予其窒息能力。
    *
     *
     */
    Breathable = 'minecraft:breathable',
    /**
     * @remarks
     * 添加后，此组件表示
    *
     * 实体可以攀爬梯子。
    *
     *
     */
    CanClimb = 'minecraft:can_climb',
    /**
     * @remarks
     * 添加后，此组件表示实体可
    *
     * 以飞行，且寻路器将不受限于下方需要实心方块的路径。
    *
     * 
    *
     *
     */
    CanFly = 'minecraft:can_fly',
    /**
     * @remarks
     * 添加后，此组件表示实体可以像 Min
    *
     * ecraft 中的马一样进行蓄力跳跃。
    *
     *
     */
    CanPowerJump = 'minecraft:can_power_jump',
    /**
     * @remarks
     * 定义实体的颜色。仅适用于具
    *
     * 有预定义颜色值的某些实体（例如，羊、羊驼、潜影贝）。
    *
     * 
    *
     *
     */
    Color = 'minecraft:color',
    /**
     * @remarks
     * 定义实体的次要颜色。仅适用于具
     * 有预定义次要颜色值的某些实体（例如，
     * 热带鱼）。
     *
     */
    Color2 = 'minecraft:color2',
    CursorInventory = 'minecraft:cursor_inventory',
    /**
     * @remarks
     * 提供对生物装备槽的访问。此组件
     * 存在于所有生物实体中。
     *
     */
    Equippable = 'minecraft:equippable',
    /**
     * @remarks
     * 添加后，此组件表示此
    *
     * 实体不会受到火焰伤害。
    *
     *
     */
    FireImmune = 'minecraft:fire_immune',
    /**
     * @remarks
     * 添加后，此组件表示此实
    *
     * 体可以在液体方块中漂浮。
    *
     *
     */
    FloatsInLiquid = 'minecraft:floats_in_liquid',
    /**
     * @remarks
     * 表示实体的飞行速度。
    *
     *
     */
    FlyingSpeed = 'minecraft:flying_speed',
    /**
     * @remarks
     * 定义摩擦力对此实体的影响程度。
    *
     *
     */
    FrictionModifier = 'minecraft:friction_modifier',
    /**
     * @remarks
     * 定义与此实体进行治疗的交互。
    *
     *
     */
    Healable = 'minecraft:healable',
    /**
     * @remarks
     * 定义实体的生命值属性。
    *
     *
     */
    Health = 'minecraft:health',
    /**
     * @remarks
     * 定义此实体的物品栏属性。
    *
     *
     */
    Inventory = 'minecraft:inventory',
    /**
     * @remarks
     * 添加后，此组件表
    *
     * 示此实体为幼体。
    *
     *
     */
    IsBaby = 'minecraft:is_baby',
    /**
     * @remarks
     * 添加后，此组件表示
    *
     * 此实体处于充能状态。
    *
     *
     */
    IsCharged = 'minecraft:is_charged',
    /**
     * @remarks
     * 添加后，此组件表示
    *
     * 此实体当前携带箱子。
    *
     *
     */
    IsChested = 'minecraft:is_chested',
    /**
     * @remarks
     * 添加后，此组件表示可以使
    *
     * 用染料改变此实体的颜色。
    *
     *
     */
    IsDyeable = 'minecraft:is_dyeable',
    /**
     * @remarks
     * 添加后，此组件表示此实体
    *
     * 在隐身时可以躲避敌对生物。
    *
     *
     */
    IsHiddenWhenInvisible = 'minecraft:is_hidden_when_invisible',
    /**
     * @remarks
     * 添加后，此组件表示此
    *
     * 实体当前处于着火状态。
    *
     *
     */
    IsIgnited = 'minecraft:is_ignited',
    /**
     * @remarks
     * 添加后，此组件表示
    *
     * 此实体为灾厄队长。
    *
     *
     */
    IsIllagerCaptain = 'minecraft:is_illager_captain',
    /**
     * @remarks
     * 添加后，此组件表示
    *
     * 此实体当前配有鞍。
    *
     *
     */
    IsSaddled = 'minecraft:is_saddled',
    /**
     * @remarks
     * 添加后，此组件表示
    *
     * 此实体当前在颤抖。
    *
     *
     */
    IsShaking = 'minecraft:is_shaking',
    /**
     * @remarks
     * 添加后，此组件表示
    *
     * 此实体当前已被剪毛。
    *
     *
     */
    IsSheared = 'minecraft:is_sheared',
    /**
     * @remarks
     * 添加后，此组件表示
    *
     * 此实体可以被堆叠。
    *
     *
     */
    IsStackable = 'minecraft:is_stackable',
    /**
     * @remarks
     * 添加后，此组件表示此
    *
     * 实体当前处于眩晕状态。
    *
     *
     */
    IsStunned = 'minecraft:is_stunned',
    /**
     * @remarks
     * 添加后，此组件表示
    *
     * 此实体当前已被驯服。
    *
     *
     */
    IsTamed = 'minecraft:is_tamed',
    /**
     * @remarks
     * 如果添加到实体上，表示该实体
    *
     * 代表世界中一个自由漂浮的物品。允许通过 itemStac
    *
     * k 属性获取实际的物品堆内容。
    *
     * 
    *
     *
     */
    Item = 'minecraft:item',
    /**
     * @remarks
     * 定义此实体在熔岩中的基础移动速度。
    *
     *
     */
    LavaMovement = 'minecraft:lava_movement',
    /**
     * @remarks
     * 允许此实体被拴绳拴住，并定义
     * 此实体被拴住时的条件和事件。
     *
     */
    Leashable = 'minecraft:leashable',
    /**
     * @remarks
     * 添加后，此组件表示此实体
     * 包含一个额外的变体值。可用于进一步
     * 区分变体。
     *
     */
    MarkVariant = 'minecraft:mark_variant',
    /**
     * @remarks
     * 定义此实体的常规移动速度。
     *
     */
    Movement = 'minecraft:movement',
    /**
     * @remarks
     * 添加后，此移动控制使生物能够
     * 在水中游泳和在陆地上行走。
     *
     */
    MovementAmphibious = 'minecraft:movement.amphibious',
    /**
     * @remarks
     * 添加后，此组件允许实体的移动。
     *
     */
    MovementBasic = 'minecraft:movement.basic',
    /**
     * @remarks
     * 添加后，此移动控制使生物飞行。
     *
     */
    MovementFly = 'minecraft:movement.fly',
    /**
     * @remarks
     * 添加后，此移动控制允许生物飞行、游泳、
     * 攀爬等。
     *
     */
    MovementGeneric = 'minecraft:movement.generic',
    /**
     * @remarks
     * 添加后，此移动控制允许生物滑翔。
     *
     */
    MovementGlide = 'minecraft:movement.glide',
    /**
     * @remarks
     * 添加后，此移动控制使生物悬停。
     *
     */
    MovementHover = 'minecraft:movement.hover',
    /**
     * @remarks
     * 移动控制，使生物在移动时跳跃，
     * 跳跃之间具有指定的延迟。
     *
     */
    MovementJump = 'minecraft:movement.jump',
    /**
     * @remarks
     * 添加后，此移动控制使生物在
     * 移动时单脚跳。
     *
     */
    MovementSkip = 'minecraft:movement.skip',
    /**
     * @remarks
     * 添加后，此移动控制使生物左右摇摆，
     * 给人一种正在游泳的印象。
     *
     */
    MovementSway = 'minecraft:movement.sway',
    /**
     * @remarks
     * 允许此实体生成包含垂直墙壁的路径
     * （例如，类似 Minecraft 蜘蛛的方式。）
     *
     */
    NavigationClimb = 'minecraft:navigation.climb',
    /**
     * @remarks
     * 允许此实体像普通恶魂一样
     * 在空中飞行生成路径。
     *
     */
    NavigationFloat = 'minecraft:navigation.float',
    /**
     * @remarks
     * 允许此实体在空中生成路径（例如
     * 类似 Minecraft 鹦鹉的方式。）
     *
     */
    NavigationFly = 'minecraft:navigation.fly',
    /**
     * @remarks
     * 允许此实体通过行走、游泳、
     * 飞行和/或攀爬以及上下跳跃生成路径
     * 。
     *
     */
    NavigationGeneric = 'minecraft:navigation.generic',
    /**
     * @remarks
     * 允许此实体在空中生成路径（例如
     * 类似 Minecraft 蜜蜂的方式。）防止它们
     * 从天空中掉落并进行预测性移动。
     *
     */
    NavigationHover = 'minecraft:navigation.hover',
    /**
     * @remarks
     * 允许此实体通过行走和
     * 像普通生物一样上下跳跃一个方块来生成路径。
     *
     */
    NavigationWalk = 'minecraft:navigation.walk',
    /**
     * @remarks
     * 当存在于实体上时，此实体正在着火。
     *
     */
    OnFire = 'minecraft:onfire',
    /**
     * @remarks
     * 使用此组件读取玩家的疲劳度。此组件
     * 仅适用于玩家。
     *
     */
    Exhaustion = 'minecraft:player.exhaustion',
    /**
     * @remarks
     * 使用此组件读取玩家的饥饿度。此组件
     * 仅适用于玩家。
     *
     */
    Hunger = 'minecraft:player.hunger',
    /**
     * @remarks
     * 使用此组件读取玩家的饱和度。此组件
     * 仅适用于玩家。
     *
     */
    Saturation = 'minecraft:player.saturation',
    /**
     * @remarks
     * 抛射物组件控制抛射物
     * 实体的属性，并允许其沿给定
     * 方向射击。当实体具有
     * minecraft:projectile 组件时，此组件存在。
     *
     */
    Projectile = 'minecraft:projectile',
    /**
     * @remarks
     * 设置实体可以穿过的距离。
     *
     */
    PushThrough = 'minecraft:push_through',
    /**
     * @remarks
     * 添加后，此组件增加了实体
     * 可以被另一个实体骑乘的能力。
     *
     */
    Rideable = 'minecraft:rideable',
    /**
     * @remarks
     * 当实体正在骑乘
     * 另一个实体时，此组件将被添加到该实体。
     *
     */
    Riding = 'minecraft:riding',
    /**
     * @remarks
     * 设置实体的视觉大小。
     *
     */
    Scale = 'minecraft:scale',
    /**
     * @remarks
     * 皮肤 ID 值。可用于区分皮肤，例如
     * 村民的基础皮肤。
     *
     */
    SkinId = 'minecraft:skin_id',
    /**
     * @remarks
     * 定义实体携带物品的强度。
     *
     */
    Strength = 'minecraft:strength',
    /**
     * @remarks
     * 定义实体被玩家驯服的规则。
     *
     */
    Tameable = 'minecraft:tameable',
    /**
     * @remarks
     * 包含基于骑乘它的实体
     * 来驯服可骑乘实体的选项。
     *
     */
    TameMount = 'minecraft:tamemount',
    /**
     * @remarks
     * 用于确定实体所属的类型家族。
     *
     */
    TypeFamily = 'minecraft:type_family',
    /**
     * @remarks
     * 定义此实体在水下的常规移动速度
     * 。
     *
     */
    UnderwaterMovement = 'minecraft:underwater_movement',
    /**
     * @remarks
     * 用于将实体的变体组件组
     * 与其他实体区分开（例如豹猫、村民）。
     *
     */
    Variant = 'minecraft:variant',
    /**
     * @remarks
     * 添加后，此组件表示此实体想要
     * 成为骑手。
     *
     */
    WantsJockey = 'minecraft:wants_jockey',
}

/**
  * 描述来自实体的伤害来源。
 */
export enum EntityDamageCause {
    /**
     * @remarks
     * 由掉落铁砧造成的伤害。
     *
     */
    anvil = 'anvil',
    /**
     * @remarks
     * 由非实体爆炸造成的伤害。例如，
     * 床爆炸。
     *
     */
    blockExplosion = 'blockExplosion',
    /**
     * @remarks
     * 由营火造成的伤害。
     *
     */
    campfire = 'campfire',
    /**
     * @remarks
     * 未使用。
     *
     */
    charging = 'charging',
    /**
     * @remarks
     * 由物理接触实体或方块造成的伤害。例如
     * 接触甜浆果丛或河豚。
     *
     */
    contact = 'contact',
    /**
     * @remarks
     * 由实体在液体方块中
     * 缺氧造成的伤害。
     *
     */
    drowning = 'drowning',
    /**
     * @remarks
     * 由实体攻击造成的伤害。
     *
     */
    entityAttack = 'entityAttack',
    /**
     * @remarks
     * 由实体爆炸造成的伤害。例如，苦力怕
     * 或凋灵。
     *
     */
    entityExplosion = 'entityExplosion',
    /**
     * @remarks
     * 由落在地面上造成的伤害。
     *
     */
    fall = 'fall',
    /**
     * @remarks
     * 由掉落的方块造成的伤害。注意：铁砧和
     * 钟乳石有自己的伤害原因。
     *
     */
    fallingBlock = 'fallingBlock',
    /**
     * @remarks
     * 由着火造成的伤害。
     *
     */
    fire = 'fire',
    /**
     * @remarks
     * 由持续燃烧造成的伤害。
     *
     */
    fireTick = 'fireTick',
    /**
     * @remarks
     * 由烟花造成的伤害。
     *
     */
    fireworks = 'fireworks',
    /**
     * @remarks
     * 由使用鞘翅滑翔时高速
     * 撞墙造成的伤害。
     *
     */
    flyIntoWall = 'flyIntoWall',
    /**
     * @remarks
     * 由停留在细雪方块中造成的伤害。
     *
     */
    freezing = 'freezing',
    /**
     * @remarks
     * 由接触熔岩方块造成的伤害。
     *
     */
    lava = 'lava',
    /**
     * @remarks
     * 由被闪电击中造成的伤害。
     *
     */
    lightning = 'lightning',
    maceSmash = 'maceSmash',
    /**
     * @remarks
     * 由魔法攻击造成的伤害。例如，唤魔者尖牙
     * 或潮涌核心方块。
     *
     */
    magic = 'magic',
    /**
     * @remarks
     * 由接触岩浆块造成的伤害。
     *
     */
    magma = 'magma',
    /**
     * @remarks
     * 由无来源造成的伤害。例如，来自命令或
     * 脚本。
     *
     */
    none = 'none',
    /**
     * @remarks
     * 由间接来源造成的伤害。例如，在行为包中将
     * 生物的生命值设置为 0。
     *
     */
    override = 'override',
    /**
     * @remarks
     * 由活塞造成的伤害。
     *
     */
    piston = 'piston',
    /**
     * @remarks
     * 由抛射物造成的伤害。
     *
     */
    projectile = 'projectile',
    /**
     * @remarks
     * 由山羊冲撞造成的伤害。
     *
     */
    ramAttack = 'ramAttack',
    /**
     * @remarks
     * 由 /kill 命令造成的伤害。
     *
     */
    selfDestruct = 'selfDestruct',
    /**
     * @remarks
     * 由监守者的音波尖啸攻击造成的伤害。
     *
     */
    sonicBoom = 'sonicBoom',
    /**
     * @remarks
     * 由灵魂营火造成的伤害。
     *
     */
    soulCampfire = 'soulCampfire',
    /**
     * @remarks
     * 由掉落的钟乳石方块造成的伤害。
     *
     */
    stalactite = 'stalactite',
    /**
     * @remarks
     * 由接触石笋方块造成的伤害。
     *
     */
    stalagmite = 'stalagmite',
    /**
     * @remarks
     * 因饥饿值耗尽而随时间造成的伤害。
     *
     */
    starve = 'starve',
    /**
     * @remarks
     * 由实体在非液体方块中
     * 缺氧造成的伤害。
     *
     */
    suffocation = 'suffocation',
    /**
     * @remarks
     * 由实体处于不宜居气候中造成的伤害。
     * 例如，雪傀儡在温度大于 1 的生物群系中。
     *
     */
    temperature = 'temperature',
    /**
     * @remarks
     * 由荆棘盔甲附魔和
     * 守卫者荆棘效果造成的伤害。
     *
     */
    thorns = 'thorns',
    /**
     * @remarks
     * 因掉入虚空而随时间造成的伤害。
     *
     */
    'void' = 'void',
    /**
     * @remarks
     * 由凋灵效果造成的伤害。例如，接触
     * 凋灵玫瑰。
     *
     */
    wither = 'wither',
}

/**
  * 描述实体的治疗来源。
 */
export enum EntityHealCause {
    /**
     * @remarks
     * 由药水等物品造成的治疗。
     *
     */
    Heal = 'Heal',
    /**
     * @remarks
     * 由再生效果造成的治疗。
     *
     */
    Regeneration = 'Regeneration',
    /**
     * @remarks
     * 当饥饿值满时造成的治疗。
     *
     */
    SelfHeal = 'SelfHeal',
}

/**
  * 描述实体初始化原因的枚举。
 */
export enum EntityInitializationCause {
    /**
     * @remarks
     * 实体作为其他实体的子代创建时的情况，例如
     * 牛生出小牛，或史莱姆死亡后分裂成更小的史莱姆。
     *
     */
    Born = 'Born',
    /**
     * @remarks
     * 实体由事件创建时的情况，例如
     * 流浪商人生成羊驼。
     *
     */
    Event = 'Event',
    /**
     * @remarks
     * 实体加载到世界中时的情况。
     *
     */
    Loaded = 'Loaded',
    /**
     * @remarks
     * 实体在世界中自然生成时的情况。
     *
     */
    Spawned = 'Spawned',
    /**
     * @remarks
     * 实体转化为另一个实体时的情况。
     *
     */
    Transformed = 'Transformed',
}

/**
 * 描述实体挥动来源的枚举。作为
 * {@link PlayerSwingStartAfterEvent} 的一部分发送
 */
export enum EntitySwingSource {
    /**
     * @remarks
     * 当实体作为攻击的一部分挥动时发送。
     *
     */
    Attack = 'Attack',
    /**
     * @remarks
     * 当实体作为建造动作的一部分挥动时发送。
     *
     */
    Build = 'Build',
    /**
     * @remarks
     * 当实体作为丢弃物品的一部分挥动时发送。
     *
     */
    DropItem = 'DropItem',
    /**
     * @remarks
     * 当实体作为事件响应的一部分挥动时发送。
     *
     */
    Event = 'Event',
    /**
     * @remarks
     * 当实体作为交互的一部分挥动时发送。
     *
     */
    Interact = 'Interact',
    /**
     * @remarks
     * 当实体作为采矿动作的一部分挥动时发送。
     *
     */
    Mine = 'Mine',
    /**
     * @remarks
     * 当实体挥动没有可确定的来源时发送。
     *
     */
    None = 'None',
    /**
     * @remarks
     * 当实体作为投掷物品的一部分挥动时发送。
     *
     */
    ThrowItem = 'ThrowItem',
    /**
     * @remarks
     * 当实体作为使用物品的一部分挥动时发送。
     *
     */
    UseItem = 'UseItem',
}

/**
  * 生物的装备槽。包括盔甲、副手
  * 和主手槽。
 */
export enum EquipmentSlot {
    /**
     * @remarks
      * 胸部槽位。此槽位用于存放如
      * 胸甲或鞘翅等物品。
     *
     */
    Chest = 'Chest',
    /**
     * @remarks
      * 脚部槽位。此槽位用于存放如
      * 靴子等物品。
     *
     */
    Feet = 'Feet',
    /**
     * @remarks
      * 头部槽位。此槽位用于存放如
      * 头盔或雕刻南瓜等物品。
     *
     */
    Head = 'Head',
    /**
     * @remarks
      * 腿部槽位。此槽位用于存放如
      * 护腿等物品。
     *
     */
    Legs = 'Legs',
    /**
     * @remarks
      * 主手槽位。对于玩家来说，主手槽位指
      * 当前激活的热键栏槽位。
     *
     */
    Mainhand = 'Mainhand',
    /**
     * @remarks
      * 副手槽位。此槽位用于存放如
      * 盾牌和地图等物品。
     *
     */
    Offhand = 'Offhand',
}

/**
  * 表示用于流体容器（如炼药锅）内的流体类型。
  * 。
 */
export enum FluidType {
    /**
     * @remarks
      * 表示熔岩作为一种流体类型。
     *
     */
    Lava = 'Lava',
    /**
     * @remarks
      * 表示药水作为一种流体类型。
     *
     */
    Potion = 'Potion',
    /**
     * @remarks
      * 表示细雪作为一种流体类型。
     *
     */
    PowderSnow = 'PowderSnow',
    /**
     * @remarks
      * 表示水作为一种流体类型。
     *
     */
    Water = 'Water',
}

/**
  * 代表当前世界体验的游戏模式。
 */
export enum GameMode {
    /**
     * @remarks
      * 世界处于更受限制的体验中，方块可能
      * 无法被操作。
     *
     */
    Adventure = 'Adventure',
    /**
     * @remarks
      * 世界处于完全创造模式。在创造模式中，
      * 玩家拥有物品选择标签和生存选择标签中的所有资源。
      * 他们还可以瞬间破坏方块，包括那些通常
      * 不可摧毁的方块。命令方块和结构方块也可以在
      * 创造模式中使用。物品也不会失去耐久度或
      * 消失。
     * disappear.
     *
     */
    Creative = 'Creative',
    /**
     * @remarks
      * 世界处于旁观者模式。在旁观者模式中，旁观者
      * 始终飞行且无法落地。旁观者可以
      * 无碰撞地穿过固体方块和实体，并且不能使用物品或与方块或
      * 生物交互。旁观者无法被生物或其他玩家看见，
      * 但其他旁观者除外；旁观者显示为一个透明的浮动头部
      * 。
1683	     *
1684	     */
    Spectator = 'Spectator',
    /**
     * @remarks
      * 世界处于生存模式，玩家可能会受到伤害
      * 且生物可能并非和平。在生存模式中，
      * 玩家必须在生成的生存世界中收集资源、建造结构
      * 。活动会随着时间推移逐渐消耗
      * 玩家的生命值和饥饿值。
     *
     */
    Survival = 'Survival',
}

/**
  * 游戏规则。这些值也可以通过
  * /gamerule 命令控制。
 */
export enum GameRule {
    /**
     * @remarks
      * 命令方块执行命令时是否通知管理员
      * 。
     *
     */
    CommandBlockOutput = 'commandBlockOutput',
    /**
     * @remarks
      * 控制命令方块是否可以执行命令。
     *
     */
    CommandBlocksEnabled = 'commandBlocksEnabled',
    /**
     * @remarks
      * 控制昼夜循环是否进行。
     *
     */
    DoDayLightCycle = 'doDayLightCycle',
    /**
     * @remarks
      * 控制非生物实体是否掉落物品。即物品展示框。
     *
     */
    DoEntityDrops = 'doEntityDrops',
    /**
     * @remarks
      * 控制火势是否蔓延。
     *
     */
    DoFireTick = 'doFireTick',
    /**
     * @remarks
      * 控制玩家是立即重生还是显示死亡画面。
      * 死亡屏幕。
     *
     */
    DoImmediateRespawn = 'doImmediateRespawn',
    /**
     * @remarks
      * 控制玩家是否处理不睡觉的后果（如幻翼生成）。
      * 。
     *
     */
    DoInsomnia = 'doInsomnia',
    /**
     * @remarks
      * 确定玩家是否只能制作那些他们已解锁的配方——
      * 当 dolimitedcrafting 设置为 true 时
      * 。
     *
     */
    DoLimitedCrafting = 'doLimitedCrafting',
    /**
     * @remarks
      * 控制生物是否掉落战利品。
     *
     */
    DoMobLoot = 'doMobLoot',
    /**
     * @remarks
      * 控制生物是否在世界中自然生成。
     *
     */
    DoMobSpawning = 'doMobSpawning',
    /**
     * @remarks
      * 控制方块被破坏时是否掉落物品。
     *
     */
    DoTileDrops = 'doTileDrops',
    /**
     * @remarks
      * 控制天气是否可以自然变化。
     *
     */
    DoWeatherCycle = 'doWeatherCycle',
    /**
     * @remarks
      * 控制实体是否受到溺水伤害。
     *
     */
    DrowningDamage = 'drowningDamage',
    /**
     * @remarks
      * 控制实体是否受到摔落伤害。
     *
     */
    FallDamage = 'fallDamage',
    /**
     * @remarks
      * 控制实体是否受到火焰伤害。
     *
     */
    FireDamage = 'fireDamage',
    /**
     * @remarks
      * 控制是否存在冰冻伤害。
     *
     */
    FreezeDamage = 'freezeDamage',
    /**
     * @remarks
      * 通过 /function 命令可以同时执行的最大命令数
      * 。
     *
     */
    FunctionCommandLimit = 'functionCommandLimit',
    /**
     * @remarks
      * 控制玩家死亡时是否保留背包
      * 。
     *
     */
    KeepInventory = 'keepInventory',
    /**
     * @remarks
      * 每 tick 可以执行的连锁命令的最大数量
      * 。
     *
     */
    MaxCommandChainLength = 'maxCommandChainLength',
    /**
     * @remarks
      * 控制世界中是否会发生生物破坏。
      * 例如：苦力怕爆炸破坏方块。
     *
     */
    MobGriefing = 'mobGriefing',
    /**
     * @remarks
      * 控制玩家是否可以恢复生命值。
     *
     */
    NaturalRegeneration = 'naturalRegeneration',
    /**
     * @remarks
      * 为了推进到第二天所需睡觉的玩家百分比
      * 。
     *
     */
    PlayersSleepingPercentage = 'playersSleepingPercentage',
    /**
     * @remarks
      * 控制抛射物（具有抛射物组件的实体，如箭、
      * 投掷的三叉戟或烟花）是否可以
      * 破坏支持此交互的特定方块（例如
      * 紫颂果、滴水石锥或饰纹陶罐）。对哪些抛射物可以
      * 破坏哪些方块有限制。
     *
     */
    ProjectilesCanBreakBlocks = 'projectilesCanBreakBlocks',
    /**
     * @remarks
      * 控制玩家是否可以互相伤害。
     *
     */
    Pvp = 'pvp',
    /**
     * @remarks
      * 控制随机刻发生的频率。值为 0 或
      * 以下将禁用随机刻。默认值为 1。
     *
     */
    RandomTickSpeed = 'randomTickSpeed',
    /**
     * @remarks
      * 控制内置（原版）配方是否随玩家在游戏中的进展自动解锁
      * （另一种方式是使用 /recipe 命令基于
      * 自定义游戏逻辑）
      * 。
     *
     */
    RecipesUnlock = 'recipesUnlock',
    /**
     * @remarks
      * 控制重生方块（例如床、重生锚）是否会在
      * 其他维度爆炸。
     *
     */
    RespawnBlocksExplode = 'respawnBlocksExplode',
    /**
     * @remarks
      * 控制命令输出是否显示给玩家。
      * 也控制命令方块输出是否默认被存储
      * 。
     *
     */
    SendCommandFeedback = 'sendCommandFeedback',
    /**
     * @remarks
      * 控制边界方块效果是否显示。
     *
     */
    ShowBorderEffect = 'showBorderEffect',
    /**
     * @remarks
      * 控制玩家坐标是否显示。
     *
     */
    ShowCoordinates = 'showCoordinates',
    /**
     * @remarks
      * 控制玩家游戏天数是否显示。
     *
     */
    ShowDaysPlayed = 'showDaysPlayed',
    /**
     * @remarks
      * 控制死亡消息是否在聊天中显示。
     *
     */
    ShowDeathMessages = 'showDeathMessages',
    /**
     * @remarks
      * 控制配方的标准玩家通知是否
      * 显示。当设置为 false 时，'玩家已解锁配方'不再
      * 作为玩家通知发送。
     *
     */
    ShowRecipeMessages = 'showRecipeMessages',
    /**
     * @remarks
      * 控制物品标签是否显示。例如 'Can Place On'、
      * 'Can Destroy'、物品锁定图标等。
     *
     */
    ShowTags = 'showTags',
    /**
     * @remarks
      * 玩家允许在世界出生点周围出生的方块半径。
      * 不影响冒险模式。
      * 默认值为 10 个方块。
     *
     */
    SpawnRadius = 'spawnRadius',
    /**
     * @remarks
      * 影响 TNT 方块是否可以被点燃。
     *
     */
    TntExplodes = 'tntExplodes',
    /**
     * @remarks
      * 控制方块被爆炸破坏时是随机掉落战利品还是所有方块
      * 都掉落战利品。默认为 false。
     *
     */
    TntExplosionDropDecay = 'tntExplosionDropDecay',
}

/**
  * 描述客户端的图形模式。由 {@link Player.graphicsMode} 使用。
  * Player.graphicsMode} 使用。
 */
export enum GraphicsMode {
    /**
     * @remarks
      * 指延迟技术预览图形模式设置的图形模式
      * 。
     *
     */
    Deferred = 'Deferred',
    /**
     * @remarks
      * 指精美图形模式设置的图形模式。大多数特殊图形
      * 效果在此设置下开启
      * 。
     *
     */
    Fancy = 'Fancy',
    /**
     * @remarks
      * 指光线追踪图形模式设置的图形模式。此设置启用
      * 光线追踪。
     *
     */
    RayTraced = 'RayTraced',
    /**
     * @remarks
      * 指简单图形模式设置的图形模式。大多数图形
      * 效果在此设置下关闭
      * 。
     *
     */
    Simple = 'Simple',
}

/**
  * 指定与实体当前手持物品相关的选项。
  * 。
 */
export enum HeldItemOption {
    /**
     * @remarks
      * 手持任何物品。
     *
     */
    AnyItem = 'AnyItem',
    /**
     * @remarks
      * 未手持物品。
     *
     */
    NoItem = 'NoItem',
}

export enum HudElement {
    PaperDoll = 0,
    Armor = 1,
    ToolTips = 2,
    TouchControls = 3,
    Crosshair = 4,
    Hotbar = 5,
    Health = 6,
    ProgressBar = 7,
    Hunger = 8,
    AirBubbles = 9,
    HorseHealth = 10,
    StatusEffects = 11,
    ItemText = 12,
}

/**
  * 指定如何处理 HUD 元素可见性的枚举
  * 。
 */
export enum HudVisibility {
    /**
     * @remarks
      * 指定此 HUD 元素应隐藏。
     *
     */
    Hide = 0,
    /**
     * @remarks
      * 指定此 HUD 元素应重置为其默认状态（虽然大多数 HUD 元素可见，
      * 但某些 HUD 元素可以通过玩家设置隐藏）
      * 。
     *
     */
    Reset = 1,
}

/**
  * 所有支持的不同输入按钮。与
  * {@link InputInfo.getButtonState} 通过 {@link
  * Player.inputInfo} 或通过 {@link
  * {@link WorldAfterEvents.playerButtonInput} 获取的 {@link PlayerButtonInputAfterEvent} 一起使用
 */
export enum InputButton {
    /**
     * @remarks
     * 这映射到手柄、键盘和触摸界面上的
     * '跳跃'按钮。
     *
     */
    Jump = 'Jump',
    /**
     * @remarks
     * 这映射到手柄、键盘和触摸界面上的
     * '潜行'按钮。默认情况下，在键盘上是 shift 键，
     * 在 Xbox 手柄上是 B 键。在触摸
     * 界面上，此按钮只会被按下 1 tick 或更短时间，
     * 然后即使玩家按住手指也会立即释放。
     * 从马或船上下来不会发送潜行按钮变化事件。
     *
     */
    Sneak = 'Sneak',
}

/**
  * 描述设备的输入类型。
 */
export enum InputMode {
    /**
     * @remarks
      * 手柄输入。
     *
     */
    Gamepad = 'Gamepad',
    /**
     * @remarks
      * 键盘和鼠标输入。
     *
     */
    KeyboardAndMouse = 'KeyboardAndMouse',
    /**
     * @remarks
      * 动作控制器输入。
     *
     */
    MotionController = 'MotionController',
    /**
     * @remarks
      * 触摸输入。
     *
     */
    Touch = 'Touch',
}

/**
  * 输入权限类别。由 {@link
  * PlayerInputPermissionCategoryChangeAfterEvent} 用于指定
  * 哪个类别被更改，以及 {@link
  * PlayerInputPermissions} 用于获取或设置权限。
 */
export enum InputPermissionCategory {
    /**
     * @remarks
      * 与相机移动相关的玩家输入。
     *
     */
    Camera = 1,
    /**
     * @remarks
      * 与所有玩家移动相关的玩家输入。禁用此项
      * 相当于禁用跳跃、潜行、横向移动、
      * 骑乘和解除骑乘。
     *
     */
    Movement = 2,
    /**
     * @remarks
      * 在世界中横向移动的玩家输入。在键盘上为 WASD，
      * 在手柄或触摸设备上为移动摇杆
      * 。
     *
     */
    LateralMovement = 4,
    /**
     * @remarks
      * 与潜行相关的玩家输入。这也会影响向下飞行
      * 。
     *
     */
    Sneak = 5,
    /**
     * @remarks
      * 与跳跃相关的玩家输入。这也会影响向上飞行
      * 。
     *
     */
    Jump = 6,
    /**
     * @remarks
      * 与骑乘载具相关的玩家输入。
     *
     */
    Mount = 7,
    /**
     * @remarks
      * 与解除骑乘相关的玩家输入。禁用时，
      * 玩家仍然可以通过其他方式解除骑乘，例如
      * 在马背上玩家仍然可以跳下，在船中玩家可以进入另一艘船
      * 。
     *
     */
    Dismount = 8,
    /**
     * @remarks
      * 与向前移动相关的玩家输入。
     *
     */
    MoveForward = 9,
    /**
     * @remarks
      * 与向后移动相关的玩家输入。
     *
     */
    MoveBackward = 10,
    /**
     * @remarks
      * 与向左移动相关的玩家输入。
     *
     */
    MoveLeft = 11,
    /**
     * @remarks
      * 与向右移动相关的玩家输入。
     *
     */
    MoveRight = 12,
}

/**
  * 可通过函数 ItemStack.getComponent 访问的物品组件类型。
  * 。
 */
export enum ItemComponentTypes {
    /**
     * @remarks
      * minecraft:book 组件。
     *
     */
    Book = 'minecraft:book',
    Compostable = 'minecraft:compostable',
    /**
     * @remarks
      * minecraft:cooldown 组件。
     *
     */
    Cooldown = 'minecraft:cooldown',
    /**
     * @remarks
      * minecraft:durability 组件。
     *
     */
    Durability = 'minecraft:durability',
    Dyeable = 'minecraft:dyeable',
    /**
     * @remarks
      * minecraft:enchantable 组件。
     *
     */
    Enchantable = 'minecraft:enchantable',
    /**
     * @remarks
      * minecraft:food 组件。
     *
     */
    Food = 'minecraft:food',
    Inventory = 'minecraft:inventory',
    Potion = 'minecraft:potion',
}

/**
  * 描述物品如何在容器内移动。
 */
export enum ItemLockMode {
    /**
     * @remarks
      * 该物品不能丢弃或用于合成。
     *
     */
    inventory = 'inventory',
    /**
     * @remarks
      * 该物品没有容器限制。
     *
     */
    none = 'none',
    /**
     * @remarks
      * 该物品不能从其槽位移出、丢弃或用于合成
      * 。
     *
     */
    slot = 'slot',
}

/**
  * 指定如何处理与现有液体重叠的可含水方块。
  * 。
 */
export enum LiquidSettings {
    /**
     * @remarks
      * 使可与水重叠的方块在与现有液体重叠时变为含水状态
      * 。
     *
     */
    ApplyWaterlogging = 'ApplyWaterlogging',
    /**
     * @remarks
      * 不要使任何与现有液体重叠的可含水方块变为含水
      * 。
     *
     */
    IgnoreWaterlogging = 'IgnoreWaterlogging',
}

/**
  * 表示可以放置在方块上或在世界中动态流动的液体类型
  * 。
 */
export enum LiquidType {
    /**
     * @remarks
      * 表示水作为一种液体类型。
     *
     */
    Water = 'Water',
}

/**
  * 描述设备的内存。
 */
export enum MemoryTier {
    /**
     * @remarks
      * 超低级别的最大内存为 1.5GB。
     *
     */
    SuperLow = 0,
    /**
     * @remarks
     * 低等级别的最大内存为 2GB。
     *
     */
    Low = 1,
    /**
     * @remarks
      * 中等级别的最大内存为 4GB。
     *
     */
    Mid = 2,
    /**
     * @remarks
      * 高级别的最大内存为 8GB。
     *
     */
    High = 3,
    /**
     * @remarks
      * 超高等级别的内存为 8GB 以上。
     *
     */
    SuperHigh = 4,
}

/**
  * 包含基于当前日期的不同月相的枚举
  * 。使用 world.getMoonPhase 获取当前月相
  * 。
 *
  * 月亮的满盈程度控制各种生物行为，例如
  * 沼泽生物群系中生成的史莱姆数量、
  * 骷髅和僵尸生成时携带盔甲的几率，
  * 以及蜘蛛生成时带有特定状态效果的几率
  * 。
 */
export enum MoonPhase {
    /**
     * @remarks
      * 最亮的月相。在此阶段，猫有 50% 的几率生成黑猫
      * 。
     *
     */
    FullMoon = 0,
    /**
     * @remarks
      * 满月之后的月相。
     *
     */
    WaningGibbous = 1,
    /**
     * @remarks
      * 蛾眉月之后的月相。
     *
     */
    FirstQuarter = 2,
    /**
     * @remarks
      * 下弦月之后的月相。
     *
     */
    WaningCrescent = 3,
    /**
     * @remarks
      * 最暗的月相。
     *
     */
    NewMoon = 4,
    /**
     * @remarks
      * 新月之后的月相。
     *
     */
    WaxingCrescent = 5,
    /**
     * @remarks
      * 亏凸月之后的月相。
     *
     */
    LastQuarter = 6,
    /**
     * @remarks
      * 上弦月之后的月相。
     *
     */
    WaxingGibbous = 7,
}

export enum MovementType {
    Immovable = 'Immovable',
    Popped = 'Popped',
    Push = 'Push',
    PushPull = 'PushPull',
}

/**
  * 描述命名空间名称错误抛出原因的枚举。
  * 。
 */
export enum NamespaceNameErrorReason {
    /**
     * @remarks
      * 使用了受限命名空间作为命名空间
     *
     */
    DisallowedNamespace = 'DisallowedNamespace',
    /**
     * @remarks
      * 在需要命名空间时缺少命名空间
     *
     */
    NoNamespace = 'NoNamespace',
}

/**
  * 用于指定显示目标及其参与者列表的排序顺序
  * 。
 */
export enum ObjectiveSortOrder {
    /**
     * @remarks
      * 目标参与者列表按升序显示（例如
      * A-Z）。
     *
     */
    Ascending = 0,
    /**
     * @remarks
      * 目标参与者列表按降序显示（例如
      * Z-A）。
     *
     */
    Descending = 1,
}

/**
  * 包含用于 EntityColorComponent 和 EntityColor2Component 的颜色的枚举
  * 。
 */
export enum PaletteColor {
    /**
     * @remarks
      * 十六进制颜色 #f0f0f0
     *
     */
    White = 0,
    /**
     * @remarks
      * 十六进制颜色 #F9801D
     *
     */
    Orange = 1,
    /**
     * @remarks
      * 十六进制颜色 #C74EBD
     *
     */
    Magenta = 2,
    /**
     * @remarks
      * 十六进制颜色 #3AB3DA
     *
     */
    LightBlue = 3,
    /**
     * @remarks
      * 十六进制颜色 #FED83D
     *
     */
    Yellow = 4,
    /**
     * @remarks
      * 十六进制颜色 #80C71F
     *
     */
    Lime = 5,
    /**
     * @remarks
      * 十六进制颜色 #F38BAA
     *
     */
    Pink = 6,
    /**
     * @remarks
      * 十六进制颜色 #474F52
     *
     */
    Gray = 7,
    /**
     * @remarks
      * 十六进制颜色 #9D9D97
     *
     */
    Silver = 8,
    /**
     * @remarks
      * 十六进制颜色 #169C9C
     *
     */
    Cyan = 9,
    /**
     * @remarks
      * 十六进制颜色 #8932B8
     *
     */
    Purple = 10,
    /**
     * @remarks
      * 十六进制颜色 #3C44AA
     *
     */
    Blue = 11,
    /**
     * @remarks
      * 十六进制颜色 #835432
     *
     */
    Brown = 12,
    /**
     * @remarks
      * 十六进制颜色 #5E7C16
     *
     */
    Green = 13,
    /**
     * @remarks
      * 十六进制颜色 #B02E26
     *
     */
    Red = 14,
    /**
     * @remarks
      * 十六进制颜色 #1D1D21
     *
     */
    Black = 15,
}

/**
  * 描述设备是什么类型的平台。
 */
export enum PlatformType {
    /**
     * @remarks
      * 专用游戏设备。
     *
     */
    Console = 'Console',
    /**
     * @remarks
      * 个人计算机 (PC)。
     *
     */
    Desktop = 'Desktop',
    /**
     * @remarks
     * 手持设备，如智能手机或平板电脑。
     *
     */
    Mobile = 'Mobile',
}

/**
  * 指定玩家物品栏类型。
 */
export enum PlayerInventoryType {
    /**
     * @remarks
      * 热键栏背包。
     *
     */
    Hotbar = 'Hotbar',
    /**
     * @remarks
      * 主背包。
     *
     */
    Inventory = 'Inventory',
}

/**
  * 玩家权限级别。
 */
export enum PlayerPermissionLevel {
    /**
     * @remarks
      * 访客只能观察世界，不能与之交互。
     *
     */
    Visitor = 0,
    /**
     * @remarks
      * 成员可以建造和挖掘、攻击玩家和生物，并
      * 与物品和实体交互。
     *
     */
    Member = 1,
    /**
     * @remarks
      * 操作员可以传送和使用命令，此外还可以执行
      * 成员能做的一切。
     *
     */
    Operator = 2,
    Custom = 3,
}

/**
  * 包含记分板的目标和参与者。
 */
export enum ScoreboardIdentityType {
    /**
     * @remarks
      * 此记分板参与者与实体关联。
     *
     */
    Entity = 'Entity',
    /**
     * @remarks
      * 此记分板参与者与伪玩家实体关联——通常用于
      * 将分数存储为数据或抽象进度
      * 。
     *
     */
    FakePlayer = 'FakePlayer',
    /**
     * @remarks
      * 此记分板参与者与玩家关联。
     *
     */
    Player = 'Player',
}

/**
  * 描述脚本事件的来源。
 */
export enum ScriptEventSource {
    /**
     * @remarks
      * 脚本事件来源于方块，例如命令
     * Block.
     *
     */
    Block = 'Block',
    /**
     * @remarks
      * 脚本事件来源于实体，例如玩家、
      * 命令方块矿车或动画控制器。
     *
     */
    Entity = 'Entity',
    /**
     * @remarks
      * 脚本事件来源于NPC对话。
     *
     */
    NPCDialogue = 'NPCDialogue',
    /**
     * @remarks
      * 脚本事件来源于服务器，例如来自
      * runCommand API 调用或专用服务器控制台。
     *
     */
    Server = 'Server',
}

/**
  * 表示告示牌的面。
 */
export enum SignSide {
    /**
     * @remarks
      * 告示牌的背面。
     *
     */
    Back = 'Back',
    /**
     * @remarks
      * 告示牌的正面。
     *
     */
    Front = 'Front',
}

export enum StickyType {
    None = 'None',
    Same = 'Same',
}

/**
  * 指定结构放置时结构方块应如何动画化。
  * 方式。
 */
export enum StructureAnimationMode {
    /**
     * @remarks
      * 方块将被随机逐个放置。使用
     * @minecraft/server.StructurePlaceOptions.animationSeconds to
      * 控制所有方块放置所需的时间。
     *
     */
    Blocks = 'Blocks',
    /**
     * @remarks
      * 方块将从底部到顶部逐层放置。
      * 使用
     * @minecraft/server.StructurePlaceOptions.animationSeconds to
      * 控制所有方块放置所需的时间。
     *
     */
    Layers = 'Layers',
    /**
     * @remarks
      * 所有方块将立即放置。
     *
     */
    None = 'None',
}

/**
  * 指定放置结构时如何进行镜像。
 */
export enum StructureMirrorAxis {
    /**
     * @remarks
      * 无镜像。
     *
     */
    None = 'None',
    /**
     * @remarks
      * 结构沿X轴镜像。
     *
     */
    X = 'X',
    /**
     * @remarks
      * 结构沿X轴和Z轴同时镜像。
     *
     */
    XZ = 'XZ',
    /**
     * @remarks
      * 结构沿Z轴镜像。
     *
     */
    Z = 'Z',
}

/**
  * 描述结构放置旋转的枚举。
 */
export enum StructureRotation {
    /**
     * @remarks
      * 无旋转。
     *
     */
    None = 'None',
    /**
     * @remarks
      * 180度旋转。
     *
     */
    Rotate180 = 'Rotate180',
    /**
     * @remarks
      * 270度旋转。
     *
     */
    Rotate270 = 'Rotate270',
    /**
     * @remarks
      * 90度旋转。
     *
     */
    Rotate90 = 'Rotate90',
}

/**
  * 指定结构的保存方式。
 */
export enum StructureSaveMode {
    /**
     * @remarks
      * 结构将临时保存到内存中。该
      * 结构将持续存在，直到世界关闭。
     *
     */
    Memory = 'Memory',
    /**
     * @remarks
      * 结构将保存到世界文件中，并在
      * 世界加载之间持续存在。已保存的结构可以通过
      * @minecraft/server.StructureManager.delete 从世界中移除。
     *
     */
    World = 'World',
}

/**
  * 抛出 {@link
 * @minecraft/server.TickingAreaError} 时抛出。
 */
export enum TickingAreaErrorReason {
    /**
     * @remarks
      * 添加的常驻区块区域使用了已存在的标识符。
     *
     */
    IdentifierAlreadyExists = 'IdentifierAlreadyExists',
    /**
     * @remarks
     * 添加此常驻区块区域导致常驻区块区域数量超过了
     * {@link TickingAreaManager.maxChunkCount} 指定的限制。
     *
     */
    OverChunkLimit = 'OverChunkLimit',
    /**
     * @remarks
     * 常驻区块区域的长度或宽度超过了 255 个区块的限制。
     *
     */
    SideLengthExceeded = 'SideLengthExceeded',
    /**
     * @remarks
      * 尝试移除使用了未在 {@link TickingAreaManager} 中注册的
      * 标识符的常驻区块区域。
     *
     */
    UnknownIdentifier = 'UnknownIdentifier',
}

/**
  * 提供 Minecraft 一天中常见时段的数值。
  * 数值。
 */
export enum TimeOfDay {
    /**
     * @remarks
      * 将时间设置为一天的开始，即 Minecraft 中
      * 时间 1,000（相当于早上 7 点）。
     *
     */
    Day = 1000,
    /**
     * @remarks
      * 将时间设置为中午，即 Minecraft 中
      * 时间 6,000。
     *
     */
    Noon = 6000,
    /**
     * @remarks
      * 将时间设置为日落，即 Minecraft 中
      * 时间 12,000（相当于下午 6 点）。
     *
     */
    Sunset = 12000,
    /**
     * @remarks
      * 将时间设置为夜晚，即 Minecraft 中
      * 时间 13,000（相当于晚上 7 点）。
     *
     */
    Night = 13000,
    /**
     * @remarks
      * 将时间设置为午夜，即 Minecraft 中
      * 时间 18,000（相当于凌晨 12 点）。
     *
     */
    Midnight = 18000,
    /**
     * @remarks
      * 将时间设置为日出，即 Minecraft 中
      * 时间 23,000（相当于早上 5 点）。
     *
     */
    Sunrise = 23000,
}

/**
  * 应用于方块或方块部分的色调逻辑。颜色
  * 可能会根据世界位置的不同而变化，因为
  * 生物群系通常会影响最终的色调。
 */
export enum TintMethod {
    /**
     * @remarks
      * 指定白桦树叶的色调方法。
     *
     */
    BirchFoliage = 'BirchFoliage',
    /**
     * @remarks
      * 指定默认树叶的色调方法。
     *
     */
    DefaultFoliage = 'DefaultFoliage',
    /**
     * @remarks
      * 指定干燥树叶的色调方法。
     *
     */
    DryFoliage = 'DryFoliage',
    /**
     * @remarks
      * 指定常绿树叶的色调方法。
     *
     */
    EvergreenFoliage = 'EvergreenFoliage',
    /**
     * @remarks
      * 指定草的色调方法。
     *
     */
    Grass = 'Grass',
    /**
     * @remarks
      * 指定无色调方法，结果为白色色调。
     *
     */
    None = 'None',
    /**
     * @remarks
      * 指定水的色调方法。
     *
     */
    Water = 'Water',
}

/**
  * 用于指定世界中的天气
  * 类型。
 */
export enum WeatherType {
    /**
     * @remarks
      * 指定晴朗的天气。
     *
     */
    Clear = 'Clear',
    /**
     * @remarks
      * 指定下雨的天气。
     *
     */
    Rain = 'Rain',
    /**
     * @remarks
      * 指定雷雨的天气。
     *
     */
    Thunder = 'Thunder',
}

export type BlockComponentReturnType<T extends string> = T extends keyof BlockComponentTypeMap
    ? BlockComponentTypeMap[T]
    : BlockCustomComponentInstance;

export type BlockComponentTypeMap = {
    fluid_container: BlockFluidContainerComponent;
    inventory: BlockInventoryComponent;
    map_color: BlockMapColorComponent;
    'minecraft:fluid_container': BlockFluidContainerComponent;
    'minecraft:inventory': BlockInventoryComponent;
    'minecraft:map_color': BlockMapColorComponent;
    'minecraft:movable': BlockMovableComponent;
    'minecraft:piston': BlockPistonComponent;
    'minecraft:precipitation_interactions': BlockPrecipitationInteractionsComponent;
    'minecraft:record_player': BlockRecordPlayerComponent;
    'minecraft:redstone_producer': BlockRedstoneProducerComponent;
    'minecraft:sign': BlockSignComponent;
    movable: BlockMovableComponent;
    piston: BlockPistonComponent;
    precipitation_interactions: BlockPrecipitationInteractionsComponent;
    record_player: BlockRecordPlayerComponent;
    redstone_producer: BlockRedstoneProducerComponent;
    sign: BlockSignComponent;
};

/**
  * 由 {@link BlockPermutation} 的 matches 和
  * resolve 函数使用的类型别名，用于将方块状态参数类型缩小到
  * 由 {@link
 * @minecraft/vanilla-data.BlockStateMapping}.
 */
export type BlockStateArg<T> = T extends `${minecraftvanilladata.MinecraftBlockTypes}`
    ? T extends keyof minecraftvanilladata.BlockStateMapping
        ? minecraftvanilladata.BlockStateMapping[T]
        : never
    : Record<string, boolean | number | string>;

export type EntityComponentReturnType<T extends string> = T extends keyof EntityComponentTypeMap
    ? EntityComponentTypeMap[T]
    : EntityComponent;

export type EntityComponentTypeMap = {
    addrider: EntityAddRiderComponent;
    ageable: EntityAgeableComponent;
    breathable: EntityBreathableComponent;
    can_climb: EntityCanClimbComponent;
    can_fly: EntityCanFlyComponent;
    can_power_jump: EntityCanPowerJumpComponent;
    color: EntityColorComponent;
    color2: EntityColor2Component;
    cursor_inventory: PlayerCursorInventoryComponent;
    equippable: EntityEquippableComponent;
    fire_immune: EntityFireImmuneComponent;
    floats_in_liquid: EntityFloatsInLiquidComponent;
    flying_speed: EntityFlyingSpeedComponent;
    friction_modifier: EntityFrictionModifierComponent;
    healable: EntityHealableComponent;
    health: EntityHealthComponent;
    inventory: EntityInventoryComponent;
    is_baby: EntityIsBabyComponent;
    is_charged: EntityIsChargedComponent;
    is_chested: EntityIsChestedComponent;
    is_dyeable: EntityIsDyeableComponent;
    is_hidden_when_invisible: EntityIsHiddenWhenInvisibleComponent;
    is_ignited: EntityIsIgnitedComponent;
    is_illager_captain: EntityIsIllagerCaptainComponent;
    is_saddled: EntityIsSaddledComponent;
    is_shaking: EntityIsShakingComponent;
    is_sheared: EntityIsShearedComponent;
    is_stackable: EntityIsStackableComponent;
    is_stunned: EntityIsStunnedComponent;
    is_tamed: EntityIsTamedComponent;
    item: EntityItemComponent;
    lava_movement: EntityLavaMovementComponent;
    leashable: EntityLeashableComponent;
    mark_variant: EntityMarkVariantComponent;
    'minecraft:addrider': EntityAddRiderComponent;
    'minecraft:ageable': EntityAgeableComponent;
    'minecraft:breathable': EntityBreathableComponent;
    'minecraft:can_climb': EntityCanClimbComponent;
    'minecraft:can_fly': EntityCanFlyComponent;
    'minecraft:can_power_jump': EntityCanPowerJumpComponent;
    'minecraft:color': EntityColorComponent;
    'minecraft:color2': EntityColor2Component;
    'minecraft:cursor_inventory': PlayerCursorInventoryComponent;
    'minecraft:equippable': EntityEquippableComponent;
    'minecraft:fire_immune': EntityFireImmuneComponent;
    'minecraft:floats_in_liquid': EntityFloatsInLiquidComponent;
    'minecraft:flying_speed': EntityFlyingSpeedComponent;
    'minecraft:friction_modifier': EntityFrictionModifierComponent;
    'minecraft:healable': EntityHealableComponent;
    'minecraft:health': EntityHealthComponent;
    'minecraft:inventory': EntityInventoryComponent;
    'minecraft:is_baby': EntityIsBabyComponent;
    'minecraft:is_charged': EntityIsChargedComponent;
    'minecraft:is_chested': EntityIsChestedComponent;
    'minecraft:is_dyeable': EntityIsDyeableComponent;
    'minecraft:is_hidden_when_invisible': EntityIsHiddenWhenInvisibleComponent;
    'minecraft:is_ignited': EntityIsIgnitedComponent;
    'minecraft:is_illager_captain': EntityIsIllagerCaptainComponent;
    'minecraft:is_saddled': EntityIsSaddledComponent;
    'minecraft:is_shaking': EntityIsShakingComponent;
    'minecraft:is_sheared': EntityIsShearedComponent;
    'minecraft:is_stackable': EntityIsStackableComponent;
    'minecraft:is_stunned': EntityIsStunnedComponent;
    'minecraft:is_tamed': EntityIsTamedComponent;
    'minecraft:item': EntityItemComponent;
    'minecraft:lava_movement': EntityLavaMovementComponent;
    'minecraft:leashable': EntityLeashableComponent;
    'minecraft:mark_variant': EntityMarkVariantComponent;
    'minecraft:movement': EntityMovementComponent;
    'minecraft:movement.amphibious': EntityMovementAmphibiousComponent;
    'minecraft:movement.basic': EntityMovementBasicComponent;
    'minecraft:movement.fly': EntityMovementFlyComponent;
    'minecraft:movement.generic': EntityMovementGenericComponent;
    'minecraft:movement.glide': EntityMovementGlideComponent;
    'minecraft:movement.hover': EntityMovementHoverComponent;
    'minecraft:movement.jump': EntityMovementJumpComponent;
    'minecraft:movement.skip': EntityMovementSkipComponent;
    'minecraft:movement.sway': EntityMovementSwayComponent;
    'minecraft:navigation.climb': EntityNavigationClimbComponent;
    'minecraft:navigation.float': EntityNavigationFloatComponent;
    'minecraft:navigation.fly': EntityNavigationFlyComponent;
    'minecraft:navigation.generic': EntityNavigationGenericComponent;
    'minecraft:navigation.hover': EntityNavigationHoverComponent;
    'minecraft:navigation.walk': EntityNavigationWalkComponent;
    'minecraft:onfire': EntityOnFireComponent;
    'minecraft:player.exhaustion': EntityExhaustionComponent;
    'minecraft:player.hunger': EntityHungerComponent;
    'minecraft:player.saturation': EntitySaturationComponent;
    'minecraft:projectile': EntityProjectileComponent;
    'minecraft:push_through': EntityPushThroughComponent;
    'minecraft:rideable': EntityRideableComponent;
    'minecraft:riding': EntityRidingComponent;
    'minecraft:scale': EntityScaleComponent;
    'minecraft:skin_id': EntitySkinIdComponent;
    'minecraft:strength': EntityStrengthComponent;
    'minecraft:tameable': EntityTameableComponent;
    'minecraft:tamemount': EntityTameMountComponent;
    'minecraft:type_family': EntityTypeFamilyComponent;
    'minecraft:underwater_movement': EntityUnderwaterMovementComponent;
    'minecraft:variant': EntityVariantComponent;
    'minecraft:wants_jockey': EntityWantsJockeyComponent;
    movement: EntityMovementComponent;
    'movement.amphibious': EntityMovementAmphibiousComponent;
    'movement.basic': EntityMovementBasicComponent;
    'movement.fly': EntityMovementFlyComponent;
    'movement.generic': EntityMovementGenericComponent;
    'movement.glide': EntityMovementGlideComponent;
    'movement.hover': EntityMovementHoverComponent;
    'movement.jump': EntityMovementJumpComponent;
    'movement.skip': EntityMovementSkipComponent;
    'movement.sway': EntityMovementSwayComponent;
    'navigation.climb': EntityNavigationClimbComponent;
    'navigation.float': EntityNavigationFloatComponent;
    'navigation.fly': EntityNavigationFlyComponent;
    'navigation.generic': EntityNavigationGenericComponent;
    'navigation.hover': EntityNavigationHoverComponent;
    'navigation.walk': EntityNavigationWalkComponent;
    onfire: EntityOnFireComponent;
    'player.exhaustion': EntityExhaustionComponent;
    'player.hunger': EntityHungerComponent;
    'player.saturation': EntitySaturationComponent;
    projectile: EntityProjectileComponent;
    push_through: EntityPushThroughComponent;
    rideable: EntityRideableComponent;
    riding: EntityRidingComponent;
    scale: EntityScaleComponent;
    skin_id: EntitySkinIdComponent;
    strength: EntityStrengthComponent;
    tameable: EntityTameableComponent;
    tamemount: EntityTameMountComponent;
    type_family: EntityTypeFamilyComponent;
    underwater_movement: EntityUnderwaterMovementComponent;
    variant: EntityVariantComponent;
    wants_jockey: EntityWantsJockeyComponent;
};

export type ItemComponentReturnType<T extends string> = T extends keyof ItemComponentTypeMap
    ? ItemComponentTypeMap[T]
    : ItemCustomComponentInstance;

export type ItemComponentTypeMap = {
    book: ItemBookComponent;
    compostable: ItemCompostableComponent;
    cooldown: ItemCooldownComponent;
    durability: ItemDurabilityComponent;
    dyeable: ItemDyeableComponent;
    enchantable: ItemEnchantableComponent;
    food: ItemFoodComponent;
    inventory: ItemInventoryComponent;
    'minecraft:book': ItemBookComponent;
    'minecraft:compostable': ItemCompostableComponent;
    'minecraft:cooldown': ItemCooldownComponent;
    'minecraft:durability': ItemDurabilityComponent;
    'minecraft:dyeable': ItemDyeableComponent;
    'minecraft:enchantable': ItemEnchantableComponent;
    'minecraft:food': ItemFoodComponent;
    'minecraft:inventory': ItemInventoryComponent;
    'minecraft:potion': ItemPotionComponent;
    potion: ItemPotionComponent;
};

/**
  * 描述一种生物群系类型。
 */
export class BiomeType {
    private constructor();
    /**
     * @remarks
      * 生物群系类型的标识符。
     *
     */
    readonly id: string;
}

/**
  * 表示维度中的一个方块。方块代表
  * 维度中唯一的 X、Y、Z 坐标，并获取/设置该位置的方块
 * 状态。此类型在
  * 1.17.10.21 版本中进行了重大更新。
 */
export class Block {
    private constructor();
    /**
     * @remarks
      * 返回该方块所在的维度。
     *
     */
    readonly dimension: Dimension;
    /**
     * @remarks
      * 如果此方块是空气方块（即空

      * 空间），则返回 true。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    readonly isAir: boolean;
    /**
     * @remarks
      * 如果此方块是液体方块则返回 true - （例如，

      * 水和熔岩方块是液体，而空气方块
      * 和石头方块则不是。含水方块不是
      * 液体方块）。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    readonly isLiquid: boolean;
    /**
     * @remarks
      * 如果此方块引用仍然有效，则返回 true

      * （例如，如果方块被卸载，对该方块的
      * 引用将不再有效）。
     *
     */
    readonly isValid: boolean;
    /**
     * @remarks
      * 返回或设置此方块是否含水。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    readonly isWaterlogged: boolean;
    /**
     * @remarks
      * 用于 .lang 文件中此方块名称本地化的
     * 文件。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    readonly localizationKey: string;
    /**
     * @remarks
      * 指定方块的坐标。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly location: Vector3;
    /**
     * @remarks
      * 描述方块的额外方块配置
      * 。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    readonly permutation: BlockPermutation;
    /**
     * @remarks
      * 获取方块的类型。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    readonly 'type': BlockType;
    /**
     * @remarks
      * 此方块的方块类型标识符。警告：
      * 原版方块名称在未来的版本中可能会更改，请尝试
      * 使用 'Block.matches' 进行方块比较。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    readonly typeId: string;
    /**
     * @remarks
      * 方块的 X 坐标。
     *
     */
    readonly x: number;
    /**
     * @remarks
      * 方块的 Y 坐标。
     *
     */
    readonly y: number;
    /**
     * @remarks
      * 方块的 Z 坐标。
     *
     */
    readonly z: number;
    /**
     * @remarks
     * 返回此方块上方的 {@link Block}（Y 轴正方向）。
     *
     * @param steps
      * 向上移动的步数后返回。
     * Defaults to: 1
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    above(steps?: number): Block | undefined;
    /**
     * @remarks
     * 返回此方块下方的 {@link Block}（Y 轴负方向）。
     *
     * @param steps
      * 向下移动的步数后返回。
     * Defaults to: 1
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    below(steps?: number): Block | undefined;
    /**
     * @remarks
     * 返回此方块在 X 轴和 Z 轴中心位置的 {@link Vector3}。
     *
     */
    bottomCenter(): Vector3;
    /**
     * @remarks
      * 返回此方块在接触液体时是否会被

      * 移除。
     *
     * @param liquidType
      * 应调用此函数的液体类型。
     * @returns
      * 此方块在接触液体时是否会被移除。
     * @throws 此函数可能会抛出错误。
     *
     * {@link Error}
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    canBeDestroyedByLiquidSpread(liquidType: LiquidType): boolean;
    /**
     * @remarks
      * 返回此方块是否可以在其上放置液体，

      * 即被水淹没。
     *
     * @param liquidType
      * 应调用此函数的液体类型。
     * @returns
     * 此方块是否可以在其上放置液体。
     * @throws 此函数可能会抛出错误。
     *
     * {@link Error}
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    canContainLiquid(liquidType: LiquidType): boolean;
    /**
     * @remarks
     * 返回此方块在 X、Y 和 Z 轴中心的 {@link Vector3}。
     *
     */
    center(): Vector3;
    /**
     * @remarks
     * 返回此方块东侧的 {@link Block}（X 轴正方向）。
     *
     * @param steps
      * 向东移动的步数后返回。
     * Defaults to: 1
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    east(steps?: number): Block | undefined;
    /**
     * @remarks
     * 获取方块的组件（表示附加功能）——例如，箱子的库存组件
     *
     * 。
     *
     * @param componentId
      * 组件的标识符（例如
      * 'minecraft:inventory'）。如果未指定命名空间前缀，
      * 则假定为 'minecraft:'。可用的组件 ID 包括
      * {@link BlockComponentTypes} 枚举中的 ID 以及使用
      * {@link BlockComponentRegistry} 注册的自定义组件 ID。
     * @returns
      * 如果组件存在于方块上则返回该组件，否则
      * undefined。
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    getComponent<T extends string>(componentId: T): BlockComponentReturnType<T> | undefined;
    /**
     * @remarks
     * 返回此方块上存在的所有脚本组件
     * 。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    getComponents(): BlockComponent[];
    /**
     * @remarks
     * 基于此方块创建一个可用于 Container/ContainerSlot API 的原型物品堆叠
     * 。
     *
     * @param amount
      * 要放入物品堆叠中的此方块实例
      * 堆叠。
     * Defaults to: 1
     * 范围：[1, 255]
     * @param withData
      * 是否包含物品堆叠的额外数据
      * 方面。
     * 默认值：false
     * @returns
      * 一个包含指定数量和数据的物品堆叠。
      * 如果方块类型不兼容则返回 undefined。
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    getItemStack(amount?: number, withData?: boolean): ItemStack | undefined;
    /**
     * @remarks
     * 返回照射在某个方块上的总亮度级别
     * 。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @returns
     * 方块上的亮度级别。
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link LocationInUnloadedChunkError}
     */
    getLightLevel(): number;
    /**
     * @remarks
     * 返回此方块的红石净功率
     * 。
     *
     * @returns
     * 如果红石功率不适用于此方块则返回 undefined
     * 。
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    getRedstonePower(): number | undefined;
    /**
     * @remarks
     * 返回从天空照射到某个方块上的亮度级别
     * 。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @returns
     * 方块上的亮度级别。
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link LocationInUnloadedChunkError}
     */
    getSkyLightLevel(): number;
    /**
     * @remarks
     * 返回方块的一组标签
     * 。
     *
     * @returns
      * 方块拥有的标签列表。
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    getTags(): string[];
    /**
     * @remarks
     * 如果指定的组件存在于该方块上则返回 true
     * 。

      * 。
     *
     * @param componentId
      * 组件的标识符（例如
     * 'minecraft:inventory'）。如果未指定命名空间前缀
     * 未指定命名空间，则默认为 'minecraft:'。
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    hasComponent(componentId: string): boolean;
    /**
     * @remarks
     * 检查此方块的置换是否具有特定标签
     * 。
     *
     * @param tag
      * 要检查的标签。
     * @returns
      * 如果此方块的置换具有该标签则返回 `true`，
      * 否则返回 `false`。
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     * @example checkBlockTags.ts
     * ```typescript
     * import { DimensionLocation } from "@minecraft/server";
     *
     * function checkBlockTags(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
     *   // Fetch the block
     *   const block = targetLocation.dimension.getBlock(targetLocation);
     *
     *   // check that the block is loaded
     *   if (block) {
     *     log(`Block is dirt: ${block.hasTag("dirt")}`);
     *     log(`Block is wood: ${block.hasTag("wood")}`);
     *     log(`Block is stone: ${block.hasTag("stone")}`);
     *   }
     * }
     * ```
     */
    hasTag(tag: string): boolean;
    /**
     * @remarks
      * 返回此方块是否阻止液体流动。

     *
     * @param liquidType
      * 应调用此函数的液体类型。
     * @returns
     * 此方块是否阻止液体流动。
     * @throws 此函数可能会抛出错误。
     *
     * {@link Error}
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    isLiquidBlocking(liquidType: LiquidType): boolean;
    /**
     * @remarks
     * 返回液体是否可以从提供的方向流入方块，
     * 或在使用桶放置液体时从提供的方向流出。
     *
     * @param liquidType
      * 应调用此函数的液体类型。
     * @returns
     * 液体是否可以从提供的方向流入方块，
     * 或在使用桶放置液体时从提供的方向流出
     * @throws 此函数可能会抛出错误。
     *
     * {@link Error}
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    liquidCanFlowFromDirection(liquidType: LiquidType, flowDirection: Direction): boolean;
    /**
     * @remarks
      * 返回此方块在接触液体时是否会被移除并生成其

      * 物品。
     *
     * @param liquidType
      * 应调用此函数的液体类型。
     * @returns
     * 此方块在接触液体时是否会被移除并生成其物品。
     * @throws 此函数可能会抛出错误。
     *
     * {@link Error}
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    liquidSpreadCausesSpawn(liquidType: LiquidType): boolean;
    /**
     * @remarks
     * 测试此方块是否匹配特定条件。
     *
     * @param blockName
      * 用于匹配此 API 的方块类型标识符。
     * @param states
      * 用于测试此方块的可选方块状态集合。
     * @returns
     * 如果方块匹配指定条件则返回 true。

     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    matches(blockName: string, states?: Record<string, boolean | number | string>): boolean;
    /**
     * @remarks
     * 返回此方块北侧的 {@link Block}（Z 轴负方向）。
     *
     * @param steps
      * 向北移动的步数后返回。
     * Defaults to: 1
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    north(steps?: number): Block | undefined;
    /**
     * @remarks
     * 返回此方块偏移相对向量处的方块。
     *
     * @param offset
      * 偏移向量。例如，偏移量 0, 1, 0 将
      * 返回当前方块上方的方块。
     * @returns
      * 指定偏移处的方块，如果无法获取该方块
      * （例如，该方块及其所在的区块尚未加载），
      * 则返回 undefined。
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    offset(offset: Vector3): Block | undefined;
    /**
     * @remarks
     * 将维度中的方块设置为指定置换的状态。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param permutation
      * 包含方块一组属性状态的置换
     * Block.
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    setPermutation(permutation: BlockPermutation): void;
    /**
     * @remarks
     * 设置方块的类型。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param blockType
      * 要应用的方块类型标识符——例如，
      * minecraft:powered_repeater。
     * @throws 此函数可能会抛出错误。
     *
     * {@link Error}
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    setType(blockType: BlockType | string): void;
    /**
     * @remarks
     * 设置此方块是否具有含水状态——例如，楼梯是否浸没在水中。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param isWaterlogged
      * 如果方块内部应有水，则为 true。
     * @throws 此函数可能会抛出错误。
     *
     * {@link Error}
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    setWaterlogged(isWaterlogged: boolean): void;
    /**
     * @remarks
     * 返回此方块南侧的 {@link Block}（Z 轴正方向）。
     *
     * @param steps
      * 向南移动的步数后返回。
     * Defaults to: 1
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    south(steps?: number): Block | undefined;
    /**
     * @remarks
     * 返回此方块西侧的 {@link Block}（X 轴负方向）。
     *
     * @param steps
      * 向西移动的步数后返回。
     * Defaults to: 1
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    west(steps?: number): Block | undefined;
}

/**
  * 与方块关联的组件的基础类型。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockComponent extends Component {
    private constructor();
    /**
     * @remarks
      * 此组件所属的方块实例。
     *
     */
    readonly block: Block;
}

/**
  * 包含关于特定方块被
  * 破坏的信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockComponentBlockBreakEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
      * 造成破坏的方块。
     *
     */
    readonly blockDestructionSource?: Block;
    /**
     * @remarks
      * 返回此方块在破坏前
      * 的置换信息。
     *
     */
    readonly brokenBlockPermutation: BlockPermutation;
    /**
     * @remarks
      * 造成破坏的参与者。
     *
     */
    readonly entitySource?: Entity;
}

/**
  * 包含关于实体向世界中的此方块发送事件的信息。
  * 发送事件的信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockComponentEntityEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
      * 返回接收事件的方块的
      * 置换信息。
     *
     */
    readonly blockPermutation: BlockPermutation;
    /**
     * @remarks
      * 发送事件的实体。
     *
     */
    readonly entitySource: Entity;
    /**
     * @remarks
      * 实体触发的事件名称。
     *
     */
    readonly name: string;
}

/**
  * 包含关于实体跌落到特定方块上的信息。
  * 特定方块的事件的信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockComponentEntityFallOnEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
      * 跌落到方块上的实体。
     *
     */
    readonly entity?: Entity;
    /**
     * @remarks
      * 实体跌落到此方块上的距离。
     *
     */
    readonly fallDistance: number;
}

/**
  * 包含关于特定方块被
  * 放置的信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockComponentOnPlaceEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
      * 在此位置被替换的上一个方块。
     *
     */
    readonly previousBlock: BlockPermutation;
}

/**
  * 包含关于特定方块被玩家
  * 破坏的信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockComponentPlayerBreakEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
      * 返回此方块在破坏前
      * 的置换信息。
     *
     */
    readonly brokenBlockPermutation: BlockPermutation;
    /**
     * @remarks
      * 破坏此方块的玩家。
     *
     */
    readonly player?: Player;
}

/**
  * 包含关于特定方块被
  * 交互的信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockComponentPlayerInteractEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
      * 被交互的方块面。
     *
     */
    readonly face: Direction;
    /**
     * @remarks
      * 相对于方块底部西北角的交互位置
      * 。
     *
     */
    readonly faceLocation?: Vector3;
    /**
     * @remarks
      * 与此方块交互的玩家。
     *
     */
    readonly player?: Player;
}

/**
  * 包含关于玩家放置方块前的事件
  * 的信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockComponentPlayerPlaceBeforeEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
      * 如果设置为 true，则取消方块放置事件。
     *
     */
    cancel: boolean;
    /**
     * @remarks
      * 被放置的方块面。
     *
     */
    readonly face: Direction;
    /**
     * @remarks
      * 如果事件未被取消则将放置的方块置换。
      * 如果设置为不同的方块置换，则
      * 将放置该置换。
     *
     */
    permutationToPlace: BlockPermutation;
    /**
     * @remarks
      * 正在放置此方块的玩家。
     *
     */
    readonly player?: Player;
}

/**
  * 包含关于特定方块随机刻更新的信息。
  * 刻更新的信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockComponentRandomTickEvent extends BlockEvent {
    private constructor();
}

/**
  * 包含关于特定方块红石更新事件的信息。
  * 更新事件的信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockComponentRedstoneUpdateEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
      * 通过此方块的红石信号强度。该强度
      * 保证大于等于方块
      * 'minecraft:redstone_consumer' 组件的 `min_power`。
     *
     */
    readonly powerLevel: number;
    /**
     * @remarks
      * 来自上一个刻通过此方块的红石信号强度。
      * 该强度保证大于等于
      * 方块 'minecraft:redstone_consumer' 组件的 `min_power`
      * 组件，则返回错误。
     *
     */
    readonly previousPowerLevel: number;
}

export class BlockComponentRegistry {
    private constructor();
    /**
     * @remarks
     * 此函数可以在早期执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link BlockCustomComponentAlreadyRegisteredError}
     *
     * {@link BlockCustomComponentReloadNewComponentError}
     *
     * {@link BlockCustomComponentReloadNewEventError}
     *
     * {@link BlockCustomComponentReloadVersionError}
     *
     * {@link CustomComponentInvalidRegistryError}
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link NamespaceNameError}
     */
    registerCustomComponent(name: string, customComponent: BlockCustomComponent): void;
}

/**
  * 包含关于实体从特定方块上走下的信息。
  * 特定方块的事件的信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockComponentStepOffEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
      * 从方块上走下的实体。
     *
     */
    readonly entity?: Entity;
}

/**
  * 包含关于实体走上特定方块的信息。
  * 特定方块的事件的信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockComponentStepOnEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
      * 走上方块的实体。
     *
     */
    readonly entity?: Entity;
}

/**
  * 包含关于特定方块刻更新的信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockComponentTickEvent extends BlockEvent {
    private constructor();
}

/**
  * 方块上自定义组件的实例。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockCustomComponentInstance extends BlockComponent {
    private constructor();
    readonly customComponentParameters: CustomComponentParameters;
}

/**
  * 包含关于影响特定方块的事件的信息。
  * 特定方块的事件的信息。
 */
export class BlockEvent {
    private constructor();
    /**
     * @remarks
      * 事件位置当前世界中的方块。
     *
     */
    readonly block: Block;
    /**
     * @remarks
      * 包含事件主体的方块的
      * 维度。
     *
     */
    readonly dimension: Dimension;
}

/**
  * 包含关于已发生爆炸的信息。
  * 爆炸的信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockExplodeAfterEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
      * 已爆炸方块的描述。
     *
     */
    readonly explodedBlockPermutation: BlockPermutation;
    /**
     * @remarks
      * 爆炸的可选来源。
     *
     */
    readonly source?: Entity;
}

/**
  * 管理与爆炸发生影响单个方块时相关的回调。
  * 不再调用该回调。
 */
export class BlockExplodeAfterEventSignal {
    private constructor();
    /**
     * @remarks
      * 添加一个回调，当爆炸发生影响单个方块时
      * 不再调用该回调。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: BlockExplodeAfterEvent) => void): (arg0: BlockExplodeAfterEvent) => void;
    /**
     * @remarks
      * 移除一个回调，当爆炸发生影响单个方块时
      * 不再调用该回调。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: BlockExplodeAfterEvent) => void): void;
}

/**
  * 表示世界中方块的流体容器。用于
  * 像炼药锅这样的方块。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockFluidContainerComponent extends BlockComponent {
    private constructor();
    /**
     * @remarks
      * 流体容器的相对填充高度。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    fillLevel: number;
    /**
     * @remarks
      * 容器中流体的自定义颜色。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    fluidColor: RGBA;
    static readonly componentId = 'minecraft:fluid_container';
    /**
     * @remarks
      * 向流体中添加染料。染料颜色将与任何
      * 现有的自定义颜色组合。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    addDye(dye: ItemType): void;
    /**
     * @remarks
      * 获取容器中的当前流体类型。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    getFluidType(): FluidType;
    /**
     * @remarks
      * 设置容器中的当前流体类型。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    setFluidType(fluidType: FluidType): void;
    /**
     * @remarks
      * 在容器中设置药水物品。将容器的
      * 流体类型更改为药水。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    setPotion(itemStack: ItemStack): void;
}

/**
  * 表示世界中一个方块的库存。用于
  * 像箱子这样的方块。
 * @example placeItemsInChest.ts
 * ```typescript
 * import { ItemStack, BlockInventoryComponent, DimensionLocation } from "@minecraft/server";
 * import { MinecraftBlockTypes, MinecraftItemTypes } from "@minecraft/vanilla-data";
 *
 * function placeItemsInChest(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   // Fetch block
 *   const block = targetLocation.dimension.getBlock(targetLocation);
 *
 *   if (!block) {
 *     log("Could not find block. Maybe it is not loaded?", -1);
 *     return;
 *   }
 *
 *   // Make it a chest
 *   block.setType(MinecraftBlockTypes.Chest);
 *
 *   // Get the inventory
 *   const inventoryComponent = block.getComponent("inventory") as BlockInventoryComponent;
 *
 *   if (!inventoryComponent || !inventoryComponent.container) {
 *     log("Could not find inventory component.", -1);
 *     return;
 *   }
 *
 *   const inventoryContainer = inventoryComponent.container;
 *
 *   // Set slot 0 to a stack of 10 apples
 *   inventoryContainer.setItem(0, new ItemStack(MinecraftItemTypes.Apple, 10));
 * }
 * ```
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockInventoryComponent extends BlockComponent {
    private constructor();
    /**
     * @remarks
      * 持有 {@link ItemStack} 的容器。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly container?: Container;
    static readonly componentId = 'minecraft:inventory';
}

/**
 * BlockLocationIterator 返回其迭代的方块体积的下一个方块位置。
 * BlockLocationIterator 用于抽象其获取来源的方块体积的形状（因此它可以表示
 * 构成矩形、立方体、球体、线条和复杂形状的所有方块位置）。
 * 每次迭代传递返回父形状中的下一个有效方块位置。
 * 除非父形状另有指定 - BlockLocationIterator 将按 X 递增、
 * Z 递增、Y 递增的顺序遍历 3D 空间。
 * （实际上是在 XZ 平面上步进，当该平面中的所有位置都遍历完后，
 * 将 Y 坐标增加到下一个 XZ 切片）
 */
export class BlockLocationIterator implements Iterable<Vector3> {
    private constructor();
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     */
    [Symbol.iterator](): Iterator<Vector3>;
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     */
    next(): IteratorResult<Vector3>;
}

/**
  * 表示方块在地图上显示时的颜色。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockMapColorComponent extends BlockComponent {
    private constructor();
    /**
     * @remarks
      * 为该方块定义的基础地图颜色。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly color: RGBA;
    /**
     * @remarks
      * 返回基础颜色乘以给定位置评估后的色调的结果
      * 。
     *
     */
    readonly tintedColor: RGBA;
    /**
     * @remarks
      * 应用于颜色的色调类型。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly tintMethod: TintMethod;
    static readonly componentId = 'minecraft:map_color';
}

/**
  * 表示一个可以移动的方块（如活塞）。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockMovableComponent extends BlockComponent {
    private constructor();
    /**
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    readonly movementType: MovementType;
    /**
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    readonly stickyType: StickyType;
    static readonly componentId = 'minecraft:movable';
}

/**
  * 包含类型 {@link BlockType} 和
  * 属性（有时也称为方块状态）的组合，用于
  * 描述方块（但不属于特定的 {@link
  * Block}）。
 * @example addTranslatedSign.ts
 * ```typescript
 * import { world, BlockPermutation, BlockSignComponent, BlockComponentTypes, DimensionLocation } from "@minecraft/server";
 * import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
 *
 * function addTranslatedSign(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const players = world.getPlayers();
 *
 *   const dim = players[0].dimension;
 *
 *   const signBlock = dim.getBlock(targetLocation);
 *
 *   if (!signBlock) {
 *     log("Could not find a block at specified ");
 *     return -1;
 *   }
 *   const signPerm = BlockPermutation.resolve(MinecraftBlockTypes.StandingSign, { ground_sign_direction: 8 });
 *
 *   signBlock.setPermutation(signPerm);
 *
 *   const signComponent = signBlock.getComponent(BlockComponentTypes.Sign) as BlockSignComponent;
 *
 *   signComponent?.setText({ translate: "item.skull.player.name", with: [players[0].name] });
 * }
 * ```
 */
export class BlockPermutation {
    private constructor();
    /**
     * @remarks
      * 用于 .lang 文件中此 BlockPermutation 名称本地化的键。
     *
     */
    readonly localizationKey: string;
    /**
     * @remarks
      * 置换所具有的 {@link BlockType}。
     *
     */
    readonly 'type': BlockType;
    /**
     * @remarks
      * 返回此方块在接触液体时是否会被

      * 移除。
     *
     * @param liquidType
      * 应调用此函数的液体类型。
     * @returns
      * 此方块在接触液体时是否会被移除。
     * @throws 此函数可能会抛出错误。
     */
    canBeDestroyedByLiquidSpread(liquidType: LiquidType): boolean;
    /**
     * @remarks
      * 返回此方块是否可以在其上放置液体，

      * 即被水淹没。
     *
     * @param liquidType
      * 应调用此函数的液体类型。
     * @returns
     * 此方块是否可以在其上放置液体。
     * @throws 此函数可能会抛出错误。
     */
    canContainLiquid(liquidType: LiquidType): boolean;
    /**
     * @remarks
      * 返回与此方块关联的所有可用方块状态
      * 。
     *
     * @returns
      * 返回置换所具有的所有方块状态
      * 的列表。
     */
    getAllStates(): Record<string, boolean | number | string>;
    /**
     * @remarks
      * 基于此方块置换检索一个可用于物品
      * Container/ContainerSlot API 的原型物品
      * 堆叠。
     *
     * @param amount
      * 要放入原型物品堆叠中的此方块实例
      * 数量。
     * Defaults to: 1
     * Bounds: [1, 255]
     */
    getItemStack(amount?: number): ItemStack | undefined;
    /**
     * @remarks
      * 获取置换的状态。
     *
     * @param stateName
      * 要返回值的方块状态名称。
     * @returns
      * 如果置换具有该状态则返回该状态，否则
      * 返回 `undefined`。
     */
    getState<T extends keyof minecraftvanilladata.BlockStateSuperset>(
        stateName: T,
    ): minecraftvanilladata.BlockStateSuperset[T] | undefined;
    /**
     * @remarks
     * 创建置换的副本。
     *
     */
    getTags(): string[];
    /**
     * @remarks
      * 检查置换是否具有特定标签。
     *
     * @returns
      * 如果置换具有该标签则返回 `true`，否则返回 `false`。
     * @example checkBlockTags.ts
     * ```typescript
     * import { DimensionLocation } from "@minecraft/server";
     *
     * function checkBlockTags(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
     *   // Fetch the block
     *   const block = targetLocation.dimension.getBlock(targetLocation);
     *
     *   // check that the block is loaded
     *   if (block) {
     *     log(`Block is dirt: ${block.hasTag("dirt")}`);
     *     log(`Block is wood: ${block.hasTag("wood")}`);
     *     log(`Block is stone: ${block.hasTag("stone")}`);
     *   }
     * }
     * ```
     */
    hasTag(tag: string): boolean;
    /**
     * @remarks
      * 返回此方块是否阻止液体流动。

     *
     * @param liquidType
      * 应调用此函数的液体类型。
     * @returns
     * 此方块是否阻止液体流动。
     * @throws 此函数可能会抛出错误。
     */
    isLiquidBlocking(liquidType: LiquidType): boolean;
    /**
     * @remarks
      * 返回此方块在接触液体时是否会被移除并生成其

      * 物品。
     *
     * @param liquidType
      * 应调用此函数的液体类型。
     * @returns
     * 此方块在接触液体时是否会被移除并生成其物品。
     * @throws 此函数可能会抛出错误。
     */
    liquidSpreadCausesSpawn(liquidType: LiquidType): boolean;
    /**
     * @remarks
      * 返回指定的置换是否匹配此置换的布尔值。
      * 如果未指定状态，则匹配会更广泛地检查
      * 类型集合。
     *
     * @param blockName
      * 用于比较的可选状态集合。
     */
    matches<T extends string = minecraftvanilladata.MinecraftBlockTypes>(
        blockName: T,
        states?: BlockStateArg<T>,
    ): boolean;
    /**
     * @remarks
      * 返回带有特定属性集的派生的 BlockPermutation
      * 。
     *
     * @param name
      * 方块属性的标识符。
     * @param value
      * 方块属性的值。
     * @throws 此函数可能会抛出错误。
     */
    withState<T extends keyof minecraftvanilladata.BlockStateSuperset>(
        name: T,
        value: minecraftvanilladata.BlockStateSuperset[T],
    ): BlockPermutation;
    /**
     * @remarks
      * 给定一个类型标识符和一组可选的属性，
      * 将返回一个可在其他方块 API 中使用的 BlockPermutation 对象
      * （例如 block.setPermutation）。
     *
     * @param blockName
      * 要检查的方块的标识符。
     * @throws 此函数可能会抛出错误。
     * @example addBlockColorCube.ts
     * ```typescript
     * import { BlockPermutation, DimensionLocation } from "@minecraft/server";
     * import { Vector3Utils } from "@minecraft/math";
     * import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
     *
     * function addBlockColorCube(targetLocation: DimensionLocation) {
     *   const allWoolBlocks: string[] = [
     *     MinecraftBlockTypes.WhiteWool,
     *     MinecraftBlockTypes.OrangeWool,
     *     MinecraftBlockTypes.MagentaWool,
     *     MinecraftBlockTypes.LightBlueWool,
     *     MinecraftBlockTypes.YellowWool,
     *     MinecraftBlockTypes.LimeWool,
     *     MinecraftBlockTypes.PinkWool,
     *     MinecraftBlockTypes.GrayWool,
     *     MinecraftBlockTypes.LightGrayWool,
     *     MinecraftBlockTypes.CyanWool,
     *     MinecraftBlockTypes.PurpleWool,
     *     MinecraftBlockTypes.BlueWool,
     *     MinecraftBlockTypes.BrownWool,
     *     MinecraftBlockTypes.GreenWool,
     *     MinecraftBlockTypes.RedWool,
     *     MinecraftBlockTypes.BlackWool,
     *   ];
     *
     *   const cubeDim = 7;
     *
     *   let colorIndex = 0;
     *
     *   for (let x = 0; x <= cubeDim; x++) {
     *     for (let y = 0; y <= cubeDim; y++) {
     *       for (let z = 0; z <= cubeDim; z++) {
     *         colorIndex++;
     *         targetLocation.dimension
     *           .getBlock(Vector3Utils.add(targetLocation, { x, y, z }))
     *           ?.setPermutation(BlockPermutation.resolve(allWoolBlocks[colorIndex % allWoolBlocks.length]));
     *       }
     *     }
     *   }
     * }
     * ```
     */
    static resolve<T extends string = minecraftvanilladata.MinecraftBlockTypes>(
        blockName: T,
        states?: BlockStateArg<T>,
    ): BlockPermutation;
}

/**
  * 当存在时，此方块具有类似活塞的行为。包含
  * 用于发现方块活塞状态的额外属性。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockPistonComponent extends BlockComponent {
    private constructor();
    /**
     * @remarks
      * 活塞是否正在伸出或
      * 收回。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly isMoving: boolean;
    /**
     * @remarks
      * 活塞的当前状态。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly state: BlockPistonState;
    static readonly componentId = 'minecraft:piston';
    /**
     * @remarks
      * 检索与此活塞连接的方块集合
      * 。
     *
     * @throws 此函数可能会抛出错误。
     */
    getAttachedBlocks(): Block[];
    /**
     * @remarks
      * 检索与此活塞连接的方块位置集合
      * 。
     *
     * @throws 此函数可能会抛出错误。
     */
    getAttachedBlocksLocations(): Vector3[];
}

/**
  * 表示方块与降水（如雨或雪）的交互方式。
  * 。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockPrecipitationInteractionsComponent extends BlockComponent {
    private constructor();
    static readonly componentId = 'minecraft:precipitation_interactions';
    /**
     * @remarks
      * 如果降雪会在方块上自然堆积则返回 `true`。
      * 如果雪不会在方块上堆积则返回 `false`
      * 。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    accumulatesSnow(): boolean;
    /**
     * @remarks
      * 如果雨水不会穿过方块则返回 `true`。
      * 如果雨水应该穿过方块则返回 `false`。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    obstructsRain(): boolean;
}

/**
  * 表示一个可以播放唱片的方块。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockRecordPlayerComponent extends BlockComponent {
    private constructor();
    static readonly componentId = 'minecraft:record_player';
    /**
     * @remarks
      * 弹出此唱片播放方块当前设置的唱片
      * 。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    ejectRecord(): void;
    /**
     * @remarks
      * 获取此唱片播放方块当前设置的唱片。
     *
     * @throws 此函数可能会抛出错误。
     */
    getRecord(): ItemStack | undefined;
    /**
     * @remarks
     * 如果唱片播放方块当前正在播放唱片，则返回 true。

      *
     *
     * @throws 此函数可能会抛出错误。
     */
    isPlaying(): boolean;
    /**
     * @remarks
      * 暂停此唱片播放方块当前正在播放的唱片
      * 。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    pauseRecord(): void;
    /**
     * @remarks
      * 播放此唱片播放方块当前设置的唱片。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    playRecord(): void;
    /**
     * @remarks
      * 根据物品类型设置并播放唱片。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param startPlaying
     * 默认值：true
     *
     * @throws 此函数可能会抛出错误。
     */
    setRecord(recordItemType?: ItemType | string, startPlaying?: boolean): void;
}

/**
  * 表示一个可以输出红石信号的方块。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockRedstoneProducerComponent extends BlockComponent {
    private constructor();
    /**
     * @remarks
      * 获取此方块输出到电路系统的功率。
      * 如果方块不再有效或不具有
      * 'minecraft:redstone_producer' 组件，则返回错误。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidBlockComponentError}
     */
    readonly power: number;
    static readonly componentId = 'minecraft:redstone_producer';
    /**
     * @remarks
      * 获取此方块可以连接电路并输出功率的面
      * 。如果方块不再有效或不具有
      * 'minecraft:redstone_producer'
      * 组件，则返回错误。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidBlockComponentError}
     */
    getConnectedFaces(): Direction[];
    /**
     * @remarks
      * 获取强力激活其接触方块的方块面
      * 。如果 'minecraft:redstone_producer' 方块组件
      * 未定义 'strongly_powered_face'，则此方法
      * 返回 'undefined'。如果方块不再
      * 有效或不具有
      * 'minecraft:redstone_producer' 组件，则返回错误。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidBlockComponentError}
     */
    getStronglyPoweredFace(): Direction | undefined;
}

/**
  * 表示一个可以在其上显示文本的方块。
 * @example addSign.ts
 * ```typescript
 * import { world, BlockPermutation, BlockSignComponent, BlockComponentTypes, DimensionLocation } from "@minecraft/server";
 * import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
 *
 * function addSign(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const players = world.getPlayers();
 *
 *   const dim = players[0].dimension;
 *
 *   const signBlock = dim.getBlock(targetLocation);
 *
 *   if (!signBlock) {
 *     log("Could not find a block at specified ");
 *     return -1;
 *   }
 *   const signPerm = BlockPermutation.resolve(MinecraftBlockTypes.StandingSign, { ground_sign_direction: 8 });
 *
 *   signBlock.setPermutation(signPerm);
 *
 *   const signComponent = signBlock.getComponent(BlockComponentTypes.Sign) as BlockSignComponent;
 *
 *   signComponent?.setText(`Basic sign!\nThis is green on the front.`);
 * }
 * ```
 * @example addTwoSidedSign.ts
 * ```typescript
 * import { BlockPermutation, BlockSignComponent, SignSide, DyeColor, BlockComponentTypes, DimensionLocation } from "@minecraft/server";
 * import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
 *
 * function addTwoSidedSign(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const signBlock = targetLocation.dimension.getBlock(targetLocation);
 *
 *   if (!signBlock) {
 *     log("Could not find a block at specified ");
 *     return -1;
 *   }
 *   const signPerm = BlockPermutation.resolve(MinecraftBlockTypes.StandingSign, { ground_sign_direction: 8 });
 *
 *   signBlock.setPermutation(signPerm);
 *
 *   const signComponent = signBlock.getComponent(BlockComponentTypes.Sign) as BlockSignComponent;
 *
 *   if (signComponent) {
 *     signComponent.setText(`Party Sign!\nThis is green on the front.`);
 *     signComponent.setText(`Party Sign!\nThis is red on the back.`, SignSide.Back);
 *     signComponent.setTextDyeColor(DyeColor.Green);
 *     signComponent.setTextDyeColor(DyeColor.Red, SignSide.Back);
 *
 *     // players cannot edit sign!
 *     signComponent.setWaxed(true);
 *   } else {
 *     log("Could not find sign component.");
 *   }
 * }
 * ```
 * @example updateSignText.ts
 * ```typescript
 * import { BlockSignComponent, BlockComponentTypes, DimensionLocation, RawMessage, RawText } from "@minecraft/server";
 *
 * function updateSignText(targetLocation: DimensionLocation) {
 *   const block = targetLocation.dimension.getBlock(targetLocation);
 *   if (!block) {
 *     console.warn("Could not find a block at specified ");
 *     return;
 *   }
 *
 *   const sign = block.getComponent(BlockComponentTypes.Sign) as BlockSignComponent;
 *   if (sign) {
 *     // RawMessage
 *     const helloWorldMessage: RawMessage = { text: "Hello World" };
 *     sign.setText(helloWorldMessage);
 *
 *     // RawText
 *     const helloWorldText: RawText = { rawtext: [{ text: "Hello World" }] };
 *     sign.setText(helloWorldText);
 *
 *     // Regular string
 *     sign.setText("Hello World");
 *   } else {
 *     console.warn("Could not find a sign component on the block.");
 *   }
 * }
 * ```
 * @example addTranslatedSign.ts
 * ```typescript
 * import { world, BlockPermutation, BlockSignComponent, BlockComponentTypes, DimensionLocation } from "@minecraft/server";
 * import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
 *
 * function addTranslatedSign(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const players = world.getPlayers();
 *
 *   const dim = players[0].dimension;
 *
 *   const signBlock = dim.getBlock(targetLocation);
 *
 *   if (!signBlock) {
 *     log("Could not find a block at specified ");
 *     return -1;
 *   }
 *   const signPerm = BlockPermutation.resolve(MinecraftBlockTypes.StandingSign, { ground_sign_direction: 8 });
 *
 *   signBlock.setPermutation(signPerm);
 *
 *   const signComponent = signBlock.getComponent(BlockComponentTypes.Sign) as BlockSignComponent;
 *
 *   signComponent?.setText({ translate: "item.skull.player.name", with: [players[0].name] });
 * }
 * ```
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockSignComponent extends BlockComponent {
    private constructor();
    /**
     * @remarks
      * 玩家是否可以编辑告示牌。如果
      * 告示牌上使用了蜜脾或调用了 `setWaxed`，
      * 则会发生这种情况。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly isWaxed: boolean;
    static readonly componentId = 'minecraft:sign';
    /**
     * @remarks
      * 如果使用 RawMessage 或 RawText 对象调用 `setText`，
      * 则返回告示牌的 RawText，否则返回
      * undefined。
     *
     * @param side
      * 要从中读取信息的告示牌面。如果未提供，
      * 则将返回告示牌正面的信息
      * 。
     * Defaults to: 0
     * @throws 此函数可能会抛出错误。
     */
    getRawText(side?: SignSide): RawText | undefined;
    /**
     * @remarks
      * 如果使用字符串调用 `setText`，则返回告示牌的文本，
      * 否则返回 undefined。
     *
     * @param side
      * 要从中读取信息的告示牌面。如果未提供，
      * 则将返回告示牌正面的信息
      * 。
     * Defaults to: 0
     * @throws 此函数可能会抛出错误。
     */
    getText(side?: SignSide): string | undefined;
    /**
     * @remarks
      * 获取文本上的染料颜色，如果告示牌未染色则返回 undefined
      * 。
     *
     * @param side
      * 要从中读取染料颜色的告示牌面。如果未提供，
      * 则将返回告示牌正面的染料颜色。
     * Defaults to: 0
     * @throws 此函数可能会抛出错误。
     */
    getTextDyeColor(side?: SignSide): DyeColor | undefined;
    /**
     * @remarks
      * 设置告示牌组件的文本。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param message
      * 要在告示牌上设置的信息。如果设置为字符串，则
      * 调用 `getText` 读取该字符串。如果设置为 RawMessage，
      * 则调用 `getRawText` 将返回 RawText。
     * @param side
      * 将设置信息的告示牌面。如果未提供，
      * 则信息将设置在告示牌的
      * 正面。
     * Defaults to: 0
     * @throws
      * 如果提供的信息长度超过 512 个字符，将抛出异常
      * 。
     */
    setText(message: RawMessage | string, side?: SignSide): void;
    /**
     * @remarks
      * 设置文本的染料颜色。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param color
      * 要应用于告示牌的染料颜色，或使用 undefined 清除
      * 告示牌上的染料。
     * Defaults to: null
     * @param side
      * 将设置颜色的告示牌面。如果未提供，
      * 则颜色将设置在告示牌的
      * 正面。
     * Defaults to: 0
     * @throws 此函数可能会抛出错误。
     */
    setTextDyeColor(color?: DyeColor, side?: SignSide): void;
    /**
     * @remarks
      * 使玩家无法编辑此告示牌。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    setWaxed(waxed: boolean): void;
}

/**
  * 枚举所有 {@link BlockStateType}。
 */
export class BlockStates {
    private constructor();
    /**
     * @remarks
      * 检索特定的方块状态实例。
     *
     * @returns
      * 如果找到则返回 {@link Block} 状态实例。如果
      * 未找到方块状态实例则返回 undefined。
     */
    static get(stateName: string): BlockStateType | undefined;
    /**
     * @remarks
      * 检索所有可用方块状态的集合。
     *
     */
    static getAll(): BlockStateType[];
}

/**
  * 表示方块实例的可配置状态值。
  * 例如，楼梯的朝向方向可以作为
  * 方块状态访问。
 */
export class BlockStateType {
    private constructor();
    /**
     * @remarks
      * 方块属性的标识符。
     *
     */
    readonly id: string;
    /**
     * @remarks
      * 方块属性的有效值集合。
     *
     */
    readonly validValues: (boolean | number | string)[];
}

/**
  * 方块的类型（或模板）。不包含
  * 除其表示的方块类型之外的置换数据（状态）
  * 。此类型自
  * 1.17.10.21 版本引入。
 */
export class BlockType {
    private constructor();
    /**
     * @remarks
      * 方块类型名称——例如 `minecraft:acacia_stairs`。
     *
     */
    readonly id: string;
    /**
     * @remarks
      * 用于 .lang 文件中此 BlockType 名称本地化的键
     * .lang 文件。
     *
     */
    readonly localizationKey: string;
}

/**
  * 包含此世界中可用的 Minecraft 方块类型
 * 此世界中可用。
 */
export class BlockTypes {
    private constructor();
    /**
     * @remarks
      * 返回指定标识符的 BlockType 对象。
     *
     * @param typeName
      * 方块类型的标识符。应遵循 namespace:id 格式
      * ，例如 minecraft:dirt。
     * @returns
      * BlockType 对象，如果该方块类型在此世界中不可用
      * 则返回 undefined。
     */
    static get(typeName: string): BlockType | undefined;
    /**
     * @remarks
      * 返回所有可用方块类型的集合。
     *
     */
    static getAll(): BlockType[];
}

/**
 * BlockVolume 是一个简单的接口，表示世界中给定大小（以方块为单位）的 3D 矩形对象。
 * 注意这些与 "min" 和 "max" 值不同，向量组件不保证按任何顺序排列。
 * 此外，这些向量位置不能与 BlockLocation 互换。
 * 如果您希望将此体积表示为 BlockLocation 的范围，可以使用 getBoundingBox 实用函数。
 * 此体积类将维护最初设置的角索引顺序。假设每个角在编辑器中分配 -
 * 当您移动角时（可能反转边界的 min/max 关系）-
 * 您最初选择的顶/左角传统上会变成底/右角。
 * 手动编辑这类体积时，您需要在编辑时维护角的身份 -
 * BlockVolume 实用函数可以做到这一点。
 *
 * 需要注意的是，这测量的是方块大小（从/到）-
 * 普通的 AABB (0,0,0) 到 (0,0,0) 传统上大小为 (0,0,0)
 * 然而，因为我们测量的是方块 - BlockVolume 的大小或跨度实际上会是 (1,1,1)
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BlockVolume extends BlockVolumeBase {
    /**
     * @remarks
     * 表示 3D 矩形中一个角的世界方块位置
     *
     */
    'from': Vector3;
    /**
     * @remarks
     * 表示 3D 矩形中对角的世界方块位置
     *
     */
    to: Vector3;
    constructor(from: Vector3, to: Vector3);
    /**
     * @remarks
     * 检查给定位置是否直接邻接 BlockVolume 的外表面。
     *
     *
     * @param pos
     * 要测试的世界方块位置
     * @returns
     * 如果该位置在内部或距离超过 0 个方块，函数将返回 false。
     * 如果该位置直接接触 BlockVolume 的外表面，函数将返回 true。
     */
    doesLocationTouchFaces(pos: Vector3): boolean;
    /**
     * @remarks
     * 检查两个方块体积是否直接邻接且两个面接触。
     *
     * @param other
     * 要测试的体积
     * @returns
     * 如果两个方块体积的外表面在任意点接触且直接邻接，返回 true。
     */
    doesVolumeTouchFaces(other: BlockVolume): boolean;
    /**
     * @remarks
     * 返回表示两个 BlockVolume 对象之间交集的枚举
     *
     */
    intersects(other: BlockVolume): BlockVolumeIntersection;
}

/**
  * BlockVolumes 的基础类型。
 */
export class BlockVolumeBase {
    private constructor();
    /**
     * @remarks
     * 获取表示指定体积内所有方块世界位置的 {@link BlockLocationIterator}
     *
     */
    getBlockLocationIterator(): BlockLocationIterator;
    /**
     * @remarks
     * 返回 BlockVolume 的容量（体积）（宽*深*高）
     *
     */
    getCapacity(): number;
    /**
     * @remarks
     * 获取体积的最大角位置（保证 >= min）
     *
     * @throws 此函数可能会抛出错误。
     */
    getMax(): Vector3;
    /**
     * @remarks
     * 获取体积的最小角位置（保证 <= max）
     *
     * @throws 此函数可能会抛出错误。
     */
    getMin(): Vector3;
    /**
     * @remarks
     * 获取一个 {@link Vector3} 对象，其中每个分量表示沿该轴方向的方块数
     *
     */
    getSpan(): Vector3;
    /**
     * @remarks
     * 检查给定的世界方块位置是否在 BlockVolume 内部
     *
     */
    isInside(location: Vector3): boolean;
    /**
     * @remarks
     * 按指定数量移动 BlockVolume
     *
     * @param delta
     * 移动的方块数量
     */
    translate(delta: Vector3): void;
}

/**
  * 包含与按钮按下变化相关的信息。
 * @example buttonPushEvent.ts
 * ```typescript
 * import { world, system, BlockPermutation, ButtonPushAfterEvent, DimensionLocation } from "@minecraft/server";
 * import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
 *
 * function buttonPushEvent(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   // set up a button on cobblestone
 *   const cobblestone = targetLocation.dimension.getBlock(targetLocation);
 *   const button = targetLocation.dimension.getBlock({
 *     x: targetLocation.x,
 *     y: targetLocation.y + 1,
 *     z: targetLocation.z,
 *   });
 *
 *   if (cobblestone === undefined || button === undefined) {
 *     log("Could not find block at ");
 *     return -1;
 *   }
 *
 *   cobblestone.setPermutation(BlockPermutation.resolve(MinecraftBlockTypes.Cobblestone));
 *   button.setPermutation(BlockPermutation.resolve(MinecraftBlockTypes.AcaciaButton).withState("facing_direction", 1));
 *
 *   world.afterEvents.buttonPush.subscribe((buttonPushEvent: ButtonPushAfterEvent) => {
 *     const eventLoc = buttonPushEvent.block.location;
 *
 *     if (eventLoc.x === targetLocation.x && eventLoc.y === targetLocation.y + 1 && eventLoc.z === targetLocation.z) {
 *       log("Button push event at tick " + system.currentTick);
 *     }
 *   });
 * }
 * ```
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class ButtonPushAfterEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
      * 触发按钮按下的可选来源。
     *
     */
    readonly source: Entity;
}

/**
  * 管理按钮按下时相关的回调。
 * 按钮已按下。
 * @example buttonPushEvent.ts
 * ```typescript
 * import { world, system, BlockPermutation, ButtonPushAfterEvent, DimensionLocation } from "@minecraft/server";
 * import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
 *
 * function buttonPushEvent(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   // set up a button on cobblestone
 *   const cobblestone = targetLocation.dimension.getBlock(targetLocation);
 *   const button = targetLocation.dimension.getBlock({
 *     x: targetLocation.x,
 *     y: targetLocation.y + 1,
 *     z: targetLocation.z,
 *   });
 *
 *   if (cobblestone === undefined || button === undefined) {
 *     log("Could not find block at ");
 *     return -1;
 *   }
 *
 *   cobblestone.setPermutation(BlockPermutation.resolve(MinecraftBlockTypes.Cobblestone));
 *   button.setPermutation(BlockPermutation.resolve(MinecraftBlockTypes.AcaciaButton).withState("facing_direction", 1));
 *
 *   world.afterEvents.buttonPush.subscribe((buttonPushEvent: ButtonPushAfterEvent) => {
 *     const eventLoc = buttonPushEvent.block.location;
 *
 *     if (eventLoc.x === targetLocation.x && eventLoc.y === targetLocation.y + 1 && eventLoc.z === targetLocation.z) {
 *       log("Button push event at tick " + system.currentTick);
 *     }
 *   });
 * }
 * ```
 */
export class ButtonPushAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个将在按钮被按下时调用的回调函数。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: ButtonPushAfterEvent) => void): (arg0: ButtonPushAfterEvent) => void;
    /**
     * @remarks
     * 移除一个将在按钮被按下时调用的回
     * 调函数。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: ButtonPushAfterEvent) => void): void;
}

/**
  * 包含与指定玩家活动相机相关的方法。
 * 指定玩家。
 */
export class Camera {
    private constructor();
    /**
     * @remarks
     * 返回相机是否有效可访问和使用。相

     * 机在拥有该相机的玩家已加载且自身有效
     * 时被视为有效。
     *
     */
    readonly isValid: boolean;
    /**
     * @remarks
     * 将相机附加到非玩家实体上。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param attachCameraOptions
     * 相机所附加到的实体的选项。包含
     * 实体标识符和可选的实体
     * @throws 此函数可能会抛出错误。
     */
    attachToEntity(attachCameraOptions?: CameraAttachOptions): void;
    /**
     * @remarks
     * 清除指定玩家的活动相机。使
     * 指定玩家结束任何进行中的相机
     * 视角，包括任何缓动相机运动，并返回
     * 到他们的正常视角。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    clear(): void;
    /**
     * @remarks
     * 开始相机淡入淡出过渡。淡入淡出过渡是一种
     * 全屏颜色，先淡入，然后保持，最后淡出。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param fadeCameraOptions
     * 关于相机淡入淡出操作的附加选项。
     * @throws 此函数可能会抛出错误。
     */
    fade(fadeCameraOptions?: CameraFadeOptions): void;
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    playAnimation(splineType: CatmullRomSpline | LinearSpline, cameraAnimationOptions: AnimationOptions): void;
    /**
     * @remarks
     * 为指定玩家设置当前的激活相机。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param cameraPreset
     * 在 JSON 中定义的相机预设文件的标识符。
     * @param setOptions
     * 相机的附加选项。
     * @throws 此函数可能会抛出错误。
     */
    setCamera(
        cameraPreset: string,
        setOptions?:
            | CameraFixedBoomOptions
            | CameraSetFacingOptions
            | CameraSetLocationOptions
            | CameraSetPosOptions
            | CameraSetRotOptions
            | CameraTargetOptions,
    ): void;
    /**
     * @remarks
     * 为指定玩家设置当前激活相机，并
     * 将位置和旋转重置为 JSON 中定义
     * 的值。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param cameraPreset
     * 在 JSON 中定义的相机预设文件的标识符。
     * @param easeOptions
     * 将相机缓动回其原始位置和旋
     * 转的选项。
     * @throws 此函数可能会抛出错误。
     */
    setDefaultCamera(cameraPreset: string, easeOptions?: EaseOptions): void;
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    setFov(fovCameraOptions?: CameraFovOptions): void;
}

/**
 * CatmullRom 样条创建。
 */
export class CatmullRomSpline {
    /**
     * @remarks
     * CatmullRom 曲线的控制点。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    controlPoints: Vector3[];
}

/**
  * 包含客户端实例的设备信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class ClientSystemInfo extends SystemInfo {
    private constructor();
    /**
     * @remarks
     * 设备的最大渲染距离（以区块为单位）。
     *
     */
    readonly maxRenderDistance: number;
    /**
     * @remarks
     * 设备的平台类型。
     *
     */
    readonly platformType: PlatformType;
}

/**
 * 包含命令执行结果的返回数据。
 */
export class CommandResult {
    private constructor();
    /**
     * @remarks
     * 如果命令针对多个实体、
     * 方块或物品执行，则返回此命令成功
     * 应用的数量。
     *
     */
    readonly successCount: number;
}

/**
  * 下游 Component 实现的基类。
 */
export class Component {
    private constructor();
    /**
     * @remarks
     * 返回组件是否有效。如果组件的拥有者有效，

     * 则组件被视为有效，除此之外还有组件
     * 所需的任何额外验证
      * 组件，则返回错误。
     *
     */
    readonly isValid: boolean;
    /**
     * @remarks
     * 组件的标识符。
     *
     */
    readonly typeId: string;
}

/**
 * 代表可以容纳物品集的容器。用于
 * 与玩家、箱子矿车、羊驼等实体一起使用。
 *
 * @example containers.ts
 * ```typescript
 * import { ItemStack, EntityInventoryComponent, BlockInventoryComponent, DimensionLocation } from "@minecraft/server";
 * import { MinecraftBlockTypes, MinecraftItemTypes, MinecraftEntityTypes } from "@minecraft/vanilla-data";
 *
 * function containers(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const xLocation = targetLocation; // left chest location
 *   const xPlusTwoLocation = { x: targetLocation.x + 2, y: targetLocation.y, z: targetLocation.z }; // right chest
 *
 *   const chestCart = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.ChestMinecart, {
 *     x: targetLocation.x + 4,
 *     y: targetLocation.y,
 *     z: targetLocation.z,
 *   });
 *
 *   const xChestBlock = targetLocation.dimension.getBlock(xLocation);
 *   const xPlusTwoChestBlock = targetLocation.dimension.getBlock(xPlusTwoLocation);
 *
 *   if (!xChestBlock || !xPlusTwoChestBlock) {
 *     log("Could not retrieve chest blocks.");
 *     return;
 *   }
 *
 *   xChestBlock.setType(MinecraftBlockTypes.Chest);
 *   xPlusTwoChestBlock.setType(MinecraftBlockTypes.Chest);
 *
 *   const xPlusTwoChestInventoryComp = xPlusTwoChestBlock.getComponent("inventory") as BlockInventoryComponent;
 *   const xChestInventoryComponent = xChestBlock.getComponent("inventory") as BlockInventoryComponent;
 *   const chestCartInventoryComp = chestCart.getComponent("inventory") as EntityInventoryComponent;
 *
 *   const xPlusTwoChestContainer = xPlusTwoChestInventoryComp.container;
 *   const xChestContainer = xChestInventoryComponent.container;
 *   const chestCartContainer = chestCartInventoryComp.container;
 *
 *   if (!xPlusTwoChestContainer || !xChestContainer || !chestCartContainer) {
 *     log("Could not retrieve chest containers.");
 *     return;
 *   }
 *
 *   xPlusTwoChestContainer.setItem(0, new ItemStack(MinecraftItemTypes.Apple, 10));
 *   if (xPlusTwoChestContainer.getItem(0)?.typeId !== MinecraftItemTypes.Apple) {
 *     log("Expected apple in x+2 container slot index 0", -1);
 *   }
 *
 *   xPlusTwoChestContainer.setItem(1, new ItemStack(MinecraftItemTypes.Emerald, 10));
 *   if (xPlusTwoChestContainer.getItem(1)?.typeId !== MinecraftItemTypes.Emerald) {
 *     log("Expected emerald in x+2 container slot index 1", -1);
 *   }
 *
 *   if (xPlusTwoChestContainer.size !== 27) {
 *     log("Unexpected size: " + xPlusTwoChestContainer.size, -1);
 *   }
 *
 *   if (xPlusTwoChestContainer.emptySlotsCount !== 25) {
 *     log("Unexpected emptySlotsCount: " + xPlusTwoChestContainer.emptySlotsCount, -1);
 *   }
 *
 *   xChestContainer.setItem(0, new ItemStack(MinecraftItemTypes.Cake, 10));
 *
 *   xPlusTwoChestContainer.transferItem(0, chestCartContainer); // transfer the apple from the xPlusTwo chest to a chest cart
 *   xPlusTwoChestContainer.swapItems(1, 0, xChestContainer); // swap the cake from x and the emerald from xPlusTwo
 *
 *   if (chestCartContainer.getItem(0)?.typeId !== MinecraftItemTypes.Apple) {
 *     log("Expected apple in minecraft chest container slot index 0", -1);
 *   }
 *
 *   if (xChestContainer.getItem(0)?.typeId === MinecraftItemTypes.Emerald) {
 *     log("Expected emerald in x container slot index 0", -1);
 *   }
 *
 *   if (xPlusTwoChestContainer.getItem(1)?.typeId === MinecraftItemTypes.Cake) {
 *     log("Expected cake in x+2 container slot index 1", -1);
 *   }
 * }
 * ```
 */
export class Container {
    private constructor();
    /**
     * @remarks
     * 如果定义了这些规则，其他容器操作若导致这些规则失效则会抛出异常。例如，将潜影盒添加到原版捆绑包中。
     *
     */
    readonly containerRules?: ContainerRules;
    /**
     * @remarks
     * 容器中空槽位的数量。
     *
     * @throws
     * 如果容器无效则抛出异常。
     */
    readonly emptySlotsCount: number;
    /**
     * @remarks
     * 返回容器对象（或与此容器关联的实体或方块）在此上下文中是否仍然可用。
     *
     */
    readonly isValid: boolean;
    /**
     * @remarks
     * 此容器中的槽位数。例如，标准的单方块箱子大小为 27。注意，玩家的背包容器共有 36 个槽位：9 个快捷栏槽位加 27 个背包槽位。
     *
     * @throws
     * 如果容器无效则抛出异常。
     */
    readonly size: number;
    /**
     * @remarks
     * 容器中所有物品的总重量。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidContainerError}
     */
    readonly weight: number;
    /**
     * @remarks
     * 向容器中添加物品。物品将放置到第一个可用槽位，并可与同类型的现有物品堆叠。注意，如果希望将物品设置在特定槽位，请使用 {@link Container.setItem}。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param itemStack
     * 要添加的物品堆。
     * @throws 此函数可能会抛出错误。
     *
     * {@link ContainerRulesError}
     *
     * {@link Error}
     */
    addItem(itemStack: ItemStack): ItemStack | undefined;
    /**
     * @remarks
     * 清除容器中的所有背包物品。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws
     * 如果容器无效则抛出异常。
     */
    clearAll(): void;
    /**
     * @remarks
     * 尝试在容器中查找物品。
     *
     * @param itemStack
     * 要查找的物品。
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidContainerError}
     */
    contains(itemStack: ItemStack): boolean;
    /**
     * @remarks
     * 查找容器中第一个匹配物品实例的索引。
     *
     * @param itemStack
     * 要查找的物品。
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidContainerError}
     */
    find(itemStack: ItemStack): number | undefined;
    /**
     * @remarks
     * 查找容器中最后一个匹配物品实例的索引。
     *
     * @param itemStack
     * 要查找的物品。
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidContainerError}
     */
    findLast(itemStack: ItemStack): number | undefined;
    /**
     * @remarks
     * 查找容器中第一个空槽位的索引。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidContainerError}
     */
    firstEmptySlot(): number | undefined;
    /**
     * @remarks
     * 查找容器中第一个物品的索引。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidContainerError}
     */
    firstItem(): number | undefined;
    /**
     * @remarks
     * 获取指定槽位中物品的 {@link ItemStack}。如果槽位为空，则返回 `undefined`。此方法不会更改或清除指定槽位的内容。要获取特定槽位的引用，请参阅 {@link Container.getSlot}。
     *
     * @param slot
     * 要从中检索物品的槽位的从零开始的索引。
     * 最小值：0
     * @throws
     * 如果容器无效或 `slot` 索引
     * 超出范围，则抛出异常。
     * @example getFirstHotbarItem.ts
     * ```typescript
     * import { world, EntityInventoryComponent, DimensionLocation } from "@minecraft/server";
     *
     * function getFirstHotbarItem(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
     *   for (const player of world.getAllPlayers()) {
     *     const inventory = player.getComponent(EntityInventoryComponent.componentId) as EntityInventoryComponent;
     *     if (inventory && inventory.container) {
     *       const firstItem = inventory.container.getItem(0);
     *
     *       if (firstItem) {
     *         log("First item in hotbar is: " + firstItem.typeId);
     *       }
     *
     *       return inventory.container.getItem(0);
     *     }
     *     return undefined;
     *   }
     * }
     * ```
     */
    getItem(slot: number): ItemStack | undefined;
    /**
     * @remarks
     * 返回一个容器槽位。作为此容器中给定索引槽位的引用。
     *
     * @param slot
     * 要返回的槽位索引。此索引必须在容器的范围内。
     * 最小值：0
     * @throws
     * 如果容器无效或 `slot` 索引超出范围，
     * 则抛出异常。
     */
    getSlot(slot: number): ContainerSlot;
    /**
     * @remarks
     * 将物品从一个槽位移到另一个槽位，可能在容器之间移动。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param fromSlot
     * 此容器上要从中转移物品的槽位的从零开始的索引。
     * 最小值：0
     * @param toSlot
     * 在 `toContainer` 上要转移物品到的槽位的从零开始的索引。
     * 最小值：0
     * @param toContainer
     * 要转移到的目标容器。注意，此容器可以与源容器相同。
     * @throws
     * 如果此容器或 `toContainer` 无效，
     * 或 `fromSlot` 或 `toSlot` 索引超出范围，则抛出异常。
     *
     * {@link ContainerRulesError}
     *
     * {@link Error}
     * @example moveBetweenContainers.ts
     * ```typescript
     * import { world, EntityInventoryComponent, EntityComponentTypes, DimensionLocation } from "@minecraft/server";
     * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
     *
     * function moveBetweenContainers(
     *     targetLocation: DimensionLocation
     * ) {
     *   const players = world.getAllPlayers();
     *
     *   const chestCart = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.ChestMinecart, {
     *     x: targetLocation.x + 1,
     *     y: targetLocation.y,
     *     z: targetLocation.z,
     *   });
     *
     *   if (players.length > 0) {
     *     const fromPlayer = players[0];
     *
     *     const fromInventory = fromPlayer.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent;
     *     const toInventory = chestCart.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent;
     *
     *     if (fromInventory && toInventory && fromInventory.container && toInventory.container) {
     *       fromInventory.container.moveItem(0, 0, toInventory.container);
     *     }
     *   }
     * }
     * ```
     */
    moveItem(fromSlot: number, toSlot: number, toContainer: Container): void;
    /**
     * @remarks
     * 在特定槽位中设置物品堆。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param slot
     * 设置物品的槽位的从零开始的索引。
     * 最小值：0
     * @param itemStack
     * 要放置在指定槽位中的物品堆。将 `itemStack` 设置为 undefined 将清空该槽位。
     * @throws
     * 如果容器无效或 `slot` 索引
     * 超出范围，则抛出异常。
     *
     * {@link ContainerRulesError}
     *
     * {@link Error}
     */
    setItem(slot: number, itemStack?: ItemStack): void;
    /**
     * @remarks
     * 在容器中的两个不同槽位之间交换物品。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param slot
     * 此容器中要交换的槽位的从零开始的索引。
     * 最小值：0
     * @param otherSlot
     * 要交换的目标槽位的从零开始的索引。
     * 最小值：0
     * @param otherContainer
     * 要交换的目标容器。注意，此容器可以与源容器相同。
     * @throws
     * 如果此容器或 `otherContainer`
     * 无效，或 `slot` 或 `otherSlot` 超出范围，则抛出异常。
     *
     * {@link ContainerRulesError}
     *
     * {@link Error}
     */
    swapItems(slot: number, otherSlot: number, otherContainer: Container): void;
    /**
     * @remarks
     * 将物品从一个槽位移到另一个容器，或移到同一容器中的第一个可用槽位。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param fromSlot
     * 此容器上要从中转移物品的槽位的从零开始的索引。
     *
     * 最小值：0
     * @param toContainer
     * 要转移到的目标容器。注意，此容器可以
     * 与源容器相同。
     * @returns
     * 包含无法转移的物品的 ItemStack。
     * 如果所有物品都已转移则返回 undefined。
     * @throws
     * 如果此容器或 `toContainer` 无效，
     * 或 `fromSlot` 或 `toSlot` 索引超出范围，则抛出异常。
     *
     * {@link ContainerRulesError}
     *
     * {@link Error}
     * @example transferBetweenContainers.ts
     * ```typescript
     * import { world, EntityInventoryComponent, EntityComponentTypes, DimensionLocation } from "@minecraft/server";
     * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
     *
     * function transferBetweenContainers(
     *     targetLocation: DimensionLocation
     * ) {
     *   const players = world.getAllPlayers();
     *
     *   const chestCart = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.ChestMinecart, {
     *     x: targetLocation.x + 1,
     *     y: targetLocation.y,
     *     z: targetLocation.z,
     *   });
     *
     *   if (players.length > 0) {
     *     const fromPlayer = players[0];
     *
     *     const fromInventory = fromPlayer.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent;
     *     const toInventory = chestCart.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent;
     *
     *     if (fromInventory && toInventory && fromInventory.container && toInventory.container) {
     *       fromInventory.container.transferItem(0, toInventory.container);
     *     }
     *   }
     * }
     * ```
     */
    transferItem(fromSlot: number, toContainer: Container): ItemStack | undefined;
}

/**
 * 代表一个更广泛容器（如实体
 * 物品栏）内的槽位。
 */
export class ContainerSlot {
    private constructor();
    /**
     * @remarks
     * 物品堆中的物品数量。有效值范围为
     * 1-255。提供的值将被限制为物品的
     * 最大堆叠大小。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     * 范围：[1, 255]
     * @throws
     * 如果值超出 1-255 范围，则抛出异常。
     */
    amount: number;
    /**
     * @remarks
     * 返回物品是否可堆叠。如果物品的最大

     * 堆叠大小大于 1 且物品不包含任何自定义
     * 数据或属性，则该物品被视为可堆叠。
     *
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link InvalidContainerSlotError}
     */
    readonly isStackable: boolean;
    /**
     * @remarks
     * 返回 ContainerSlot 是否有效。容

     * 器槽位在容器存在且已加载，并且槽位索引
     * 有效时被视为有效。
     *
     */
    readonly isValid: boolean;
    /**
     * @remarks
     * 获取或设置物品在死亡时是否保留。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     * @throws
     * 如果槽位的容器无效则抛出异常。
     */
    keepOnDeath: boolean;
    /**
     * @remarks
     * 获取或设置物品的锁定模式。默认值为
     * `ItemLockMode.none`。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     * @throws
     * 如果槽位的容器无效则抛出异常。
     */
    lockMode: ItemLockMode;
    /**
     * @remarks
     * 最大堆叠大小。此值因物品类型
     * 而异。例如，火把的最大堆叠大小为
     * 64，而鸡蛋的最大堆叠大小为 16。
     *
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link InvalidContainerSlotError}
     */
    readonly maxAmount: number;
    /**
     * @remarks
     * 此物品堆的给定名称。悬停在物品上
     * 时会显示名称标签。将名称标签设置为
     * 空字符串或 `undefined` 将移除名称标签。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     * @throws
     * 如果槽位的容器无效则抛出异常。如果
     * 长度超过 255 个字符也会抛出异常。
     */
    nameTag?: string;
    /**
     * @remarks
     * 物品的类型。
     *
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link InvalidContainerSlotError}
     */
    readonly 'type': ItemType;
    /**
     * @remarks
     * 物品堆类型的标识符。如果未指定
     * 命名空间，则默认为 'minecraft:'。
     * 示例包括 'wheat' 或 'apple'。
     *
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link InvalidContainerSlotError}
     */
    readonly typeId: string;
    /**
     * @remarks
     * 清除已在此上设置的所有动态属性。
      * 数量。
     *
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link InvalidContainerSlotError}
     */
    clearDynamicProperties(): void;
    /**
     * @remarks
     * 返回此容器槽位中的物品是否

     * 可以被销毁。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidContainerSlotError}
     */
    getCanDestroy(): string[];
    /**
     * @remarks
     * 返回此容器槽位中的物品是否可以放置在上方。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidContainerSlotError}
     */
    getCanPlaceOn(): string[];
    /**
     * @remarks
     * 返回属性值。
    *
     *
     * @param ident
    *
     * ifier 属性标识符。
    *
     * @returns 返回属
    *
     * 性的值，如果属性尚未设置则返回 undefined。
    *
     * 
    *
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link InvalidContainerSlotError}
     */
    getDynamicProperty(identifier: string): boolean | number | string | Vector3 | undefined;
    /**
     * @remarks
     * 返回已在此物品堆上使用的可用动态
     * 属性标识符集。
     *
     * @returns 在此实体
    *
     * 上设置的动态属性字符串数组。
    *
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link InvalidContainerSlotError}
     */
    getDynamicPropertyIds(): string[];
    /**
     * @remarks
     * 返回所有动态属性的总大小（以字节
     * 当前为此实体存储的属性。此

     * 包括键和值的大小。这可以

     * 对于诊断性能警告信号很有用 -
     * 例如，如果实体有数兆字节的相关动态
     * 属性，则在各种设备上加载可能会很慢。
     *
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link InvalidContainerSlotError}
     */
    getDynamicPropertyTotalByteCount(): number;
    /**
     * @remarks
     * 创建物品堆的精确副本，包括任何
     * 自定义数据或属性。
     *
     * @returns
     * 返回槽位中物品的副本。如果槽位
     * 为空，则返回 undefined。
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link InvalidContainerSlotError}
     */
    getItem(): ItemStack | undefined;
    /**
     * @remarks
     * 返回 ItemStack 的 lore 值 -
     * 辅助显示字符串。
     *
     * @returns
     * 一个 lore 字符串数组。如果物品没有
     * lore，则返回一个空数组。
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link InvalidContainerSlotError}
     */
    getLore(): string[];
    /**
     * @remarks
     * 返回 ItemStack 的 lore 值 -
     * 辅助显示字符串。字符串形式的 lore
     * 行将被转换为 {@link RawMessage} 并放在
     *
     * @returns
     * 一个 lore 行数组。如果物品没有
     * lore，则返回一个空数组。
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidContainerSlotError}
     */
    getRawLore(): RawMessage[];
    /**
     * @remarks
     * 返回槽位中物品的所有标签。
     *
     * @returns
     * 返回槽位中物品的所有标签。如果
     * 槽位为空，则返回一个空数组。
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link InvalidContainerSlotError}
     */
    getTags(): string[];
    /**
     * @remarks
     * 如果此槽位有物品，则返回 true。

     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidContainerSlotError}
     */
    hasItem(): boolean;
    /**
     * @remarks
     * 返回槽位中的物品是否具有给定的标签。

     *
     * @param tag
     * 物品标签。
     * @returns
     * 当槽位为空或槽位中的物品不具

     * 有给定标签时，返回 false。
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link InvalidContainerSlotError}
     */
    hasTag(tag: string): boolean;
    /**
     * @remarks
     * 返回此物品堆是否可以与给定的

     * `itemStack` 堆叠。这是通过比较物品类型
     * 以及与物品堆相关的任何自定义数据和属性
     * 来确定的。每个物品堆的数量不被
     * 考虑在内。
     *
     * @param itemStack
     * 正在被比较的 ItemStack。
     * @returns
     * 返回此物品堆是否可以与给定的

     * `itemStack` 堆叠。
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link InvalidContainerSlotError}
     */
    isStackableWith(itemStack: ItemStack): boolean;
    /**
     * @remarks
     * 此物品在冒险模式下可以破坏的方块类型
     * 列表。方块名称将显示在物品的工具提示
     * 中。将值设置为 undefined 将清除列表。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param blockIdentifiers
     * 由其标识符指定的方块列表。
     * @throws
     * 如果槽位的容器无效则抛出异常。如果
     * 提供的任何方块标识符无效也会抛出异常。
     *
     * {@link Error}
     *
     * {@link InvalidContainerSlotError}
     */
    setCanDestroy(blockIdentifiers?: string[]): void;
    /**
     * @remarks
     * 此物品在冒险模式下可以放置在其上的方块
     * 类型列表。这仅适用于方块物品。方
     * 块名称将显示在物品的工具提示中。将
     * 值设置为 undefined 将清除列表。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param blockIdentifiers
     * 由其标识符指定的方块列表。
     * @throws
     * 如果槽位的容器无效则抛出异常。如果
     * 提供的任何方块标识符无效也会抛出异常。
     *
     * {@link Error}
     *
     * {@link InvalidContainerSlotError}
     */
    setCanPlaceOn(blockIdentifiers?: string[]): void;
    /**
     * @remarks
     * 设置多个具有特定值的动态属性。
    *
     *
     * @param value
    *
     * s 要设置的动态属性键值对记录。如果数据值为 n
    *
     * ull，则改为移除该属性。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link InvalidContainerSlotError}
     *
     * {@link minecraftcommon.UnsupportedFunctionalityError}
     */
    setDynamicProperties(values: Record<string, boolean | number | string | Vector3 | undefined>): void;
    /**
     * @remarks
     * 将指定属性设置为一个值。
    *
     *
     * @param ident
    *
     * ifier 属性标识符。
    *
     * @param value 要
    *
     * 设置的属性数据值。如果值为 null，则改为移除该属性。
    *
     * 
    *
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link InvalidContainerSlotError}
     *
     * {@link minecraftcommon.UnsupportedFunctionalityError}
     */
    setDynamicProperty(identifier: string, value?: boolean | number | string | Vector3): void;
    /**
     * @remarks
     * 在槽位中设置给定的 ItemStack，替换任何现有
      * 物品。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param itemStack
     * 要放置在槽位中的 ItemStack。
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link ContainerRulesError}
     *
     * {@link InvalidContainerSlotError}
     */
    setItem(itemStack?: ItemStack): void;
    /**
     * @remarks
     * 设置 ItemStack 的 lore 值 -
     * 辅助显示字符串。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param loreList
     * 一个 lore 字符串列表。将此参数设置为
     * undefined 将清除 lore。
     * @throws
     * 如果槽位的容器无效则抛出异常。
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link Error}
     *
     * {@link InvalidContainerSlotError}
     */
    setLore(loreList?: (RawMessage | string)[]): void;
}

/**
 * 关于命令来源的详细信息。
 */
export class CustomCommandOrigin {
    private constructor();
    /**
     * @remarks
     * 如果此命令是通过 NPC 发起的，则返回
     * 发起 NPC 对话的实体。
     *
     */
    readonly initiator?: Entity;
    /**
     * 如果此命令是通过方块（例如命令方块）
     * 触发的，则为源方块。
     *
     *
     */
    readonly sourceBlock?: Block;
    /**
     * 如果此命令是由实体（例如 NPC）触发
     * 的，则为源实体。
     *
     *
     */
    readonly sourceEntity?: Entity;
    /**
     * @remarks
     * 返回触发此命令的源类型。
     *
     */
    readonly sourceType: CustomCommandSource;
}

/**
 * 提供注册自定义命令的功能。
 */
export class CustomCommandRegistry {
    private constructor();
    /**
     * @remarks
     * 注册一个在執行时触发的自定义命令
     * 脚本回调。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 命令执行时触发的回调。
     * @throws 此函数可能会抛出错误。
     *
     * {@link CustomCommandError}
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link NamespaceNameError}
     */
    registerCommand(
        customCommand: CustomCommand,
        callback: (origin: CustomCommandOrigin, ...args: any[]) => CustomCommandResult | undefined,
    ): void;
    /**
     * @remarks
     * 注册一个自定义命令枚举。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link CustomCommandError}
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link NamespaceNameError}
     */
    registerEnum(name: string, values: string[]): void;
}

/**
 * 包含自定义组件的 JSON 参数
 */
export class CustomComponentParameters {
    private constructor();
    /**
     * @remarks
     * 包含来自自定义组件定义的参数的
     * JSON 对象
     *
     */
    readonly params: unknown;
}

/**
 * 检查战利品来源是否被特定类型的实体
 * 伤害的战利品物品条件。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class DamagedByEntityCondition extends LootItemCondition {
    private constructor();
    /**
     * @remarks
 * 此条件通过所需的实体类型。
     *
     */
    readonly entityType: string;
}

/**
 * 包含与数据驱动实体事件触发相关的信息
 * - 例如，鸡上的 minecraft:ageable_grow_up
 * 事件。
 */
export class DataDrivenEntityTriggerAfterEvent {
    private constructor();
    /**
     * @remarks
 * 事件触发的实体。
     *
     */
    readonly entity: Entity;
    /**
     * @remarks
 * 正在触发的数据驱动事件的
 * 名称。
     */
    readonly eventId: string;
    /**
     * @remarks
 * 组件状态修改的可更新列表，这些
 * 是此触发事件的效果。
     *
     */
    getModifiers(): DefinitionModifier[];
}

/**
 * 包含与数据驱动实体事件触发相关的事件
 * 注册 - 例如，鸡上的
 * minecraft:ageable_grow_up 事件。
 */
export class DataDrivenEntityTriggerAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个将在数据驱动实体事件被触发后
     * 调用的回调函数。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: DataDrivenEntityTriggerAfterEvent) => void,
        options?: EntityDataDrivenTriggerEventOptions,
    ): (arg0: DataDrivenEntityTriggerAfterEvent) => void;
    /**
     * @remarks
     * 移除一个将在数据驱动实体事件被触发后
     * 调用的回调函数。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: DataDrivenEntityTriggerAfterEvent) => void): void;
}

/**
 * 代表世界中特定维度（例如
 * 末地）的类。
 */
export class Dimension {
    private constructor();
    /**
     * @remarks
 * 维度的高度范围。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly heightRange: minecraftcommon.NumberRange;
    /**
     * @remarks
 * 维度的标识符。
     *
     */
    readonly id: string;
    /**
     * @remarks
 * 语言文件使用的维度名称
 * 本地化键。
     *
     */
    readonly localizationKey: string;
    /**
     * @remarks
 * 检查一个区域是否包含指定的生物群系。如果区域
 * 部分位于世界边界内，则仅搜索边界内的
 * 部分。此操作的耗时与体积的面积和
 * 要检查的生物群系数量成比例。
     *
     *
     * @param volume
 * 要检查生物群系的区域。
     * @param biomeFilter
 * 要包含和排除的生物群系列表。要包含和排除的
 * 标签列表。如果在区域内找到的生物群系位于排除
 * 列表中或包含任何排除的标签，则返回 false。
     *
     * @param isSuperset
 * Superset 用于确定过滤器的严格程度。
 * 如果 superset 设置为 true，则区域必须包含
 * 包含列表中的一个或多个生物群系，或包含所有
 * 包含的标签。如果 superset 设置为 false，
 * 则区域必须仅包含包含列表中的生物群系，
 * 并且包含所有包含的标签
     * @returns
     * 如果区域中的生物群系符合传入的过滤器设置

     * 则返回 true。否则返回 false。
     * @throws
     * 如果提供的区域包含未加载的区块，将抛出错误。
     * 如果提供的区域完全位于世界边界之外，
     * 将抛出错误。
     * 如果提供了未知的生物群系名称，
     * 将抛出错误。
     *
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     *
     * {@link UnloadedChunksError}
     */
    containsBiomes(volume: BlockVolumeBase, biomeFilter: BiomeFilter, isSuperset: boolean): boolean;
    /**
     * @remarks
     * 搜索方块体积中满足方块过滤器的
     * 方块。
     *
     * @param volume
     * 将检查的方块体积。
     * @param filter
     * 将针对体积中每个方块进行检查的
     * 方块过滤器。
     * 如果设置为 true，当方块体积的部分或全部位
     * 于已加载区块之外时，将抑制 UnloadedChunksError。
     * 仅检查体积中位于已加载区块内的方块位置。
     * 默认值：false
     *
     * 默认值：false
     * @returns
     * 如果体积中至少有一个方块满足过滤器，

     * 则返回 true，否则返回 false。
     * @throws 此函数可能会抛出错误。
     *
     * {@link Error}
     *
     * {@link UnloadedChunksError}
     */
    containsBlock(volume: BlockVolumeBase, filter: BlockFilter, allowUnloadedChunks?: boolean): boolean;
    /**
     * @remarks
     * 在指定位置创建爆炸。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param location
     * 爆炸的位置。
     * @param radius
     * 要创建的爆炸半径（以方块为单位）。
     * 范围：[0, 1000]
     * @param explosionOptions
     * 爆炸的附加可配置选项。
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     * @example createExplosion.ts
     * ```typescript
     * import { DimensionLocation } from "@minecraft/server";
     *
     * function createExplosion(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
     *   log("Creating an explosion of radius 10.");
     *   targetLocation.dimension.createExplosion(targetLocation, 10);
     * }
     * ```
     * @example createNoBlockExplosion.ts
     * ```typescript
     * import { DimensionLocation } from "@minecraft/server";
     * import { Vector3Utils } from "@minecraft/math";
     *
     * function createNoBlockExplosion(
     *   log: (message: string, status?: number) => void,
     *   targetLocation: DimensionLocation
     * ) {
     *   const explodeNoBlocksLoc = Vector3Utils.floor(Vector3Utils.add(targetLocation, { x: 1, y: 2, z: 1 }));
     *
     *   log("Creating an explosion of radius 15 that does not break blocks.");
     *   targetLocation.dimension.createExplosion(explodeNoBlocksLoc, 15, { breaksBlocks: false });
     * }
     * ```
     * @example createExplosions.ts
     * ```typescript
     * import { DimensionLocation } from "@minecraft/server";
     * import { Vector3Utils } from "@minecraft/math";
     *
     * function createExplosions(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
     *   const explosionLoc = Vector3Utils.add(targetLocation, { x: 0.5, y: 0.5, z: 0.5 });
     *
     *   log("Creating an explosion of radius 15 that causes fire.");
     *   targetLocation.dimension.createExplosion(explosionLoc, 15, { causesFire: true });
     *
     *   const belowWaterLoc = Vector3Utils.add(targetLocation, { x: 3, y: 1, z: 3 });
     *
     *   log("Creating an explosion of radius 10 that can go underwater.");
     *   targetLocation.dimension.createExplosion(belowWaterLoc, 10, { allowUnderwater: true });
     * }
     * ```
     */
    createExplosion(location: Vector3, radius: number, explosionOptions?: ExplosionOptions): boolean;
    /**
     * @remarks
     * 用特定的方块类型填充一个区域的方块。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param volume
     * 要填充的方块体积。
     * @param block
     * 用于填充体积的方块类型。
     * @param options
     * 一组附加选项，例如可用于在填充中
     * 包含/排除特定方块的方块过滤器。
     * 填充。
     * @returns
     * 返回包含所有已放置方块的
     * ListBlockVolume。
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link Error}
     *
     * {@link UnloadedChunksError}
     */
    fillBlocks(
        volume: BlockVolumeBase,
        block: BlockPermutation | BlockType | string,
        options?: BlockFillOptions,
    ): ListBlockVolume;
    /**
     * @remarks
     * 返回指定位置的生物群系类型。
     *
     * @param location
     * 要检查生物群系的位置。
     * @throws
     * 如果位置超出世界边界，将抛出错误。
     * 如果位置位于未加载的区块中，
     * 将抛出错误。
     *
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    getBiome(location: Vector3): BiomeType;
    /**
     * @remarks
     * 返回给定位置的方块实例。
     *
     * @param location
     * 要返回方块的位置。
     * @returns
     * 指定位置的方块，如果请求的方块位于
     * 未加载的区块中，则返回 'undefined'。
     * @throws
     * PositionInUnloadedChunkError：当尝试与不再处于已加载和
     * 进行 tick 的区块中的 Block 对象交互时抛出的异常。
     *
     *
     * PositionOutOfWorldBoundariesError：当尝试与超出
     * 维度高度范围的位置交互时抛出的异常。
     *
     *
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    getBlock(location: Vector3): Block | undefined;
    /**
     * @remarks
     * 获取给定方块位置上方找到的第一个方块，
     * 基于给定的选项（默认将找到上方的第一个
     * 固体方块）。
     *
     * @param location
     * 要从中检索上方方块的位置。
     * @param options
     * 用于判断方块是否为有效结果的选项。
     * @throws 此函数可能会抛出错误。
     */
    getBlockAbove(location: Vector3, options?: BlockRaycastOptions): Block | undefined;
    /**
     * @remarks
     * 获取给定方块位置下方找到的第一个方块，
     * 基于给定的选项（默认将找到下方的第一个
     * 固体方块）。
     *
     * @param location
     * 要从中检索下方方块的位置。
     * @param options
     * 用于判断方块是否为有效结果的选项。
     * @throws 此函数可能会抛出错误。
     */
    getBlockBelow(location: Vector3, options?: BlockRaycastOptions): Block | undefined;
    /**
     * @remarks
     * 获取与从某个位置发出的向量相交的
     * 第一个方块
     *
     * @param location
     * 开始射线检查的位置。
     * @param direction
     * 投射射线的向量方向。
     * @param options
     * 处理此射线投射查询的附加选项。
     * @throws 此函数可能会抛出错误。
     */
    getBlockFromRay(location: Vector3, direction: Vector3, options?: BlockRaycastOptions): BlockRaycastHit | undefined;
    /**
     * @remarks
     * 获取体积中满足过滤器的所有方块。
     *
     * @param volume
     * 将检查的方块体积。
     * @param filter
     * 将针对体积中每个方块进行检查的
     * 方块过滤器。
     * @param allowUnloadedChunks
     * 如果设置为 true，当方块体积的部分或全部位
     * 于已加载区块之外时，将抑制 UnloadedChunksError。
     * 仅检查体积中位于已加载区块内的方块位置。
     * 默认值：false
     * 默认值：false
     * @returns
     * 返回包含所有满足方块过滤器的方块位置
     * 的 ListBlockVolume。
     * @throws 此函数可能会抛出错误。
     *
     * {@link Error}
     *
     * {@link UnloadedChunksError}
     */
    getBlocks(volume: BlockVolumeBase, filter: BlockFilter, allowUnloadedChunks?: boolean): ListBlockVolume;
    /**
     * @remarks
     * 返回基于通过 EntityQueryOptions 过滤器条件集
     * 定义的一组条件的实体集合。
     *
     * @param options
     * 可用于过滤返回的实体集合的
     * 附加选项。
     * @returns
     * 一个实体数组。
     * @throws 此函数可能会抛出错误。
     *
     * {@link CommandError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     * @example bounceSkeletons.ts
     * ```typescript
     * import { EntityQueryOptions, DimensionLocation } from "@minecraft/server";
     *
     * function bounceSkeletons(targetLocation: DimensionLocation) {
     *   const mobs = ["creeper", "skeleton", "sheep"];
     *
     * // 创建一些示例生物数据 for (let i = 0; 
    *
     * i < 10; i++) { targetLocation.dimension.spawnEntity(mobs[i % 
    *
     * mobs.length], targetLocation); }
    *
     * 
    *
     *
     *   const eqo: EntityQueryOptions = {
     *     type: "skeleton",
     *   };
     *
     *   for (const entity of targetLocation.dimension.getEntities(eqo)) {
     *     entity.applyKnockback(0, 0, 0, 1);
     *   }
     * }
     * ```
     * @example tagsQuery.ts
     * ```typescript
     * import { EntityQueryOptions, DimensionLocation } from "@minecraft/server";
     *
     * function tagsQuery(targetLocation: DimensionLocation) {
     *   const mobs = ["creeper", "skeleton", "sheep"];
     *
     * // 创建一些示例生物数据 for (let i = 0; i < 
    *
     * 10; i++) { const mobTypeId = mobs[i % mobs.length]; const entity = ta
    *
     * rgetLocation.dimension.spawnEntity(mobTypeId, targetLocation); entity.addTag("mobparty." + mobTypeId); 
    *
     * }
    *
     * 
    *
     * 
    *
     *
     *   const eqo: EntityQueryOptions = {
     *     tags: ["mobparty.skeleton"],
     *   };
     *
     *   for (const entity of targetLocation.dimension.getEntities(eqo)) {
     *     entity.kill();
     *   }
     * }
     * ```
     * @example testThatEntityIsFeatherItem.ts
     * ```typescript
     * import { EntityItemComponent, EntityComponentTypes, DimensionLocation } from "@minecraft/server";
     *
     * function testThatEntityIsFeatherItem(
     *   log: (message: string, status?: number) => void,
     *   targetLocation: DimensionLocation
     * ) {
     *   const items = targetLocation.dimension.getEntities({
     *     location: targetLocation,
     *     maxDistance: 20,
     *   });
     *
     *   for (const item of items) {
     *     const itemComp = item.getComponent(EntityComponentTypes.Item) as EntityItemComponent;
     *
     *     if (itemComp) {
     *       if (itemComp.itemStack.typeId.endsWith("feather")) {
     *         log("Success! Found a feather", 1);
     *       }
     *     }
     *   }
     * }
     * ```
     */
    getEntities(options?: EntityQueryOptions): Entity[];
    /**
     * @remarks
     * 返回特定位置的实体集合。
     *
     * @param location
     * 要返回实体的位置。
     * @returns
     * 指定位置的零个或多个实体。
     */
    getEntitiesAtBlockLocation(location: Vector3): Entity[];
    /**
     * @remarks
     * 获取与从某个位置发出的指定向量相交的
     * 实体。
     *
     * @param options
     * 处理此射线投射查询的附加选项。
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidEntityError}
     *
     * {@link minecraftcommon.UnsupportedFunctionalityError}
     */
    getEntitiesFromRay(location: Vector3, direction: Vector3, options?: EntityRaycastOptions): EntityRaycastHit[];
    /**
     * @remarks
     * 返回照射在某个方块位置上的光的
     * 总亮度级别。
     *
     * @param location
     * 我们要检查亮度的方块的位置。
     * @returns
     * 方块上的亮度级别。
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link LocationInUnloadedChunkError}
     */
    getLightLevel(location: Vector3): number;
    /**
     * @remarks
     * 返回基于通过 EntityQueryOptions 过滤器条件集
     * 定义的一组条件的玩家集合。
     *
     * @param options
     * 可用于过滤返回的玩家集合的
     * 附加选项。
     * @returns
     * 一个玩家数组。
     * @throws 此函数可能会抛出错误。
     *
     * {@link CommandError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     */
    getPlayers(options?: EntityQueryOptions): Player[];
    /**
     * @remarks
     * 返回从天空照射在某个方块位置上的
     * 光的亮度级别。
     *
     * @param location
     * 我们要检查亮度的方块的位置。
     * @returns
     * 方块上的亮度级别。
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link LocationInUnloadedChunkError}
     */
    getSkyLightLevel(location: Vector3): number;
    /**
     * @remarks
     * 返回给定 XZ 位置的最高的方块。
     *
     * @param locationXZ
     * 要检索最顶部方块的位置。
     * @param minHeight
     * 开始搜索的 Y 高度。默认为
     * 最大维度高度。
     * @throws 此函数可能会抛出错误。
     */
    getTopmostBlock(locationXZ: VectorXZ, minHeight?: number): Block | undefined;
    /**
     * @remarks
     * 如果给定位置的区块已加载（且可用于

     * 脚本编写）则返回 true。
     *
     * @param location
     * 要检查区块是否已加载的位置。
     */
    isChunkLoaded(location: Vector3): boolean;
    /**
     * @remarks
     * 将给定的特征放置到维度中的指定位置。
     * 
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param featureName
     * 特征字符串标识符。
     * @param location
     * 放置特征的位置。
     * @param shouldThrow
     * 指定如果特征无法放置，函数调用是否会抛出错误。
     * 注意：如果使用未知的特征名称或尝试在未加载的
     * 区块中放置，函数调用将始终抛出错误。
     * 默认值：false
     *
     * 默认值：false
     * @throws
     * 如果特征名称无效，将抛出错误。
     * 如果位置位于未加载的区块中，
     * 将抛出错误。
     *
     * {@link Error}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link LocationInUnloadedChunkError}
     */
    placeFeature(featureName: string, location: Vector3, shouldThrow?: boolean): boolean;
    /**
     * @remarks
     * 将给定的特征规则放置到维度中的
     * 指定位置。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param featureRuleName
     * 特征规则的字符串标识符。
     * @param location
     * 放置特征规则的位置。
     * @throws
     * 如果特征规则名称无效，将抛出错误。
     * 如果位置位于未加载的区块中，
     * 将抛出错误。
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link LocationInUnloadedChunkError}
     */
    placeFeatureRule(featureRuleName: string, location: Vector3): boolean;
    /**
     * @remarks
     * 为所有玩家播放声音。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param soundId
     * 声音的标识符。
     * @param location
     * 声音的位置。
     * @param soundOptions
     * 用于配置声音附加效果的
     * 附加选项。
     * @throws
     * 如果音量小于 0.0 将抛出错误。
     * 如果淡入淡出值小于 0.0，将抛出错误。
     * 如果音高小于 0.01，将抛出错误。
     * 如果音量小于 0.0 将抛出错误。
     *
     * {@link minecraftcommon.PropertyOutOfBoundsError}
     */
    playSound(soundId: string, location: Vector3, soundOptions?: WorldSoundOptions): void;
    /**
     * @remarks
     * 使用更广泛维度的上下文同步运行
     * 命令。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param commandString
     * 要运行的命令。注意，命令字符串不应
     * 以斜杠开头。
     * @returns
     * 返回一个命令结果，其中包含命令成功
     * 执行的数量。
     * @throws
     * 如果命令因参数或命令语法错误而失败，或在命令
     * 的错误情况下，将抛出异常。注意，在许多情况下，
     * 如果命令未执行（例如，目标选择器未找到匹配项），
     * 此方法不会抛出异常。
     *
     *
     * {@link CommandError}
     */
    runCommand(commandString: string): CommandResult;
    /**
     * @remarks
     * 使用 BlockPermutation 在世界中设置方块。
     * BlockPermutation 是具有特定状态的方块。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param location
     * 维度内设置方块的位置。
     * @param permutation
     * 要设置的方块排列。
     * @throws
     * 如果位置位于未加载的区块中或
     * 超出世界边界，则抛出异常。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    setBlockPermutation(location: Vector3, permutation: BlockPermutation): void;
    /**
     * @remarks
     * 在维度内的给定位置设置方块。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param location
     * 维度内设置方块的位置。
     * @param blockType
     * 要设置的方块类型。可以是字符串标识符
     * 或 BlockType。使用默认的方块排列。
     *
     * @throws
     * 如果位置位于未加载的区块中或
     * 超出世界边界，则抛出异常。
     *
     * {@link Error}
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    setBlockType(location: Vector3, blockType: BlockType | string): void;
    /**
     * @remarks
     * 设置维度内的当前天气。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param weatherType
     * 设置要应用的天气类型。
     * @param duration
     * 设置天气的持续时间（以 tick 为单位）。如果未提供
     * 持续时间，则持续时间将设置为 300 到 900 秒之间
     * 的随机持续时间。
     * 范围：[1, 1000000]
     * @throws 此函数可能会抛出错误。
     */
    setWeather(weatherType: WeatherType, duration?: number): void;
    /**
     * @remarks
     * 在指定位置创建新实体（例如生物）。
     * 
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param identifier
     * 要生成的实体类型的标识符。如果
     * 未指定命名空间，则默认为 'minecraft:'。
     * @param location
     * 创建实体的位置。
     * @returns
     * 在指定位置新创建的实体。
     * @throws 此函数可能会抛出错误。
     *
     * {@link EntitySpawnError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidEntityError}
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     * @example spawnAdultHorse.ts
     * ```typescript
     * import { DimensionLocation } from '@minecraft/server';
     * import { Vector3Utils } from '@minecraft/math';
     *
     * function spawnAdultHorse(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
     *     log('Create a horse and triggering the ageable_grow_up event, ensuring the horse is created as an adult');
     *     targetLocation.dimension.spawnEntity(
     *         'minecraft:horse<minecraft:ageable_grow_up>',
     *         Vector3Utils.add(targetLocation, { x: 0, y: 1, z: 0 })
     *     );
     * }
     * ```
     * @example quickFoxLazyDog.ts
     * ```typescript
     * import { DimensionLocation } from "@minecraft/server";
     * import { MinecraftEntityTypes, MinecraftEffectTypes } from "@minecraft/vanilla-data";
     *
     * function quickFoxLazyDog(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
     *   const fox = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Fox, {
     *     x: targetLocation.x + 1,
     *     y: targetLocation.y + 2,
     *     z: targetLocation.z + 3,
     *   });
     *
     *   fox.addEffect(MinecraftEffectTypes.Speed, 10, {
     *     amplifier: 2,
     *   });
     *   log("Created a fox.");
     *
     *   const wolf = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Wolf, {
     *     x: targetLocation.x + 4,
     *     y: targetLocation.y + 2,
     *     z: targetLocation.z + 3,
     *   });
     *   wolf.addEffect(MinecraftEffectTypes.Slowness, 10, {
     *     amplifier: 2,
     *   });
     *   wolf.isSneaking = true;
     *   log("Created a sneaking wolf.", 1);
     * }
     * ```
     * @example triggerEvent.ts
     * ```typescript
     * import { DimensionLocation } from "@minecraft/server";
     * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
     *
     * function triggerEvent(targetLocation: DimensionLocation) {
     *   const creeper = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Creeper, targetLocation);
     *
     *   creeper.triggerEvent("minecraft:start_exploding_forced");
     * }
     * ```
     */
    spawnEntity(identifier: EntityType | string, location: Vector3, options?: SpawnEntityOptions): Entity;
    /**
     * @remarks
     * 在指定位置创建新的物品堆实体。
     * 
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param location
     * 创建物品堆的位置。
     * @returns
     * 在指定位置新创建的物品堆实体。
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     * @example itemStacks.ts
     * ```typescript
     * import { ItemStack, DimensionLocation } from "@minecraft/server";
     * import { MinecraftItemTypes } from "@minecraft/vanilla-data";
     *
     * function itemStacks(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
     *   const oneItemLoc = { x: targetLocation.x + targetLocation.y + 3, y: 2, z: targetLocation.z + 1 };
     *   const fiveItemsLoc = { x: targetLocation.x + 1, y: targetLocation.y + 2, z: targetLocation.z + 1 };
     *   const diamondPickaxeLoc = { x: targetLocation.x + 2, y: targetLocation.y + 2, z: targetLocation.z + 4 };
     *
     *   const oneEmerald = new ItemStack(MinecraftItemTypes.Emerald, 1);
     *   const onePickaxe = new ItemStack(MinecraftItemTypes.DiamondPickaxe, 1);
     *   const fiveEmeralds = new ItemStack(MinecraftItemTypes.Emerald, 5);
     *
     *   log(`Spawning an emerald at (${oneItemLoc.x}, ${oneItemLoc.y}, ${oneItemLoc.z})`);
     *   targetLocation.dimension.spawnItem(oneEmerald, oneItemLoc);
     *
     *   log(`Spawning five emeralds at (${fiveItemsLoc.x}, ${fiveItemsLoc.y}, ${fiveItemsLoc.z})`);
     *   targetLocation.dimension.spawnItem(fiveEmeralds, fiveItemsLoc);
     *
     *   log(`Spawning a diamond pickaxe at (${diamondPickaxeLoc.x}, ${diamondPickaxeLoc.y}, ${diamondPickaxeLoc.z})`);
     *   targetLocation.dimension.spawnItem(onePickaxe, diamondPickaxeLoc);
     * }
     * ```
     * @example spawnFeatherItem.ts
     * ```typescript
     * import { ItemStack, DimensionLocation } from "@minecraft/server";
     * import { MinecraftItemTypes } from "@minecraft/vanilla-data";
     *
     * function spawnFeatherItem(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
     *   const featherItem = new ItemStack(MinecraftItemTypes.Feather, 1);
     *
     *   targetLocation.dimension.spawnItem(featherItem, targetLocation);
     *   log(`New feather created at ${targetLocation.x}, ${targetLocation.y}, ${targetLocation.z}!`);
     * }
     * ```
     */
    spawnItem(itemStack: ItemStack, location: Vector3): Entity;
    /**
     * @remarks
     * 在世界中的指定位置创建新的粒子
     * 发射器。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param effectName
     * 要创建的粒子的标识符。
     * @param location
     * 创建粒子发射器的位置。
     * @param molangVariables
     * 一组可选的、可自定义的变量，可以
     * 为此粒子进行调整。
     * @throws 此函数可能会抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     * @example spawnParticle.ts
     * ```typescript
     * import { MolangVariableMap, DimensionLocation } from "@minecraft/server";
     *
     * function spawnParticle(targetLocation: DimensionLocation) {
     *   for (let i = 0; i < 100; i++) {
     *     const molang = new MolangVariableMap();
     *
     *     molang.setColorRGB("variable.color", { red: Math.random(), green: Math.random(), blue: Math.random() });
     *
     *     const newLocation = {
     *       x: targetLocation.x + Math.floor(Math.random() * 8) - 4,
     *       y: targetLocation.y + Math.floor(Math.random() * 8) - 4,
     *       z: targetLocation.z + Math.floor(Math.random() * 8) - 4,
     *     };
     *     targetLocation.dimension.spawnParticle("minecraft:colored_flame_particle", newLocation, molang);
     *   }
     * }
     * ```
     */
    spawnParticle(effectName: string, location: Vector3, molangVariables?: MolangVariableMap): void;
}

/**
 * 代表维度的类型。
 */
export class DimensionType {
    private constructor();
    /**
     * @remarks
     * 维度类型的标识符。
     *
     */
    readonly typeId: string;
}

/**
 * 用于访问所有可用维度类型。
 */
export class DimensionTypes {
    private constructor();
    /**
     * @remarks
     * 使用字符串标识符获取维度类型。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    static get(dimensionTypeId: string): DimensionType | undefined;
    /**
     * @remarks
     * 获取所有维度类型的数组。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    static getAll(): DimensionType[];
}

/**
 * 表示已添加到实体的效果 - 如中毒。
 */
export class Effect {
    private constructor();
    /**
     * @remarks
     * 获取可能已应用于此效果的放大器。
     * 示例值通常在 0 到 4 之间。例如：效果'跳跃提升 II'的放大器值为 1。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly amplifier: number;
    /**
     * @remarks
     * 获取此效果的玩家友好名称。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly displayName: string;
    /**
     * @remarks
     * 获取此效果的完整指定持续时间（以刻为单位）。
     * 每秒有 20 刻。使用 {@link
     * TicksPerSecond} 常量在刻和秒之间转换。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly duration: number;
    /**
     * @remarks
     * 返回效果实例是否可在此上下文中使用。
     *
     */
    readonly isValid: boolean;
    /**
     * @remarks
     * 获取此效果的类型 ID。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly typeId: string;
}

/**
 * 包含与效果（如中毒）相关的变更信息，这些效果正在被添加 到实体。
 */
export class EffectAddAfterEvent {
    private constructor();
    /**
     * @remarks
     * 效果的附加属性和详细信息。
     *
     */
    readonly effect: Effect;
    /**
     * @remarks
     * 正在添加效果的目标实体。
     *
     */
    readonly entity: Entity;
}

/**
 * 管理与效果添加到实体时相关的回调函数。
 */
export class EffectAddAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调函数，当效果被添加 到实体时调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: EffectAddAfterEvent) => void,
        options?: EntityEventOptions,
    ): (arg0: EffectAddAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调函数，使其不再在效果被添加 到实体时调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: EffectAddAfterEvent) => void): void;
}

/**
 * 包含与效果（如中毒）相关的变更信息，这些效果正在被添加 到实体。
 */
export class EffectAddBeforeEvent {
    private constructor();
    /**
     * @remarks
     * 设置为 true 时将取消事件。
     *
     */
    cancel: boolean;
    /**
     * @remarks
     * 效果持续时间。
     *
     */
    duration: number;
    /**
     * @remarks
     * 正在添加的效果类型。
     *
     */
    readonly effectType: string;
    /**
     * @remarks
     * 正在添加效果的目标实体。
     *
     */
    readonly entity: Entity;
}

/**
  * 管理效果添加到实体时相关的回调。
 * 添加 到实体。
 */
export class EffectAddBeforeEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调函数，当效果被添加 到实体时调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     * @returns
     * 在受限执行权限下调用的闭包。
     */
    subscribe(callback: (arg0: EffectAddBeforeEvent) => void): (arg0: EffectAddBeforeEvent) => void;
    /**
     * @remarks
     * 移除一个回调函数，使其不再在效果被添加 到实体时调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     */
    unsubscribe(callback: (arg0: EffectAddBeforeEvent) => void): void;
}

/**
 * 表示一种可以被应用 到实体的效果类型 - 如中毒。
 */
export class EffectType {
    private constructor();
    /**
     * @remarks
     * 此效果类型的标识符名称。
     *
     * @returns
     * 效果类型的标识符。
     */
    getName(): string;
}

/**
 * 表示一种可以被应用 到实体的效果类型 - 如中毒。
 */
export class EffectTypes {
    private constructor();
    /**
     * @remarks
     * 给定标识符的效果类型。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param identifier
     * 效果的标识符。
     * @returns
     * 给定标识符的效果类型，如果效果不存在则返回 undefined。

     */
    static get(identifier: string): EffectType | undefined;
    /**
     * @remarks
     * 获取所有效果。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @returns
     * 所有效果的列表。
     */
    static getAll(): EffectType[];
}

/**
 * 表示战利品池中的完全空条目。如果选择此条目，则不会掉落任何物品。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EmptyLootItem extends LootPoolEntry {
    private constructor();
}

export class EnchantInfo {
    private constructor();
    readonly enchantment: string;
    readonly range: minecraftcommon.NumberRange;
}

/**
 * 包含某一类附魔的信息。
 */
export class EnchantmentType {
    /**
     * @remarks
     * 附魔类型的名称。
     *
     */
    readonly id: string;
    /**
     * @remarks
     * 此类附魔可拥有的最大等级。
     *
     */
    readonly maxLevel: number;
    /**
     * @throws 此函数可能会抛出错误。
     */
    constructor(enchantmentType: string);
}

/**
 * 包含此世界中可用的 Minecraft 附魔类型目录。
 */
export class EnchantmentTypes {
    private constructor();
    /**
     * @remarks
     * 使用指定标识符获取附魔。
     *
     * @param enchantmentId
     * 附魔的标识符。例如，
     * "minecraft:flame"。
     * @returns
     * 如果可用，返回一个表示指定附魔的 EnchantmentType 对象。
     */
    static get(enchantmentId: string): EnchantmentType | undefined;
    /**
     * @remarks
     * 返回所有可用附魔类型的集合。
     *
     */
    static getAll(): EnchantmentType[];
}

/**
 * 战利品物品函数，使用与附魔装备相同的算法
 * 为掉落的物品随机应用附魔，就像原版生物生成的装备一样。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EnchantRandomEquipmentFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 决定装备被附魔时可能性的值。
      * 附魔时。
     *
     */
    readonly chance: number;
}

/**
 * 战利品物品函数，随机附魔掉落的物品。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EnchantRandomlyFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 决定在随机选择的附魔中是否包含宝藏附魔。
     *
     */
    readonly treasure: boolean;
}

/**
 * 战利品物品函数，为掉落的物品随机应用附魔。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EnchantWithLevelsFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 函数随机选择应用附魔等级的值范围。包含最小值和最大值。
     *
     */
    readonly levels: minecraftcommon.NumberRange;
    /**
     * @remarks
     * 决定在随机附魔选择中是否应包含宝藏附魔的值。
     *
     */
    readonly treasure: boolean;
}

/**
  * 表示世界中实体（生物、玩家或其他移动物体如矿车）的状态。
 * 其他移动物体如矿车）在世界中。
 */
export class Entity {
    private constructor();
    /**
     * @remarks
     * 实体当前所在的维度。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link InvalidEntityError}
     */
    readonly dimension: Dimension;
    /**
     * @remarks
     * 实体的唯一标识符。此标识符旨在
     * 跨世界实例的加载保持一致。不应
     * 从此唯一标识符的值和结构中推断任何含义 -
     * 请勿解析或解释它。即使 {@link Entity.isValid} 为
     * false，此属性也可访问。
     *
     */
    readonly id: string;
    /**
     * @remarks
     * 实体是否接触可攀爬方块。例如，
     * 玩家旁边的梯子或蜘蛛旁边的石墙。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     */
    readonly isClimbing: boolean;
    /**
     * @remarks
     * 实体的坠落距离是否大于 0，或在滑翔时是否大于 1。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     */
    readonly isFalling: boolean;
    /**
     * @remarks
     * 实体的任何部分是否在水方块内。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     */
    readonly isInWater: boolean;
    /**
     * @remarks
     * 实体是否在实心方块顶部。此属性
     * 可能以意外的方式表现。当实体首次生成时，此属性始终为
     * true，如果实体没有重力，此属性可能不正确。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     */
    readonly isOnGround: boolean;
    /**
     * @remarks
     * 如果为 true，则实体当前正在睡觉。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     */
    readonly isSleeping: boolean;
    /**
     * @remarks
     * 实体是否正在潜行 - 即以更慢更安静的方式移动。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    isSneaking: boolean;
    /**
     * @remarks
     * 实体是否正在疾跑。例如，使用疾跑动作的玩家、
     * 逃跑的豹猫或使用胡萝卜钓竿加速的猪。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     */
    readonly isSprinting: boolean;
    /**
     * @remarks
     * 实体是否处于游泳状态。例如，使用游泳动作的玩家或水中的鱼。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     */
    readonly isSwimming: boolean;
    /**
     * @remarks
     * 返回实体是否可以被脚本操纵。当 Player 的
     *
     * EntityLifetimeState 设置为 Loaded 时，该玩家被视为有效。
     *
     */
    readonly isValid: boolean;
    /**
     * @remarks
     * 此实体名称在 .lang 文件中使用的本地化键

     * 文件。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     */
    readonly localizationKey: string;
    /**
     * @remarks
     * 实体的当前位置。

     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     */
    readonly location: Vector3;
    /**
     * @remarks
     * 实体的给定名称。

     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    nameTag: string;
    /**
     * @remarks
     * 返回表示此实体的记分板标识。

     * 当实体被杀死时仍将保持有效。

     *
     */
    readonly scoreboardIdentity?: ScoreboardIdentity;
    /**
     * @remarks
     * 实体的类型标识符 - 例如，
     * 'minecraft:skeleton'。即使

     * {@link Entity.isValid} 为 false。
     *
     */
    readonly typeId: string;
    /**
     * @remarks
     * 向实体添加或更新效果，如中毒。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param effectType
     * 要添加到实体的效果类型。

     * @param duration
     * 效果应用的时间量（以刻为单位）。
     * 每秒有 20 刻。使用 {@link TicksPerSecond} 常量在刻和秒之间转换。
     * 在 tick 和秒之间转换。值必须在

     * 范围 [0, 20000000].
     * 边界：[1, 20000000]
     * @param options
     * 效果的附加选项。

     * @returns
     * 如果效果已添加或更新，则不返回任何内容

     * 成功。如果持续时间或

     * amplifier 超出有效范围，或效果
     * 不存在。

     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidEntityError}
     * @example spawnPoisonedVillager.ts
     * ```typescript
     * import { DimensionLocation } from "@minecraft/server";
     * import { MinecraftEffectTypes } from "@minecraft/vanilla-data";
     *
     * function spawnPoisonedVillager(
     *     targetLocation: DimensionLocation
     * ) {
     *   const villagerType = "minecraft:villager_v2<minecraft:ageable_grow_up>";
     *   const villager = targetLocation.dimension.spawnEntity(villagerType, targetLocation);
     *   const duration = 20;
     *
     *   villager.addEffect(MinecraftEffectTypes.Poison, duration, { amplifier: 1 });
     * }
     * ```
     * @example quickFoxLazyDog.ts
     * ```typescript
     * import { DimensionLocation } from "@minecraft/server";
     * import { MinecraftEntityTypes, MinecraftEffectTypes } from "@minecraft/vanilla-data";
     *
     * function quickFoxLazyDog(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
     *   const fox = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Fox, {
     *     x: targetLocation.x + 1,
     *     y: targetLocation.y + 2,
     *     z: targetLocation.z + 3,
     *   });
     *
     *   fox.addEffect(MinecraftEffectTypes.Speed, 10, {
     *     amplifier: 2,
     *   });
     *   log("Created a fox.");
     *
     *   const wolf = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Wolf, {
     *     x: targetLocation.x + 4,
     *     y: targetLocation.y + 2,
     *     z: targetLocation.z + 3,
     *   });
     *   wolf.addEffect(MinecraftEffectTypes.Slowness, 10, {
     *     amplifier: 2,
     *   });
     *   wolf.isSneaking = true;
     *   log("Created a sneaking wolf.", 1);
     * }
     * ```
     */
    addEffect(effectType: EffectType | string, duration: number, options?: EntityEffectOptions): Effect | undefined;
    /**
     * @remarks
     * 向实体添加指定的标签。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param tag 要
    *
     * 添加的标签内容。标签长度必须少于 256 个字符。
    *
     * 
    *
     * @returns 如果标签添
    *
     * 加成功则返回 true。如果标签已存在于实体上，则可能失败。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link InvalidEntityError}
     * @example tagsQuery.ts
     * ```typescript
     * import { EntityQueryOptions, DimensionLocation } from "@minecraft/server";
     *
     * function tagsQuery(targetLocation: DimensionLocation) {
     *   const mobs = ["creeper", "skeleton", "sheep"];
     *
     * // 创建一些示例生物数据 for (let i = 0; i < 
    *
     * 10; i++) { const mobTypeId = mobs[i % mobs.length]; const entity = ta
    *
     * rgetLocation.dimension.spawnEntity(mobTypeId, targetLocation); entity.addTag("mobparty." + mobTypeId); 
    *
     * }
    *
     * 
    *
     * 
    *
     *
     *   const eqo: EntityQueryOptions = {
     *     tags: ["mobparty.skeleton"],
     *   };
     *
     *   for (const entity of targetLocation.dimension.getEntities(eqo)) {
     *     entity.kill();
     *   }
     * }
     * ```
     */
    addTag(tag: string): boolean;
    /**
     * @remarks
     * 向实体施加一组伤害。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param amou
    *
     * nt 要施加的伤害量。
    *
     * @param optio
    *
     * ns 关于伤害来源的附加选项，可能会对此实体添加
    *
     * 额外效果或触发额外行为。
    *
     * 
    *
     * @returns 实体是
    *
     * 否受到任何伤害。如果实体无敌或施加的伤害小于等于 0，
    *
     * 则可能返回 false。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link InvalidEntityError}
     *
     * {@link minecraftcommon.UnsupportedFunctionalityError}
     * @example applyDamageThenHeal.ts
     * ```typescript
     * import { system, EntityHealthComponent, EntityComponentTypes, DimensionLocation } from "@minecraft/server";
     * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
     *
     * function applyDamageThenHeal(
     *   log: (message: string, status?: number) => void,
     *   targetLocation: DimensionLocation
     * ) {
     *   const skelly = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Skeleton, targetLocation);
     *
     *   skelly.applyDamage(19); // 骷髅的最大生命值为 20，所以这是一个濒死的骷髅
    *
     *
     *   system.runTimeout(() => {
     *     const health = skelly.getComponent(EntityComponentTypes.Health) as EntityHealthComponent;
     *     log("Skeleton health before heal: " + health?.currentValue);
     *     health?.resetToMaxValue();
     *     log("Skeleton health after heal: " + health?.currentValue);
     *   }, 20);
     * }
     * ```
     */
    applyDamage(amount: number, options?: EntityApplyDamageByProjectileOptions | EntityApplyDamageOptions): boolean;
    /**
     * @remarks
     * 将冲量向量应用于
    *
     * 实体的当前速度。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param ve
    *
     * ctor 冲量向量。
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link InvalidEntityError}
     * @example applyImpulse.ts
     * ```typescript
     * import { DimensionLocation } from "@minecraft/server";
     * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
     *
     * function applyImpulse(targetLocation: DimensionLocation) {
     *   const zombie = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Zombie, targetLocation);
     *
     *   zombie.clearVelocity();
     *
     * // 将僵尸抛向空中 zombie.a
    *
     * pplyImpulse({ x: 0, y: 0.5, z: 0 }); }
    *
     * 
    *
     * ```
     */
    applyImpulse(vector: Vector3): void;
    /**
     * @remarks
     * 将冲量向量应用于
    *
     * 实体的当前速度。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param verticalSt
    *
     * rength 垂直向量的击退强度。
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     *
     * {@link minecraftcommon.UnsupportedFunctionalityError}
     * @example bounceSkeletons.ts
     * ```typescript
     * import { EntityQueryOptions, DimensionLocation } from "@minecraft/server";
     *
     * function bounceSkeletons(targetLocation: DimensionLocation) {
     *   const mobs = ["creeper", "skeleton", "sheep"];
     *
     * // 创建一些示例生物数据 for (let i = 0; 
    *
     * i < 10; i++) { targetLocation.dimension.spawnEntity(mobs[i % 
    *
     * mobs.length], targetLocation); }
    *
     * 
    *
     *
     *   const eqo: EntityQueryOptions = {
     *     type: "skeleton",
     *   };
     *
     *   for (const entity of targetLocation.dimension.getEntities(eqo)) {
     *     entity.applyKnockback(0, 0, 0, 1);
     *   }
     * }
     * ```
     */
    applyKnockback(horizontalForce: VectorXZ, verticalStrength: number): void;
    /**
     * @remarks
     * 清除已在此实体上设
    *
     * 置的所有动态属性。
    *
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    clearDynamicProperties(): void;
    /**
     * @remarks
     * 将实体的当前速度设置为零。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     * @example applyImpulse.ts
     * ```typescript
     * import { DimensionLocation } from "@minecraft/server";
     * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
     *
     * function applyImpulse(targetLocation: DimensionLocation) {
     *   const zombie = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Zombie, targetLocation);
     *
     *   zombie.clearVelocity();
     *
     * // 将僵尸抛向空中 zombie.a
    *
     * pplyImpulse({ x: 0, y: 0.5, z: 0 }); }
    *
     * 
    *
     * ```
     */
    clearVelocity(): void;
    /**
     * @remarks
     * 如果实体着火则灭火。请注意，您可以调用 get
    *
     * Component('minecraft:onfire')，如果存在该组件，则表示实体着火。
    *
     * 
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param useE
    *
     * ffects 是否显示与灭火相关的任何视觉效果。
    *
     *  默认值：true
    *
     * 
    *
     * @returns 
    *
     * 返回实体是否曾着火。
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     * @example setOnFire.ts
     * ```typescript
     * import { system, EntityOnFireComponent, EntityComponentTypes, DimensionLocation } from "@minecraft/server";
     * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
     *
     * function setOnFire(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
     *   const skelly = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Skeleton, targetLocation);
     *
     *   skelly.setOnFire(20, true);
     *
     *   system.runTimeout(() => {
     *     const onfire = skelly.getComponent(EntityComponentTypes.OnFire) as EntityOnFireComponent;
     *     log(onfire?.onFireTicksRemaining + " fire ticks remaining.");
     *
     *     skelly.extinguishFire(true);
     *     log("Never mind. Fire extinguished.");
     *   }, 20);
     * }
     * ```
     */
    extinguishFire(useEffects?: boolean): boolean;
    /**
     * @remarks
     * 获取实体的碰撞边界。
    *
     *
     * @returns 
    *
     * 一个轴对齐的包围盒。
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getAABB(): AABB;
    /**
     * @remarks
     * 获取此实体直接站立的
    *
     * 实心方块。忽略压力板。
    *
     *
     * @param opt
    *
     * ions 关于返回哪些方块的附加配置选项。
    *
     * 
    *
     * @returns 此实体直
    *
     * 接站立的实心方块。如果实体在跳跃或飞行，则返回空列表。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getAllBlocksStandingOn(options?: GetBlocksStandingOnOptions): Block[];
    /**
     * @remarks
     * 从实体视线方向返回
    *
     * 第一个相交的方块。
    *
     *
     * @param option
    *
     * s 射线投射的附加配置选项。
    *
     * @returns 
    *
     * 从实体视线方向返回第一个相交的方块。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getBlockFromViewDirection(options?: BlockRaycastOptions): BlockRaycastHit | undefined;
    /**
     * @remarks
     * 获取距离实体中心最近
    *
     * 且此实体直接站立的单个实心方块。忽略压力板。
    *
     * 
    *
     *
     * @param options 
    *
     * 关于返回哪个方块的附加配置选项。
    *
     * @returns 距离实体中
    *
     * 心最近且此实体直接站立的单个实心方块。如果实体在飞行或跳跃，
    *
     * 则为 Undefined。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getBlockStandingOn(options?: GetBlocksStandingOnOptions): Block | undefined;
    /**
     * @remarks
     * 获取实体的组件（
    *
     * 表示附加能力）。
    *
     *
     * @param componentId
     * 组件的标识符（例如，'minecraft:health'）。
     * 如果未指定命名空间前缀，则 'minecraft:' 被
     * 假定。可用的组件 ID 可在

     * {@link EntityComponentTypes} 枚举中找到。
     * @returns 如果组件
    *
     * 存在于实体上则返回该组件，否则返回 undefined。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getComponent<T extends string>(componentId: T): EntityComponentReturnType<T> | undefined;
    /**
     * @remarks
     * 返回此实体上存在
    *
     * 的所有脚本组件。
    *
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getComponents(): EntityComponent[];
    /**
     * @remarks
     * 返回属性值。
    *
     *
     * @param ident
    *
     * ifier 属性标识符。
    *
     * @returns 返回属
    *
     * 性的值，如果属性尚未设置则返回 undefined。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getDynamicProperty(identifier: string): boolean | number | string | Vector3 | undefined;
    /**
     * @remarks
     * 返回已在此实体上使用
    *
     * 的动态属性标识符集合。
    *
     *
     * @returns 在此实体
    *
     * 上设置的动态属性字符串数组。
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getDynamicPropertyIds(): string[];
    /**
     * @remarks
     * 返回当前为此实体存储的所有动态属性的总大小（以字节为单位）。此
     *
     * 包括键和值的大小。这可以
     *
     * 用于诊断性能警告信号 - 例如，如果
     * 一个实体有数兆字节的相关动态
     * 属性，在不同设备上加载可能会很慢。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getDynamicPropertyTotalByteCount(): number;
    /**
     * @remarks
     * 返回实体上指定 EffectType 的效果，
    *
     * 如果效果不存在则返回 undefined，如果效果不存在则抛出错误。
    *
     * 
    *
     *
     * @param effec
    *
     * tType 效果标识符。
    *
     * @returns 指定效果
    *
     * 的效果对象，如果效果不存在则返回 undefined，
    *
     * 如果效果不存在则抛出错误。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidEntityError}
     */
    getEffect(effectType: EffectType | string): Effect | undefined;
    /**
     * @remarks
     * 返回应用于此实体的效果集合。
    *
     *
     * @return
    *
     * s 效果列表。
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getEffects(): Effect[];
    /**
     * @remarks
     * 通过从此实体的视角执行射线投射，
    *
     * 获取此实体正在注视的实体。
    *
     *
     * @param option
    *
     * s 射线投射的附加配置选项。
    *
     * @return
    *
     * s 从实体视线方向返回一组实体。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidEntityError}
     *
     * {@link minecraftcommon.UnsupportedFunctionalityError}
     */
    getEntitiesFromViewDirection(options?: EntityRaycastOptions): EntityRaycastHit[];
    /**
     * @remarks
     * 返回此实体的头部
    *
     * 组件的当前位置。
    *
     *
     * @returns
    *
     *  返回此实体的头部组件的当前位置。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getHeadLocation(): Vector3;
    /**
     * @remarks
     * 获取实体属性值。如果属性是通过

     * 同一 tick 中的 setProperty 函数设置的，更新后的值
     * 在后续 tick 之前不会反映更新后的值。

     *
     * @param identi
    *
     * fier 实体属性标识符。
    *
     * @returns 返回当前属性值。
    *
     * 对于枚举属性，返回字符串。对于浮点和整数属性，返回数字。
    *
     * 对于未定义的属性，返回 undefined。
    *
     * 
    *
     * 
    *
     * @throws
     * 如果实体无效则抛出错误。

     *
     * {@link InvalidEntityError}
     */
    getProperty(identifier: string): boolean | number | string | undefined;
    /**
     * @remarks
     * 返回此实体的当前旋转组件。
    *
     *
     * @returns 返
    *
     * 回包含此实体旋转（角度制）的 Vec2。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getRotation(): Vector2;
    /**
     * @remarks
     * 返回与此实体关联的所有标签。
    *
     *
     * @returns 包含
    *
     * 所有标签的字符串数组。
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getTags(): string[];
    /**
     * @remarks
     * 返回实体的当前速度向量。
    *
     *
     * @returns 返
    *
     * 回实体的当前速度向量。
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     * @example getFireworkVelocity.ts
     * ```typescript
     * import { system, DimensionLocation } from "@minecraft/server";
     * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
     *
     * function getFireworkVelocity(
     *   log: (message: string, status?: number) => void,
     *   targetLocation: DimensionLocation
     * ) {
     *   const fireworkRocket = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.FireworksRocket, targetLocation);
     *
     *   system.runTimeout(() => {
     *     const velocity = fireworkRocket.getVelocity();
     *
     *     log("Velocity of firework is: (x: " + velocity.x + ", y:" + velocity.y + ", z:" + velocity.z + ")");
     *   }, 5);
     * }
     * ```
     */
    getVelocity(): Vector3;
    /**
     * @remarks
     * 返回实体的当前视线方向。
    *
     *
     * @returns 返
    *
     * 回实体的当前视线方向。
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getViewDirection(): Vector3;
    /**
     * @remarks
     * 如果指定组件存在于该实体上，
    *
     * 则返回 true。
    *
     *
     * @param componentId 要检
    *
     * 索的组件标识符（例如 'minecraft:rideable'）。如果未指定命名空间前缀，
    *
     * 则假定为 'minecraft:'。
    *
     * 
    *
     * @returns 如
    *
     * 果指定组件存在于该实体上，则返回 true。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    hasComponent(componentId: string): boolean;
    /**
     * @remarks
     * 返回实体是否具有特定标签。
    *
     *
     * @param tag
    *
     *  要测试的标签标识符。
    *
     * @returns 返回
    *
     * 实体是否具有特定标签。
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    hasTag(tag: string): boolean;
    /**
     * @remarks
     * 杀死此实体。实体将正常掉落战利品。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @returns 如果实体可以
    *
     * 被杀死（即使已死亡）则返回 true，否则返回 false。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     * @example tagsQuery.ts
     * ```typescript
     * import { EntityQueryOptions, DimensionLocation } from "@minecraft/server";
     *
     * function tagsQuery(targetLocation: DimensionLocation) {
     *   const mobs = ["creeper", "skeleton", "sheep"];
     *
     * // 创建一些示例生物数据 for (let i = 0; i < 
    *
     * 10; i++) { const mobTypeId = mobs[i % mobs.length]; const entity = ta
    *
     * rgetLocation.dimension.spawnEntity(mobTypeId, targetLocation); entity.addTag("mobparty." + mobTypeId); 
    *
     * }
    *
     * 
    *
     * 
    *
     *
     *   const eqo: EntityQueryOptions = {
     *     tags: ["mobparty.skeleton"],
     *   };
     *
     *   for (const entity of targetLocation.dimension.getEntities(eqo)) {
     *     entity.kill();
     *   }
     * }
     * ```
     */
    kill(): boolean;
    /**
     * @remarks
     * 设置实体的旋转使其面向目标位置。
    *
     * 如果适用，俯仰角和偏航角都会被设置，例如对于生物，俯仰角控制
    *
     * 头部倾斜，偏航角控制身体旋转。
    *
     * 
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param targe
    *
     * tLocation 此实体应面向/注视的目标位置。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     *
     * {@link minecraftcommon.UnsupportedFunctionalityError}
     */
    lookAt(targetLocation: Vector3): void;
    /**
     * @remarks
     * 将实体与传入的选项进行匹配。如果传入的
    *
     *  EntityQueryOptions 中未指定位置，则使用实体的位置进行匹配。
    *
     * 
    *
     *
     * @param option
    *
     * s 用于执行匹配的查询条件。
    *
     * @returns 如果实体符合传入的 E
    *
     * ntityQueryOptions 中的条件则返回 true，否则返回 false。
    *
     * 
    *
     * @throws
     * 如果查询选项配置错误则抛出错误。

     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidEntityError}
     *
     * {@link minecraftcommon.UnsupportedFunctionalityError}
     */
    matches(options: EntityQueryOptions): boolean;
    /**
     * @remarks
     * 使实体播放给定的动画。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param animationName 动画标识符。
    *
     * 例如 animation.creeper.swelling
    *
     * @param opt
    *
     * ions 用于控制动画播放和过渡的附加选项。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    playAnimation(animationName: string, options?: PlayAnimationOptions): void;
    /**
     * @remarks
     * 立即从世界中移除实体。
    *
     * 被移除的实体不会执行死亡动画或掉落战利品。
    *
     * 
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     *
     * {@link minecraftcommon.UnsupportedFunctionalityError}
     */
    remove(): void;
    /**
     * @remarks
     * 移除实体上指定的 EffectType，
    *
     * 如果效果不存在则返回 false。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param effec
    *
     * tType 效果标识符。
    *
     * @returns 如果效果已被移
    *
     * 除则返回 true。如果未找到效果或效果不存在则返回 false。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidEntityError}
     */
    removeEffect(effectType: EffectType | string): boolean;
    /**
     * @remarks
     * 从实体移除指定的标签。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param tag
    *
     *  要移除的标签内容。
    *
     * @returns 返回
    *
     * 标签是否存在于实体上。
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    removeTag(tag: string): boolean;
    /**
     * @remarks
     * 将实体属性重置为其默认值（如
    *
     * 实体定义中所指定）。此属性更改将在下一个 tick 生效。
    *
     * 
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param identifier
     * 实体属性标识符。

     * @returns 返回默认属性值。
    *
     * 对于枚举属性，返回字符串。对于浮点和整数属性，返回数字。
    *
     * 对于未定义的属性，返回 undefined。
    *
     * 
    *
     * 
    *
     * @throws
     * 如果实体无效则抛出错误。

     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link Error}
     *
     * {@link InvalidEntityError}
     */
    resetProperty(identifier: string): boolean | number | string;
    /**
     * @remarks
     * 在实体上运行同步命令。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param comman
    *
     * dString 命令字符串。注意：不应包含前导斜杠。
    *
     * 
    *
     * @return
    *
     * s 包含命令是否成功的命令结果。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link CommandError}
     *
     * {@link InvalidEntityError}
     */
    runCommand(commandString: string): CommandResult;
    /**
     * @remarks
     * 设置多个具有特定值的动态属性。
    *
     *
     * @param value
    *
     * s 要设置的动态属性键值对记录。如果数据值为 n
    *
     * ull，则改为移除该属性。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link InvalidEntityError}
     */
    setDynamicProperties(values: Record<string, boolean | number | string | Vector3 | undefined>): void;
    /**
     * @remarks
     * 将指定属性设置为一个值。
    *
     *
     * @param ident
    *
     * ifier 属性标识符。
    *
     * @param value 要
    *
     * 设置的属性数据值。如果值为 null，则改为移除该属性。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link InvalidEntityError}
     */
    setDynamicProperty(identifier: string, value?: boolean | number | string | Vector3): void;
    /**
     * @remarks
     * 使实体着火（如果不在水中或雨中的话）。请注意，
    *
     * 您可以调用 getComponent('minecraft:onfire')，如果存在该组件，则表示实体着火。
    *
     * 
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param second
    *
     * s 设置实体着火的时间长度。
    *
     * @param useE
    *
     * ffects 是否应考虑副作用（例如解冻）
    *
     * 以及其他条件（如下雨或火焰保护）。 默认值：true
    *
     * 
    *
     * 
    *
     * @returns 实体是
    *
     * 否被设置着火。如果秒数小于等于零、实体是湿的或实
    *
     * 体对火焰免疫，则可能失败。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     * @example setOnFire.ts
     * ```typescript
     * import { system, EntityOnFireComponent, EntityComponentTypes, DimensionLocation } from "@minecraft/server";
     * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
     *
     * function setOnFire(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
     *   const skelly = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Skeleton, targetLocation);
     *
     *   skelly.setOnFire(20, true);
     *
     *   system.runTimeout(() => {
     *     const onfire = skelly.getComponent(EntityComponentTypes.OnFire) as EntityOnFireComponent;
     *     log(onfire?.onFireTicksRemaining + " fire ticks remaining.");
     *
     *     skelly.extinguishFire(true);
     *     log("Never mind. Fire extinguished.");
     *   }, 20);
     * }
     * ```
     */
    setOnFire(seconds: number, useEffects?: boolean): boolean;
    /**
     * @remarks
     * 将实体属性设置为提供的值。
    *
     * 此属性更改将在下一个 tick 生效。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param identifier
     * 实体属性标识符。

     * @param value
    *
     *  属性值。提供的类型必须与实体定义中指定的类型兼容。
    *
     * 
    *
     * @throws
     * 如果实体无效则抛出错误。

     * 如果提供了无效标识符则抛出错误。

     * 如果提供的值类型与

     * 属性类型。

     * 如果提供的值超出预期范围

     * （int、float 属性）。

     * 如果提供的字符串值与

     * 接受的枚举值集合（枚举属性）不匹配

     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidEntityError}
     */
    setProperty(identifier: string, value: boolean | number | string): void;
    /**
     * @remarks
     * 设置实体的主旋转。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param rotation 
    *
     * 实体的 x 和 y 旋转（角度制）。对于大多数生物，x 旋转控制
    *
     * 头部倾斜，y 旋转控制身体旋转。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    setRotation(rotation: Vector2): void;
    /**
     * @remarks
     * 将选定的实体传送到新位置
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param loca
    *
     * tion 实体的新位置。
    *
     * @param teleportO
    *
     * ptions 关于传送操作的选项。
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     *
     * {@link minecraftcommon.UnsupportedFunctionalityError}
     * @example teleport.ts
     * ```typescript
     * import { system, DimensionLocation } from "@minecraft/server";
     * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
     *
     * function teleport(targetLocation: DimensionLocation) {
     *   const cow = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Cow, targetLocation);
     *
     *   system.runTimeout(() => {
     *     cow.teleport(
     *       { x: targetLocation.x + 2, y: targetLocation.y + 2, z: targetLocation.z + 2 },
     *       {
     *         facingLocation: targetLocation,
     *       }
     *     );
     *   }, 20);
     * }
     * ```
     * @example teleportMovement.ts
     * ```typescript
     * import { system, DimensionLocation } from "@minecraft/server";
     * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
     *
     * function teleportMovement(targetLocation: DimensionLocation) {
     *   const pig = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Pig, targetLocation);
     *
     *   let inc = 1;
     *   const runId = system.runInterval(() => {
     *     pig.teleport(
     *       { x: targetLocation.x + inc / 4, y: targetLocation.y + inc / 4, z: targetLocation.z + inc / 4 },
     *       {
     *         facingLocation: targetLocation,
     *       }
     *     );
     *
     *     if (inc > 100) {
     *       system.clearRun(runId);
     *     }
     *     inc++;
     *   }, 4);
     * }
     * ```
     */
    teleport(location: Vector3, teleportOptions?: TeleportOptions): void;
    /**
     * @remarks
     * 触发实体类型事件。每个实体在其定义
    *
     * 中都定义了许多关键行为事件；例如，苦力怕有 minecraft:sta
    *
     * rt_exploding 类型的事件。
    *
     * 
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param eventName 要
    *
     * 触发的实体类型事件名称。如果未指定命名空间，则假定为 minecraft:。
    *
     * 
    *
     * @throws
     * 如果事件未在实体的定义中定义，
     * 将抛出错误。

     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidEntityError}
     * @example triggerEvent.ts
     * ```typescript
     * // 一个生成苦力怕并立即触发其爆炸的函数 import { DimensionLocati
    *
     * on } from '@minecraft/server'; import { MinecraftEntityTypes } from '@minecraft/vanilla-data'
    *
     * ;
    *
     *
     * function spawnExplodingCreeper(location: DimensionLocation) {
     *     const creeper = dimension.spawnEntity(MinecraftEntityTypes.Creeper, location);
     *
     *     creeper.triggerEvent('minecraft:start_exploding_forced');
     * }
     * ```
     * @example triggerEvent.ts
     * ```typescript
     * import { DimensionLocation } from "@minecraft/server";
     * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
     *
     * function triggerEvent(targetLocation: DimensionLocation) {
     *   const creeper = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Creeper, targetLocation);
     *
     *   creeper.triggerEvent("minecraft:start_exploding_forced");
     * }
     * ```
     */
    triggerEvent(eventName: string): void;
    /**
     * @remarks
     * 尝试进行传送，但可能无
    *
     * 法完成传送操作（例如，如果目标位置有方块）。
    *
     * 
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param locati
    *
     * on 将实体传送到的位置。
    *
     * @param teleportO
    *
     * ptions 关于传送操作的选项。
    *
     * @returns 返回
    *
     * 传送是否成功。如果目标区块未加载或传送会导致
    *
     * 与方块相交，则可能失败。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     *
     * {@link minecraftcommon.UnsupportedFunctionalityError}
     */
    tryTeleport(location: Vector3, teleportOptions?: TeleportOptions): boolean;
}

/**
 * 添加后，此组件将使实体在生成
  *
 * 时携带指定实体类型的骑乘者。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityAddRiderComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 在特定条件下生成时，作为此
    *
     * 实体骑乘者添加的实体类型。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly entityType: string;
    /**
     * @remarks
     * 当为此实体生成骑乘者时，
    *
     * 在骑乘者上触发的可选生成事件。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly spawnEvent: string;
    static readonly componentId = 'minecraft:addrider';
}

/**
 * 为实体添加成长定时器。可以通过
  *
 * 给予实体其喜好的物品（由 feedItems 定义）来加速成长。
  *
 * 
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityAgeableComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 实体成长前的时长，
    *
     * -1 表示永远为幼体。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly duration: number;
    /**
     * @remarks
     * 实体成长时运行的事件。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly growUp: Trigger;
    /**
     * @remarks
     * 用于喂养的物品在成功
    *
     * 交互后会转化为此物品。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly transformToItem: string;
    static readonly componentId = 'minecraft:ageable';
    /**
     * @remarks
     * 实体成长时掉落的物品列表。
    *
     *
     * @throws 此函数可能会抛出错误。
     */
    getDropItems(): string[];
    /**
     * @remarks
     * 可以喂养实体的物品列表。
    *
     * 包括物品名称的 'item' 和定义成长时间的 'growth'。
    *
     * 
    *
     *
     * @throws 此函数可能会抛出错误。
     */
    getFeedItems(): EntityDefinitionFeedItem[];
}

/**
 * 这是一个基础抽象类，
  *
 * 适用于任何围绕数值且具有最小值、最大值和默认定义值的实体组件。
  *
 * 
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityAttributeComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 此实例的当前属性值。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly currentValue: number;
    /**
     * @remarks
     * 返回此属性的默认定义值。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly defaultValue: number;
    /**
     * @remarks
     * 返回此属性在考虑其他环境
    *
     * 组件或因素后的有效最大值。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly effectiveMax: number;
    /**
     * @remarks
     * 返回此属性在考虑其他环境
    *
     * 组件或因素后的有效最小值。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly effectiveMin: number;
    /**
     * @remarks
     * 将此属性的当前值重
    *
     * 置为定义的默认值。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    resetToDefaultValue(): void;
    /**
     * @remarks
     * 将此属性的当前值重
    *
     * 置为定义的最大值。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    resetToMaxValue(): void;
    /**
     * @remarks
     * 将此属性的当前值重
    *
     * 置为定义的最小值。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    resetToMinValue(): void;
    /**
     * @remarks
     * 设置此属性的当前值。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws
     * 如果值超出范围，则抛出 ArgumentOutOfBounds 错误
     * 被抛出。

     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link InvalidEntityError}
     */
    setCurrentValue(value: number): boolean;
}

/**
 * 实体移动事件系列的基础类。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityBaseMovementComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 此生物移动模式的最大转向速率。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly maxTurn: number;
}

/**
 * 定义此实体可以在哪些方块
  *
 * 中呼吸，并赋予其窒息能力。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityBreathableComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 如果为 true，此实体可以在空气中呼吸。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly breathesAir: boolean;
    /**
     * @remarks
     * 如果为 true，此实体可以在熔岩中呼吸。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly breathesLava: boolean;
    /**
     * @remarks
     * 如果为 true，此实体可以在实心方块中呼吸。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly breathesSolids: boolean;
    /**
     * @remarks
     * 如果为 true，此实体可以在水中呼吸。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly breathesWater: boolean;
    /**
     * @remarks
     * 如果为 true，此实体
    *
     * 在水中时会出现可见气泡。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly generatesBubbles: boolean;
    /**
     * @remarks
     * 恢复呼吸至最大值所需的时间（秒）。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly inhaleTime: number;
    /**
     * @remarks
     * 窒息伤害之间的时间间隔（秒）。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly suffocateTime: number;
    /**
     * @remarks
     * 实体可以屏住呼吸的时间（秒）。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly totalSupply: number;
    static readonly componentId = 'minecraft:breathable';
    /**
     * @remarks
     * 此实体可以呼吸的方块列表，
    *
     * 除方块类别的独立属性之外。
    *
     *
     * @throws 此函数可能会抛出错误。
     */
    getBreatheBlocks(): BlockPermutation[];
    /**
     * @remarks
     * 此实体不能呼吸的方块列表。
    *
     *
     * @throws 此函数可能会抛出错误。
     */
    getNonBreatheBlocks(): BlockPermutation[];
}

/**
 * 添加后，此组件表示
  *
 * 实体可以攀爬梯子。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityCanClimbComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:can_climb';
}

/**
 * 添加后，此组件表示实体可
  *
 * 以飞行，且寻路器将不受限于下方需要实心方块的路径。
  *
 * 
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityCanFlyComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:can_fly';
}

/**
 * 添加后，此组件表示实体可以像 Min
  *
 * ecraft 中的马一样进行蓄力跳跃。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityCanPowerJumpComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:can_power_jump';
}

/**
 * 定义实体的次要颜色。
  *
 * 仅适用于具有次要预定义颜色值的某些实体（例如，热带鱼）。
  *
 * 
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityColor2Component extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 此特定颜色的值。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly value: PaletteColor;
    static readonly componentId = 'minecraft:color2';
}

/**
 * 定义实体的颜色。仅适用于具
  *
 * 有预定义颜色值的某些实体（例如，羊、羊驼、潜影贝）。
  *
 * 
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityColorComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 此特定颜色的值。
    *
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    value: number;
    static readonly componentId = 'minecraft:color';
}

/**
 * 下游实体组件的基础类。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityComponent extends Component {
    private constructor();
    /**
     * @remarks
     * 拥有此组件的实体。如果实体已被移除，
    *
     * 则为 undefined。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     */
    readonly entity: Entity;
}

/**
 * 作为 Ageable 组件
  *
 * 的一部分，表示一组可以喂养实体并促进其成长速度的物品。
  *
 * 
  *
 */
export class EntityDefinitionFeedItem {
    private constructor();
    /**
     * @remarks
     * 喂养此物品时实体年龄增加的量。
    *
     * 值通常在 0 到 1 之间。
    *
     *
     */
    readonly growth: number;
    /**
     * @remarks
     * 可喂养物品类型的标识符。如果未指定命名空间，
    *
     * 则假定为 'minecraft:'。示例值包括 'wheat' 或 'golden_apple'。
    *
     * 
    *
     *
     */
    readonly item: string;
    /**
     * @remarks
     * 喂养后产生的物品种类 ID。
    *
     * 通常为空，但用于某些场景，例如用鱼桶喂食鹦鹉螺，
    *
     * 结果物品将是一个空桶。
    *
     * 
    *
     *
     */
    readonly resultItem?: string;
}

/**
 * 包含游戏中实体死亡相关的数据。
  *
 */
export class EntityDieAfterEvent {
    private constructor();
    /**
     * @remarks
     * 如果指定，则提供导致此实体
    *
     * 死亡的伤害来源的更多信息。
    *
     *
     */
    readonly damageSource: EntityDamageSource;
    /**
     * @remarks
     * 已死亡的实体对象。
    *
     *
     */
    readonly deadEntity: Entity;
}

/**
 * 支持注册实体死
  *
 * 亡后触发的事件。
  *
 */
export class EntityDieAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 订阅实体死亡时触发的事件。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callba
    *
     * ck 实体死亡时调用的函数。
    *
     * @param op
    *
     * tions 订阅触发时的附加过滤选项。
    *
     * 
    *
     * @returns 
    *
     * 返回可用于将来下游调用取消订阅的闭包。
    *
     * 
    *
     */
    subscribe(
        callback: (arg0: EntityDieAfterEvent) => void,
        options?: EntityEventOptions,
    ): (arg0: EntityDieAfterEvent) => void;
    /**
     * @remarks
     * 当实体死亡时，停止
    *
     * 此事件调用您的函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: EntityDieAfterEvent) => void): void;
}

/**
 * 提供对生物装备槽的访问。
  *
 * 此组件存在于玩家实体上。
  *
 * @example givePlayerElytra.ts
 * ```typescript
 * // 给予玩家鞘翅 import { EquipmentSlot, ItemStack, Player, E
  *
 * ntityComponentTypes } from '@minecraft/server'; import { MinecraftItemTypes } from '@minecraft/vanilla-data'
  *
 * ;
  *
 *
 * function giveEquipment(player: Player) {
 *     const equipmentCompPlayer = player.getComponent(EntityComponentTypes.Equippable);
 *     if (equipmentCompPlayer) {
 *         equipmentCompPlayer.setEquipment(EquipmentSlot.Chest, new ItemStack(MinecraftItemTypes.Elytra));
 *     }
 * }
 * ```
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityEquippableComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 返回所有者的总护甲等级。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     */
    readonly totalArmor: number;
    /**
     * @remarks
     * 返回所有者的总韧性等级。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     */
    readonly totalToughness: number;
    static readonly componentId = 'minecraft:equippable';
    /**
     * @remarks
     * 获取指定 EquipmentSlot 中装备的物品。
    *
     *
     * @param equipmentSlot 装备槽位。
    *
     * 例如 "head"、"chest"、"offhand"
    *
     * @returns 返回指定 Equi
    *
     * pmentSlot 中装备的物品。如果为空，则返回 undefined。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     */
    getEquipment(equipmentSlot: EquipmentSlot): ItemStack | undefined;
    /**
     * @remarks
     * 获取与指定 EquipmentSlot
    *
     *  对应的 ContainerSlot。
    *
     *
     * @param equipmentSlot 装备槽位。
    *
     * 例如 "head"、"chest"、"offhand"。
    *
     * @returns 返回与指定 
    *
     * EquipmentSlot 对应的 ContainerSlot。
    *
     * 
    *
     * @throws 此函数可能会抛出错误。
     */
    getEquipmentSlot(equipmentSlot: EquipmentSlot): ContainerSlot;
    /**
     * @remarks
     * 替换指定 EquipmentSlot 中的物品。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param equipmentSlot 装备槽位。
    *
     * 例如 "head"、"chest"、"offhand"。
    *
     * @param itemStack 要装备的物品。
    *
     * 如果为 undefined，则清空该槽位。
    *
     * @throws 此函数可能会抛出错误。
     */
    setEquipment(equipmentSlot: EquipmentSlot, itemStack?: ItemStack): boolean;
}

/**
 * 定义此实体的 exhaustion（疲劳度）交互。
  *
 * 封装 `minecraft.player.exhaustion` 属性。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityExhaustionComponent extends EntityAttributeComponent {
    private constructor();
    static readonly componentId = 'minecraft:player.exhaustion';
}

/**
 * 添加后，此组件表示此
  *
 * 实体不会受到火焰伤害。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityFireImmuneComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:fire_immune';
}

/**
 * 添加后，此组件表示此实
  *
 * 体可以在液体方块中漂浮。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityFloatsInLiquidComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:floats_in_liquid';
}

/**
 * 表示实体的飞行速度。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityFlyingSpeedComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 关联实体的当前飞行速度值。
    *
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    value: number;
    static readonly componentId = 'minecraft:flying_speed';
}

/**
 * 定义摩擦力对此实体的影响程度。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityFrictionModifierComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 关联实体的当前
    *
     * 摩擦力修正值。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly value: number;
    static readonly componentId = 'minecraft:friction_modifier';
}

/**
 * 战利品条件，检查生物掉
  *
 * 落战利品时的标记变体值。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityHasMarkVariantCondition extends LootItemCondition {
    private constructor();
    /**
     * @remarks
     * 生物必须具有的标记变体值，
    *
     * 此条件才能通过。
    *
     *
     */
    readonly value: number;
}

/**
 * 战利品条件，检查生物
  *
 * 掉落战利品时的变体值。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityHasVariantCondition extends LootItemCondition {
    private constructor();
    /**
     * @remarks
     * 生物必须具有的变体值，
    *
     * 此条件才能通过。
    *
     *
     */
    readonly value: number;
}

/**
 * 定义与此实体进行治疗的交互。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityHealableComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 确定物品是否可以在
    *
     * 实体满生命值时使用。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly forceUse: boolean;
    static readonly componentId = 'minecraft:healable';
    /**
     * @remarks
     * 一组可以专门治疗此实体的物品。
    *
     *
     * @returns 
    *
     * 此组件关联的实体。
    *
     * @throws 此函数可能会抛出错误。
     */
    getFeedItems(): FeedItem[];
}

/**
 * 包含实体已被治
  *
 * 疗相关的信息。
  *
 */
export class EntityHealAfterEvent {
    private constructor();
    /**
     * @remarks
     * 被治疗的实体。
    *
     *
     */
    readonly healedEntity: Entity;
    /**
     * @remarks
     * 描述治疗量。
    *
     *
     */
    readonly healing: number;
    /**
     * @remarks
     * 关于治疗来源的信息。
    *
     *
     */
    readonly healSource: EntityHealSource;
}

/**
 * 管理连接实体被治
  *
 * 疗事件的回调函数。
  *
 */
export class EntityHealAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个将在实体被治
    *
     * 疗时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: EntityHealAfterEvent) => void,
        options?: EntityHealEventOptions,
    ): (arg0: EntityHealAfterEvent) => void;
    /**
     * @remarks
     * 移除一个在实体被治
    *
     * 疗时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: EntityHealAfterEvent) => void): void;
}

/**
 * 包含实体将要被
  *
 * 治疗相关的信息。
  *
 */
export class EntityHealBeforeEvent {
    private constructor();
    cancel: boolean;
    /**
     * @remarks
     * 将要被治疗的实体。
    *
     *
     */
    readonly healedEntity: Entity;
    /**
     * @remarks
     * 描述治疗量。
    *
     *
     */
    healing: number;
    /**
     * @remarks
     * 关于治疗来源的信息。
    *
     *
     */
    readonly healSource: EntityHealSource;
}

/**
 * 管理连接实体将要被
  *
 * 治疗事件的回调函数。
  *
 */
export class EntityHealBeforeEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个将在实体将要被
    *
     * 治疗时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     * @returns
     * 在受限执行权限下调用的闭包。
     */
    subscribe(
        callback: (arg0: EntityHealBeforeEvent) => void,
        options?: EntityHealEventOptions,
    ): (arg0: EntityHealBeforeEvent) => void;
    /**
     * @remarks
     * 移除一个在实体将要被
    *
     * 治疗时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     */
    unsubscribe(callback: (arg0: EntityHealBeforeEvent) => void): void;
}

/**
 * 提供关于治疗如何
  *
 * 应用于实体的信息。
  *
 */
export class EntityHealSource {
    private constructor();
    /**
     * @remarks
     * 治疗来源的原因枚举器。
    *
     *
     */
    readonly cause: EntityHealCause;
}

/**
 * 包含实体生命值变化时的相关信息。
  *
 * 警告：请勿在此事件中改变实体的生命值，否则将导致无限循环！
  *
 * 
  *
 */
export class EntityHealthChangedAfterEvent {
    private constructor();
    /**
     * @remarks
     * 生命值发生变化的实体。
    *
     *
     */
    readonly entity: Entity;
    /**
     * @remarks
     * 实体的新生命值。
    *
     *
     */
    readonly newValue: number;
    /**
     * @remarks
     * 实体的旧生命值。
    *
     *
     */
    readonly oldValue: number;
}

/**
 * 管理连接实体生命值
  *
 * 变化事件的回调函数。
  *
 */
export class EntityHealthChangedAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个将在实体生命值
    *
     * 变化时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: EntityHealthChangedAfterEvent) => void,
        options?: EntityEventOptions,
    ): (arg0: EntityHealthChangedAfterEvent) => void;
    /**
     * @remarks
     * 移除一个在实体生命值
    *
     * 变化时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: EntityHealthChangedAfterEvent) => void): void;
}

/**
 * 定义实体的生命值属性。
  *
 * @example applyDamageThenHeal.ts
 * ```typescript
 * import { system, EntityHealthComponent, EntityComponentTypes, DimensionLocation } from "@minecraft/server";
 * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
 *
 * function applyDamageThenHeal(
 *   log: (message: string, status?: number) => void,
 *   targetLocation: DimensionLocation
 * ) {
 *   const skelly = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Skeleton, targetLocation);
 *
 *   skelly.applyDamage(19); // 骷髅的最大生命值为 20，所以这是一个濒死的骷髅
  *
 *
 *   system.runTimeout(() => {
 *     const health = skelly.getComponent(EntityComponentTypes.Health) as EntityHealthComponent;
 *     log("Skeleton health before heal: " + health?.currentValue);
 *     health?.resetToMaxValue();
 *     log("Skeleton health after heal: " + health?.currentValue);
 *   }, 20);
 * }
 * ```
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityHealthComponent extends EntityAttributeComponent {
    private constructor();
    static readonly componentId = 'minecraft:health';
}

/**
 * 包含实体撞击方块相关的信息。
  *
 */
export class EntityHitBlockAfterEvent {
    private constructor();
    /**
     * @remarks
     * 被撞击的方块面。
    *
     *
     */
    readonly blockFace: Direction;
    /**
     * @remarks
     * 发起攻击的实体。
    *
     *
     */
    readonly damagingEntity: Entity;
    /**
     * @remarks
     * 被攻击命中的方块。
    *
     *
     */
    readonly hitBlock: Block;
    /**
     * @remarks
     * 被攻击命中的方块置换。
    *
     *
     */
    readonly hitBlockPermutation: BlockPermutation;
}

/**
 * 管理连接实体撞击方
  *
 * 块事件的回调函数。
  *
 */
export class EntityHitBlockAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个将在实体撞击
    *
     * 方块时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: EntityHitBlockAfterEvent) => void,
        options?: EntityEventOptions,
    ): (arg0: EntityHitBlockAfterEvent) => void;
    /**
     * @remarks
     * 移除一个在实体撞击方
    *
     * 块时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: EntityHitBlockAfterEvent) => void): void;
}

/**
 * 包含实体攻击（近战攻击）
  *
 * 另一个实体相关的信息。
  *
 */
export class EntityHitEntityAfterEvent {
    private constructor();
    /**
     * @remarks
     * 发起命中/近战攻击的实体。
    *
     *
     */
    readonly damagingEntity: Entity;
    /**
     * @remarks
     * 被攻击命中的实体。
    *
     *
     */
    readonly hitEntity: Entity;
}

/**
 * 管理连接实体对另一个实体发
  *
 * 起近战攻击事件的回调函数。
  *
 */
export class EntityHitEntityAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个将在实体撞击另一
    *
     * 个实体时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: EntityHitEntityAfterEvent) => void,
        options?: EntityEventOptions,
    ): (arg0: EntityHitEntityAfterEvent) => void;
    /**
     * @remarks
     * 移除一个在实体对

     * 对另一个实体进行近战攻击。

     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: EntityHitEntityAfterEvent) => void): void;
}

/**
 * 定义此实体的 hunger（饥饿度）交互。
  *
 * 封装 `minecraft.player.hunger` 属性。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityHungerComponent extends EntityAttributeComponent {
    private constructor();
    static readonly componentId = 'minecraft:player.hunger';
}

/**
 * 包含实体受伤相关的信息。
  *
 */
export class EntityHurtAfterEvent {
    private constructor();
    /**
     * @remarks
     * 描述造成的伤害量。
    *
     *
     */
    readonly damage: number;
    /**
     * @remarks
     * 关于可能施加此伤害
    *
     * 的实体的来源信息。
    *
     *
     */
    readonly damageSource: EntityDamageSource;
    /**
     * @remarks
     * 被伤害的实体。
    *
     *
     */
    readonly hurtEntity: Entity;
}

/**
 * 管理连接实体受伤
  *
 * 事件的回调函数。
  *
 */
export class EntityHurtAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个将在实体受伤时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: EntityHurtAfterEvent) => void,
        options?: EntityHurtAfterEventOptions,
    ): (arg0: EntityHurtAfterEvent) => void;
    /**
     * @remarks
     * 移除一个在实体受伤时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: EntityHurtAfterEvent) => void): void;
}

/**
 * 包含实体将要受伤相关的信息。
  *
 */
export class EntityHurtBeforeEvent {
    private constructor();
    cancel: boolean;
    /**
     * @remarks
     * 描述将要造成的伤害量。
    *
     *
     */
    damage: number;
    /**
     * @remarks
     * 关于可能施加此伤害
    *
     * 的实体的来源信息。
    *
     *
     */
    readonly damageSource: EntityDamageSource;
    /**
     * @remarks
     * 将要被伤害的实体。
    *
     *
     */
    readonly hurtEntity: Entity;
}

/**
 * 管理连接实体将要受
  *
 * 伤事件的回调函数。
  *
 */
export class EntityHurtBeforeEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个将在实体将要
    *
     * 受伤时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     * @returns
     * 在受限执行权限下调用的闭包。
     */
    subscribe(
        callback: (arg0: EntityHurtBeforeEvent) => void,
        options?: EntityHurtBeforeEventOptions,
    ): (arg0: EntityHurtBeforeEvent) => void;
    /**
     * @remarks
     * 移除一个在实体将要受
    *
     * 伤时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     */
    unsubscribe(callback: (arg0: EntityHurtBeforeEvent) => void): void;
}

/**
 * 定义此实体的物品栏属性。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityInventoryComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 此实体每点额外力
    *
     * 量可获得的槽位数。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly additionalSlotsPerStrength: number;
    /**
     * @remarks
     * 如果为 true，漏斗可
    *
     * 以移除该物品栏中的内容。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canBeSiphonedFrom: boolean;
    /**
     * @remarks
     * 定义此实体的容器。如果实体已被移除，
    *
     * 则容器为 undefined。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     */
    readonly container: Container;
    /**
     * @remarks
     * 此实体的容器类型。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly containerType: string;
    /**
     * @remarks
     * 容器的槽位数。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly inventorySize: number;
    /**
     * @remarks
     * 如果为 true，实体死亡时不会掉落其物品栏。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly 'private': boolean;
    /**
     * @remarks
     * 如果为 true，实体的物品
    *
     * 栏只能由其所有者或自身访问。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly restrictToOwner: boolean;
    static readonly componentId = 'minecraft:inventory';
}

/**
 * 添加后，此组件表
  *
 * 示此实体为幼体。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityIsBabyComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:is_baby';
}

/**
 * 添加后，此组件表示
  *
 * 此实体处于充能状态。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityIsChargedComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:is_charged';
}

/**
 * 添加后，此组件表示
  *
 * 此实体当前携带箱子。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityIsChestedComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:is_chested';
}

/**
 * 添加后，此组件表示可以使
  *
 * 用染料改变此实体的颜色。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityIsDyeableComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:is_dyeable';
}

/**
 * 添加后，此组件表示此实体
  *
 * 在隐身时可以躲避敌对生物。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityIsHiddenWhenInvisibleComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:is_hidden_when_invisible';
}

/**
 * 添加后，此组件表示此
  *
 * 实体当前处于着火状态。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityIsIgnitedComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:is_ignited';
}

/**
 * 添加后，此组件表示
  *
 * 此实体为灾厄队长。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityIsIllagerCaptainComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:is_illager_captain';
}

/**
 * 添加后，此组件表示
  *
 * 此实体当前配有鞍。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityIsSaddledComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:is_saddled';
}

/**
 * 添加后，此组件表示
  *
 * 此实体当前在颤抖。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityIsShakingComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:is_shaking';
}

/**
 * 添加后，此组件表示
  *
 * 此实体当前已被剪毛。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityIsShearedComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:is_sheared';
}

/**
 * 添加后，此组件表示
  *
 * 此实体可以被堆叠。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityIsStackableComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:is_stackable';
}

/**
 * 添加后，此组件表示此
  *
 * 实体当前处于眩晕状态。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityIsStunnedComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:is_stunned';
}

/**
 * 添加后，此组件表示
  *
 * 此实体当前已被驯服。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityIsTamedComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:is_tamed';
}

/**
 * 如果添加到实体上，表示该实体
  *
 * 代表世界中一个自由漂浮的物品。允许通过 itemStac
  *
 * k 属性获取实际的物品堆内容。
  *
 * 
  *
 * @example testThatEntityIsFeatherItem.ts
 * ```typescript
 * import { EntityItemComponent, EntityComponentTypes, DimensionLocation } from "@minecraft/server";
 *
 * function testThatEntityIsFeatherItem(
 *   log: (message: string, status?: number) => void,
 *   targetLocation: DimensionLocation
 * ) {
 *   const items = targetLocation.dimension.getEntities({
 *     location: targetLocation,
 *     maxDistance: 20,
 *   });
 *
 *   for (const item of items) {
 *     const itemComp = item.getComponent(EntityComponentTypes.Item) as EntityItemComponent;
 *
 *     if (itemComp) {
 *       if (itemComp.itemStack.typeId.endsWith("feather")) {
 *         log("Success! Found a feather", 1);
 *       }
 *     }
 *   }
 * }
 * ```
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityItemComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 此实体在世界中表示的物品堆。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly itemStack: ItemStack;
    static readonly componentId = 'minecraft:item';
}

/**
 * 包含实体掉落物
  *
 * 品相关的信息。
  *
 */
export class EntityItemDropAfterEvent {
    private constructor();
    /**
     * @remarks
     * 已掉落物品的实体。
    *
     *
     */
    readonly entity: Entity;
    /**
     * @remarks
     * 实体已掉落的物品列表。
    *
     *
     */
    readonly items: Entity[];
}

/**
 * 管理连接实体掉落物
  *
 * 品事件的回调函数。
  *
 */
export class EntityItemDropAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个将在实体掉落
    *
     * 物品时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: EntityItemDropAfterEvent) => void,
        options?: EntityItemDropEventOptions,
    ): (arg0: EntityItemDropAfterEvent) => void;
    /**
     * @remarks
     * 移除一个在实体掉落物
    *
     * 品时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: EntityItemDropAfterEvent) => void): void;
}

/**
 * 包含实体拾取物
  *
 * 品相关的信息。
  *
 */
export class EntityItemPickupAfterEvent {
    private constructor();
    /**
     * @remarks
     * 已拾取物品的实体。
    *
     *
     */
    readonly entity: Entity;
    /**
     * @remarks
     * 实体已拾取的物品列表。
    *
     *
     */
    readonly items: ItemStack[];
}

/**
 * 管理连接实体拾取物
  *
 * 品事件的回调函数。
  *
 */
export class EntityItemPickupAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个将在实体拾取
    *
     * 物品时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: EntityItemPickupAfterEvent) => void,
        options?: EntityItemPickupEventOptions,
    ): (arg0: EntityItemPickupAfterEvent) => void;
    /**
     * @remarks
     * 移除一个在实体拾取物
    *
     * 品时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: EntityItemPickupAfterEvent) => void): void;
}

/**
 * 包含实体将要拾取
  *
 * 物品相关的信息。
  *
 */
export class EntityItemPickupBeforeEvent {
    private constructor();
    /**
     * @remarks
     * 如果设置为 true，物品将不会被拾取。
    *
     *
     */
    cancel: boolean;
    /**
     * @remarks
     * 将要拾取物品的实体。
    *
     *
     */
    readonly entity: Entity;
    /**
     * @remarks
     * 将要被拾取的物品。
    *
     *
     */
    readonly item: Entity;
}

/**
 * 管理连接实体将要拾取
  *
 * 物品事件的回调函数。
  *
 */
export class EntityItemPickupBeforeEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个将在实体将要拾
    *
     * 取物品时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     * @returns
     * 在受限执行权限下调用的闭包。
     */
    subscribe(
        callback: (arg0: EntityItemPickupBeforeEvent) => void,
        options?: EntityItemPickupEventOptions,
    ): (arg0: EntityItemPickupBeforeEvent) => void;
    /**
     * @remarks
     * 移除一个在实体将要拾取
    *
     * 物品时调用的回调函数。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     */
    unsubscribe(callback: (arg0: EntityItemPickupBeforeEvent) => void): void;
}

/**
 * 战利品条件，检查掉
  *
 * 落战利品的实体类型。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityKilledCondition extends LootItemCondition {
    private constructor();
    /**
     * @remarks
     * 此条件需要满足的实体类型。例如：
    *
     * 'minecraft:skeleton'。
    *
     *
     */
    readonly entityType: string;
}

/**
 * 定义此实体在熔岩中的基础移动速度。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityLavaMovementComponent extends EntityAttributeComponent {
    private constructor();
    static readonly componentId = 'minecraft:lava_movement';
}

/**
 * 允许实体被拴绳牵引。
  *
 * 定义实体被拴绳时的条件和事件。
  *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityLeashableComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 如果另一个实体可以通过拴上自己的拴绳来
    *
     * '偷走'被拴绳的实体，则返回 true。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canBeStolen: boolean;
    /**
     * @remarks
     * 拴绳绷紧并限制移动的
    *
     * 距离（以方块为单位）。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly hardDistance: number;
    /**
     * @remarks
     * 如果实体被拴绳则返回 true。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly isLeashed: boolean;
    /**
     * @remarks
     * 持有拴绳的实体。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly leashHolder?: Entity;
    /**
     * @remarks
     * 持有拴绳的实体标识符。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly leashHolderEntityId?: string;
    /**
     * @remarks
     * 拴绳断裂的距离（以方块为单位）。
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly maxDistance: number;
    /**
     * @remarks
     * '弹簧'效果开始作用以
    *
     * 保持此实体靠近拴绳者的距离（以方块为单位）。
    *
     * 
    *
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly softDistance: number;
    static readonly componentId = 'minecraft:leashable';
    /**
     * @remarks
     * 将此实体拴绳到另一个实体。
    *
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param leashHolder
     * 要将此实体拴绳到的实体。
     * @throws
     * 如果要拴绳到的实体超过最大距离，或者玩家死亡或处于旁观者模式时抛出异常。
     */
    leashTo(leashHolder: Entity): void;
    /**
     * @remarks
     * 如果此实体已拴绳到另一个实体，则解除其拴绳。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    unleash(): void;
}

/**
  * 包含世界中加载的实体相关数据。
 * 这可能发生在未加载的区块重新加载时，或者
 * 实体改变维度时。
 */
export class EntityLoadAfterEvent {
    private constructor();
    /**
     * @remarks
     * 已加载的实体。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    entity: Entity;
}

/**
 * 注册一个基于脚本的事件处理器，用于处理
 * 实体加载时发生的情况。
 */
export class EntityLoadAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 注册一个事件处理器，用于处理实体加载时发生的情况。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 处理加载事件的函数。
     */
    subscribe(callback: (arg0: EntityLoadAfterEvent) => void): (arg0: EntityLoadAfterEvent) => void;
    /**
     * @remarks
     * 取消注册之前订阅到此订阅事件的方法。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 最初传入 subscribe 事件的函数，现在要取消注册。
     */
    unsubscribe(callback: (arg0: EntityLoadAfterEvent) => void): void;
}

/**
 * 额外的变体值。可用于进一步区分变体。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityMarkVariantComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 此实体的标记变体值。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly value: number;
    static readonly componentId = 'minecraft:mark_variant';
}

/**
 * 添加后，此移动控制器允许生物在水中游泳并在陆地上行走。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityMovementAmphibiousComponent extends EntityBaseMovementComponent {
    private constructor();
    static readonly componentId = 'minecraft:movement.amphibious';
}

/**
 * 此组件强调实体的移动。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityMovementBasicComponent extends EntityBaseMovementComponent {
    private constructor();
    static readonly componentId = 'minecraft:movement.basic';
}

/**
 * 定义此实体的常规移动速度。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityMovementComponent extends EntityAttributeComponent {
    private constructor();
    static readonly componentId = 'minecraft:movement';
}

/**
 * 添加后，此移动控制器使生物能够飞行。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityMovementFlyComponent extends EntityBaseMovementComponent {
    private constructor();
    static readonly componentId = 'minecraft:movement.fly';
}

/**
 * 添加后，此移动控制器允许生物飞行、游泳、攀爬等。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityMovementGenericComponent extends EntityBaseMovementComponent {
    private constructor();
    static readonly componentId = 'minecraft:movement.generic';
}

/**
 * 添加后，此移动控制器允许生物滑翔。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityMovementGlideComponent extends EntityBaseMovementComponent {
    private constructor();
    /**
     * @remarks
     * 实体转弯时的有效速度。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly speedWhenTurning: number;
    /**
     * @remarks
     * 滑翔时的起始速度。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly startSpeed: number;
    static readonly componentId = 'minecraft:movement.glide';
}

/**
 * 添加后，此移动控制器使生物悬停。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityMovementHoverComponent extends EntityBaseMovementComponent {
    private constructor();
    static readonly componentId = 'minecraft:movement.hover';
}

/**
 * 移动控制器，使生物在移动时跳跃，并在跳跃之间具有指定的延迟。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityMovementJumpComponent extends EntityBaseMovementComponent {
    private constructor();
    static readonly componentId = 'minecraft:movement.jump';
}

/**
 * 添加后，此移动控制器使生物在移动时单足跳行。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityMovementSkipComponent extends EntityBaseMovementComponent {
    private constructor();
    static readonly componentId = 'minecraft:movement.skip';
}

/**
 * 添加后，此移动控制器使生物左右摇摆，给人正在游泳的印象。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityMovementSwayComponent extends EntityBaseMovementComponent {
    private constructor();
    /**
     * @remarks
     * 摇摆运动的幅度。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly swayAmplitude: number;
    /**
     * @remarks
     * 摇摆频率的量。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly swayFrequency: number;
    static readonly componentId = 'minecraft:movement.sway';
}

/**
 * 允许此实体生成包含垂直墙壁的路径（例如，像 Minecraft 蜘蛛那样）。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityNavigationClimbComponent extends EntityNavigationComponent {
    private constructor();
    static readonly componentId = 'minecraft:navigation.climb';
}

/**
 * 允许此实体生成包含垂直墙壁的路径（例如，像 Minecraft 蜘蛛那样）。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityNavigationComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 告诉寻路器在寻找路径时避开会造成伤害的方块。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly avoidDamageBlocks: boolean;
    /**
     * @remarks
     * 告诉寻路器在寻找路径时避开传送门（如下界传送门）。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly avoidPortals: boolean;
    /**
     * @remarks
     * 寻路器在创建路径时是否应避免暴露在阳光下的方块。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly avoidSun: boolean;
    /**
     * @remarks
     * 告诉寻路器在创建路径时避开水域。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly avoidWater: boolean;
    /**
     * @remarks
     * 告诉寻路器它是否可以跳出水面（如海豚）。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canBreach: boolean;
    /**
     * @remarks
     * 告诉寻路器它可以通过关闭的门并将其破坏。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canBreakDoors: boolean;
    /**
     * @remarks
     * 告诉寻路器它是否可以漂浮。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canFloat: boolean;
    /**
     * @remarks
     * 告诉寻路器它是否可以跳上方块。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canJump: boolean;
    /**
     * @remarks
     * 告诉寻路器它可以通过关闭的门，假设 AI 会打开门。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canOpenDoors: boolean;
    /**
     * @remarks
     * 告诉寻路器它可以通过关闭的铁门，假设 AI 会打开门。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canOpenIronDoors: boolean;
    /**
     * @remarks
     * 是否可以通过门创建路径。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canPassDoors: boolean;
    /**
     * @remarks
     * 告诉寻路器它可以在空中开始寻路。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canPathFromAir: boolean;
    /**
     * @remarks
     * 告诉寻路器它是否可以在熔岩表面移动。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canPathOverLava: boolean;
    /**
     * @remarks
     * 告诉寻路器它是否可以在水面移动。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canPathOverWater: boolean;
    /**
     * @remarks
     * 告诉寻路器它在水中是否会被重力拉下。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canSink: boolean;
    /**
     * @remarks
     * 告诉寻路器它是否可以在水中任意寻路，并沿路径播放游泳动画。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canSwim: boolean;
    /**
     * @remarks
     * 告诉寻路器它是否可以在水外的地面上行走。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canWalk: boolean;
    /**
     * @remarks
     * 告诉寻路器它是否可以在熔岩中像在地面上行走一样移动。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canWalkInLava: boolean;
    /**
     * @remarks
     * 告诉寻路器它是否可以在陆地上行走或潜入水下。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly isAmphibious: boolean;
}

/**
 * 允许此实体像普通恶魂一样在空中飞行生成路径。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityNavigationFloatComponent extends EntityNavigationComponent {
    private constructor();
    static readonly componentId = 'minecraft:navigation.float';
}

/**
 * 允许此实体在空中生成路径（例如，像 Minecraft 鹦鹉那样）。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityNavigationFlyComponent extends EntityNavigationComponent {
    private constructor();
    static readonly componentId = 'minecraft:navigation.fly';
}

/**
 * 允许此实体通过行走、游泳、飞行和/或攀爬以及跳跃上下方块来生成路径。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityNavigationGenericComponent extends EntityNavigationComponent {
    private constructor();
    static readonly componentId = 'minecraft:navigation.generic';
}

/**
 * 允许此实体在空中生成路径（例如，像 Minecraft 蜜蜂那样）。防止它们从天空中掉落并进行预测性移动。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityNavigationHoverComponent extends EntityNavigationComponent {
    private constructor();
    static readonly componentId = 'minecraft:navigation.hover';
}

/**
 * 允许此实体像普通生物一样通过行走以及跳跃上下方块来生成路径。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityNavigationWalkComponent extends EntityNavigationComponent {
    private constructor();
    static readonly componentId = 'minecraft:navigation.walk';
}

/**
 * 当存在于实体上时，此实体处于着火状态。
 * @example setOnFire.ts
 * ```typescript
 * import { system, EntityOnFireComponent, EntityComponentTypes, DimensionLocation } from "@minecraft/server";
 * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
 *
 * function setOnFire(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const skelly = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Skeleton, targetLocation);
 *
 *   skelly.setOnFire(20, true);
 *
 *   system.runTimeout(() => {
 *     const onfire = skelly.getComponent(EntityComponentTypes.OnFire) as EntityOnFireComponent;
 *     log(onfire?.onFireTicksRemaining + " fire ticks remaining.");
 *
 *     skelly.extinguishFire(true);
 *     log("Never mind. Fire extinguished.");
 *   }, 20);
 * }
 * ```
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityOnFireComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 火势熄灭前剩余的刻数。
     *
     */
    readonly onFireTicksRemaining: number;
    static readonly componentId = 'minecraft:onfire';
}

/**
 * 抛射物组件控制抛射物实体的属性，并允许其沿给定方向发射。
 * 当实体具有 minecraft:projectile 组件时，此组件存在。
 * @example shootArrow.ts
 * ```typescript
 * import { DimensionLocation, EntityProjectileComponent } from "@minecraft/server";
 *
 * function shootArrow(targetLocation: DimensionLocation) {
 *   const velocity = { x: 0, y: 1, z: 5 };
 *
 *   const arrow = targetLocation.dimension.spawnEntity("minecraft:arrow", {
 *     x: targetLocation.x,
 *     y: targetLocation.y + 2,
 *     z: targetLocation.z,
 *   });
 *
 *   const projectileComp = arrow.getComponent("minecraft:projectile") as EntityProjectileComponent;
 *
 *   projectileComp?.shoot(velocity);
 * }
 * ```
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityProjectileComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 抛射物在空中飞行时每刻保持的速度比例。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    airInertia: number;
    /**
     * @remarks
     * 如果为 true，实体在受伤时会被点燃。默认燃烧持续时间为 5 秒。此持续时间可通过 onFireTime 属性修改。如果实体免疫火焰或处于湿润状态，则不会着火。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    catchFireOnHurt: boolean;
    /**
     * @remarks
     * 如果为 true，抛射物在被玩家击中时会生成暴击粒子。例如：玩家攻击潜影贝子弹。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    critParticlesOnProjectileHurt: boolean;
    /**
     * @remarks
     * 如果为 true，抛射物在受到伤害时会被销毁。例如：玩家攻击潜影贝子弹。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    destroyOnProjectileHurt: boolean;
    /**
     * @remarks
     * 应用于抛射物的重力。当实体不在地面上时，每刻从抛射物的垂直位置变化中减去此值。值越高，抛射物下落越快。如果为负值，实体将上升而非下落。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    gravity: number;
    /**
     * @remarks
     * 抛射物击中实体时播放的声音。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    hitEntitySound?: string;
    /**
     * @remarks
     * 抛射物击中方块时播放的声音。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    hitGroundSound?: string;
    /**
     * @remarks
     * 抛射物击中某物时生成的粒子。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    hitParticle?: string;
    /**
     * @remarks
     * 如果为 true，且天气为雷暴，实体与天空之间无障碍物，则抛射物击中实体时会引雷。例如：带有引雷附魔的三叉戟。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    lightningStrikeOnHit: boolean;
    /**
     * @remarks
     * 抛射物在液体中飞行时每刻保持的速度比例。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    liquidInertia: number;
    /**
     * @remarks
     * 当 catchFireOnHurt 设置为 true 时，被击中的实体着火的持续时间（秒）。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    onFireTime: number;
    /**
     * @remarks
     * 抛射物的所有者。用于确定抛射物可以与哪些实体碰撞并造成伤害。同时确定哪个实体被指定为攻击者。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    owner?: Entity;
    /**
     * @remarks
     * 如果为 true，抛射物在未造成伤害时会从生物身上弹开。例如：生成中的凋灵。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    shouldBounceOnHit: boolean;
    /**
     * @remarks
     * 如果为 true，抛射物在击中实体时会停止移动，就像被阻挡了一样。例如：投掷三叉戟的命中行为。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    stopOnHit: boolean;
    static readonly componentId = 'minecraft:projectile';
    /**
     * @remarks
     * 以给定的速度发射抛射物。抛射物将从其当前位置发射。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param velocity
     * 发射抛射物的速度。这控制抛射物发射的速度和方向。
     * @param options
     * 发射的可选配置。
     * @throws
     * 如果组件或实体不再存在，则抛出异常。
     */
    shoot(velocity: Vector3, options?: ProjectileShootOptions): void;
}

/**
 * 设置实体可以挤过的距离。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityPushThroughComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 此实体的挤过距离值。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly value: number;
    static readonly componentId = 'minecraft:push_through';
}

/**
 * 实体从世界中移除时发生的事件的数据（例如，实体因距离玩家较远而被卸载）。
 */
export class EntityRemoveAfterEvent {
    private constructor();
    /**
     * @remarks
     * 被移除实体的 ID。
     *
     */
    readonly removedEntityId: string;
    /**
     * @remarks
     * 被移除实体的类型标识符 - 例如 'minecraft:skeleton'。
     *
     */
    readonly typeId: string;
}

/**
 * 允许注册一个事件，当实体从游戏中移除时触发（例如，卸载，或死亡后几秒钟）。
 */
export class EntityRemoveAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 每次实体从游戏中移除时都会调用你的函数。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 要调用的函数。
     * @param options
     * 此事件的额外过滤选项。
     * @returns
     * 返回一个闭包，可用于后续的取消订阅操作。
     */
    subscribe(
        callback: (arg0: EntityRemoveAfterEvent) => void,
        options?: EntityEventOptions,
    ): (arg0: EntityRemoveAfterEvent) => void;
    /**
     * @remarks
     * 取消订阅你的函数，使其在实体被移除时不再被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: EntityRemoveAfterEvent) => void): void;
}

/**
 * 实体正在从世界中移除时发生的事件的数据（例如，实体因距离玩家较远而被卸载）。
 */
export class EntityRemoveBeforeEvent {
    private constructor();
    /**
     * @remarks
     * 对正在被移除的实体的引用。
     *
     */
    readonly removedEntity: Entity;
}

/**
 * 允许注册一个事件，当实体正在从游戏中移除时触发（例如，卸载，或死亡后几秒钟）。
 */
export class EntityRemoveBeforeEventSignal {
    private constructor();
    /**
     * @remarks
     * 每次实体正在从游戏中移除时都会调用你的函数。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 要调用的函数。
     * 此闭包在受限执行权限下被调用。
     * @returns
     * 返回一个闭包，可用于后续的取消订阅操作。
     * 在受限执行权限下调用的闭包。
     */
    subscribe(callback: (arg0: EntityRemoveBeforeEvent) => void): (arg0: EntityRemoveBeforeEvent) => void;
    /**
     * @remarks
     * 取消订阅你的函数，使其在实体正在被移除时不再被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     */
    unsubscribe(callback: (arg0: EntityRemoveBeforeEvent) => void): void;
}

/**
 * 添加后，此组件增加了实体可以被其他实体骑乘的能力。
 * @example minibiomes.ts
 * ```typescript
 * import { EntityComponentTypes } from "@minecraft/server";
 * import { Test, register } from "@minecraft/server-gametest";
 * import { MinecraftBlockTypes, MinecraftEntityTypes } from "@minecraft/vanilla-data";
 *
 * function minibiomes(test: Test) {
 *   const minecart = test.spawn(MinecraftEntityTypes.Minecart, { x: 9, y: 7, z: 7 });
 *   const pig = test.spawn(MinecraftEntityTypes.Pig, { x: 9, y: 7, z: 7 });
 *
 *   test.setBlockType(MinecraftBlockTypes.Cobblestone, { x: 10, y: 7, z: 7 });
 *
 *   const minecartRideableComp = minecart.getComponent(EntityComponentTypes.Rideable);
 *
 *   minecartRideableComp?.addRider(pig);
 *
 *   test.succeedWhenEntityPresent(MinecraftEntityTypes.Pig, { x: 8, y: 3, z: 1 }, true);
 * }
 * register("ChallengeTests", "minibiomes", minibiomes).structureName("gametests:minibiomes").maxTicks(160);
 * ```
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityRideableComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 可用于控制此实体的座位索引（从零开始）。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly controllingSeat: number;
    /**
     * @remarks
     * 确定实体蹲下时是否不支持交互。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly crouchingSkipInteract: boolean;
    /**
     * @remarks
     * 当玩家看向此实体准备骑乘时应显示的一组文本（通常用于触屏控件）。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly interactText: string;
    /**
     * @remarks
     * 可以作为乘客的生物的最大宽度。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly passengerMaxWidth: number;
    /**
     * @remarks
     * 如果为 true，此实体将把具有正确 family_types 的实体拉入任何可用座位。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly pullInEntities: boolean;
    /**
     * @remarks
     * 如果为 true，骑手看向此实体时可以被拾取。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly riderCanInteract: boolean;
    /**
     * @remarks
     * 为此实体定义的骑手座位数量。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly seatCount: number;
    static readonly componentId = 'minecraft:rideable';
    /**
     * @remarks
     * 将一个实体添加为此实体的骑手。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param rider
     * 将成为此实体骑手的实体。
     * @returns
     * 如果骑手实体成功添加，则返回 true。
     * @throws 此函数可能会抛出错误。
     * @example minibiomes.ts
     * ```typescript
     * import { EntityComponentTypes } from "@minecraft/server";
     * import { Test, register } from "@minecraft/server-gametest";
     * import { MinecraftBlockTypes, MinecraftEntityTypes } from "@minecraft/vanilla-data";
     *
     * function minibiomes(test: Test) {
     *   const minecart = test.spawn(MinecraftEntityTypes.Minecart, { x: 9, y: 7, z: 7 });
     *   const pig = test.spawn(MinecraftEntityTypes.Pig, { x: 9, y: 7, z: 7 });
     *
     *   test.setBlockType(MinecraftBlockTypes.Cobblestone, { x: 10, y: 7, z: 7 });
     *
     *   const minecartRideableComp = minecart.getComponent(EntityComponentTypes.Rideable);
     *
     *   minecartRideableComp?.addRider(pig);
     *
     *   test.succeedWhenEntityPresent(MinecraftEntityTypes.Pig, { x: 8, y: 3, z: 1 }, true);
     * }
     * register("ChallengeTests", "minibiomes", minibiomes).structureName("gametests:minibiomes").maxTicks(160);
     * ```
     */
    addRider(rider: Entity): boolean;
    /**
     * @remarks
     * 移除此实体的指定骑手。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param rider
     * 应从该实体上被弹射出去的实体。
     * @throws 此函数可能会抛出错误。
     */
    ejectRider(rider: Entity): void;
    /**
     * @remarks
     * 移除此实体的所有骑手。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    ejectRiders(): void;
    /**
     * @remarks
     * 此实体支持作为骑手的实体类型字符串列表。
     *
     * @throws 此函数可能会抛出错误。
     */
    getFamilyTypes(): string[];
    /**
     * @remarks
     * 获取当前骑乘此实体的所有实体的列表。
     *
     * @throws 此函数可能会抛出错误。
     */
    getRiders(): Entity[];
    /**
     * @remarks
     * 获取骑乘此实体的每个座位的位置和骑手数量列表。
     *
     * @throws 此函数可能会抛出错误。
     */
    getSeats(): Seat[];
}

/**
 * 此组件在实体骑乘另一个实体时添加到该实体上。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityRidingComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 此实体当前正在骑乘的实体。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly entityRidingOn: Entity;
    static readonly componentId = 'minecraft:riding';
}

/**
 * 定义与此实体的饱和度交互。封装 `minecraft.player.saturation` 属性。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntitySaturationComponent extends EntityAttributeComponent {
    private constructor();
    static readonly componentId = 'minecraft:player.saturation';
}

/**
 * 设置实体的视觉大小。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityScaleComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 为实体设置的缩放属性的当前值。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly value: number;
    static readonly componentId = 'minecraft:scale';
}

/**
 * 皮肤 ID 值。可用于区分皮肤，例如村民的基础皮肤。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntitySkinIdComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 返回实体的皮肤 ID 标识符的值。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly value: number;
    static readonly componentId = 'minecraft:skin_id';
}

/**
 * 包含实体在世界中生成的相关数据。
 * @example logEntitySpawnEvent.ts
 * ```typescript
 * import { world, system, EntitySpawnAfterEvent, DimensionLocation } from "@minecraft/server";
 * import { Vector3Utils } from "@minecraft/math";
 *
 * function logEntitySpawnEvent(
 *   log: (message: string, status?: number) => void,
 *   targetLocation: DimensionLocation
 * ) {
 *   // register a new function that is called when a new entity is created.
 *   world.afterEvents.entitySpawn.subscribe((entityEvent: EntitySpawnAfterEvent) => {
 *     if (entityEvent && entityEvent.entity) {
 *       log(`New entity of type ${entityEvent.entity.typeId} created!`, 1);
 *     } else {
 *       log(`The entity event did not work as expected.`, -1);
 *     }
 *   });
 *
 *   system.runTimeout(() => {
 *     targetLocation.dimension.spawnEntity(
 *       "minecraft:horse<minecraft:ageable_grow_up>",
 *       Vector3Utils.add(targetLocation, { x: 0, y: 1, z: 0 })
 *     );
 *   }, 20);
 * }
 * ```
 */
export class EntitySpawnAfterEvent {
    private constructor();
    /**
     * @remarks
     * 初始化原因（生成、出生等）。
     *
     */
    readonly cause: EntityInitializationCause;
    /**
     * @remarks
     * 已生成的实体。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    entity: Entity;
}

/**
 * 注册一个基于脚本的事件处理器，用于处理实体生成时发生的情况。
 */
export class EntitySpawnAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 注册一个事件处理器，用于处理实体生成时发生的情况。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 处理生成事件的函数。
     * @example logEntitySpawnEvent.ts
     * ```typescript
     * import { world, system, EntitySpawnAfterEvent, DimensionLocation } from "@minecraft/server";
     * import { Vector3Utils } from "@minecraft/math";
     *
     * function logEntitySpawnEvent(
     *   log: (message: string, status?: number) => void,
     *   targetLocation: DimensionLocation
     * ) {
     *   // register a new function that is called when a new entity is created.
     *   world.afterEvents.entitySpawn.subscribe((entityEvent: EntitySpawnAfterEvent) => {
     *     if (entityEvent && entityEvent.entity) {
     *       log(`New entity of type ${entityEvent.entity.typeId} created!`, 1);
     *     } else {
     *       log(`The entity event did not work as expected.`, -1);
     *     }
     *   });
     *
     *   system.runTimeout(() => {
     *     targetLocation.dimension.spawnEntity(
     *       "minecraft:horse<minecraft:ageable_grow_up>",
     *       Vector3Utils.add(targetLocation, { x: 0, y: 1, z: 0 })
     *     );
     *   }, 20);
     * }
     * ```
     */
    subscribe(callback: (arg0: EntitySpawnAfterEvent) => void): (arg0: EntitySpawnAfterEvent) => void;
    /**
     * @remarks
     * 取消注册之前订阅到此订阅事件的方法。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 最初传入 subscribe 事件的函数，现在要取消注册。
     */
    unsubscribe(callback: (arg0: EntitySpawnAfterEvent) => void): void;
}

/**
 * 定义实体携带物品的能力。力量较高的实体具有更高的潜在携带容量和更多的物品槽位。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityStrengthComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 此实体的最大力量值，如实体类型定义中所定义。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly max: number;
    /**
     * @remarks
     * 为实体设置的力量组件的当前值。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly value: number;
    static readonly componentId = 'minecraft:strength';
}

/**
 * 定义玩家驯服实体的规则。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityTameableComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 返回一组可用于驯服此实体的物品。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly getTameItems: ItemStack[];
    /**
     * @remarks
     * 如果实体已被玩家驯服，则返回 true。

     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly isTamed: boolean;
    /**
     * @remarks
     * 每次使用物品驯服实体的概率，介于 0.0 和 1.0 之间，其中 1.0 为 100%。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly probability: number;
    /**
     * @remarks
     * 返回驯服了该实体的玩家，如果实体未被驯服则返回 'undefined'。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly tamedToPlayer?: Player;
    /**
     * @remarks
     * 返回驯服了该实体的玩家的 ID，如果实体未被驯服则返回 'undefined'。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly tamedToPlayerId?: string;
    static readonly componentId = 'minecraft:tameable';
    /**
     * @remarks
     * 将此实体设置为被指定玩家驯服。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param player
     * 此实体应被其驯服的玩家。
     * @returns
     * 如果实体被成功驯服，则返回 true。

     * @throws 此函数可能会抛出错误。
     */
    tame(player: Player): boolean;
}

/**
 * 包含基于骑乘实体驯服可骑乘实体的选项。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class EntityTameMountComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 如果实体已被驯服，则返回 true。

     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly isTamed: boolean;
    /**
     * @remarks
     * 如果实体已被玩家驯服，则返回 true。

     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly isTamedToPlayer: boolean;
    /**
     * @remarks
     * 返回驯服了该实体的玩家，如果实体未被玩家驯服则返回 'undefined'。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly tamedToPlayer?: Player;
    /**
     * @remarks
     * 返回驯服了该实体的玩家的 ID，如果实体未被驯服则返回 'undefined'。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly tamedToPlayerId?: string;
    static readonly componentId = 'minecraft:tamemount';
    /**
     * @remarks
     * 将此可骑乘实体设置为已驯服。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param showParticles
     * 驯服此实体时是否显示效果粒子。
     * @throws 此函数可能会抛出错误。
     */
    tame(showParticles: boolean): void;
    /**
     * @remarks
     * 将此可骑乘实体设置为被指定玩家驯服。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param showParticles
     * 驯服此实体时是否显示效果粒子。
     * @param player
     * 此实体应被其驯服的玩家。
     * @returns
     * 如果实体被成功驯服，则返回 true。

     * @throws 此函数可能会抛出错误。
     */
    tameToPlayer(showParticles: boolean, player: Player): boolean;
}

/**
 * 表示关于实体类型的信息。
 */
export class EntityType {
    private constructor();
    /**
     * @remarks
     * 此实体类型的标识符 - 例如 'minecraft:skeleton'。
     *
     */
    readonly id: string;
    /**
     * @remarks
     * 此 EntityType 名称本地化所用的键，在 .lang 文件中使用。
     *
     */
    readonly localizationKey: string;
}

// @ts-ignore 允许为本地定义的类进行类继承
export class EntityTypeFamilyComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:type_family';
    /**
     * @throws 此函数可能会抛出错误。
     */
    getTypeFamilies(): string[];
    /**
     * @throws 此函数可能会抛出错误。
     */
    hasTypeFamily(typeFamily: string): boolean;
}

/**
 * 用于访问世界中当前所有可用的
 * 实体类型。
 */
export class EntityTypes {
    private constructor();
    /**
     * @remarks
     * 使用基于字符串的标识符检索实体类型。
     *
     */
    static get(identifier: string): EntityType | undefined;
    /**
     * @remarks
     * 检索此世界中的所有实体类型集合。
     *
     */
    static getAll(): EntityType[];
}

/**
 * 定义此实体在水下的常规移动速度。
 *
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class EntityUnderwaterMovementComponent extends EntityAttributeComponent {
    private constructor();
    static readonly componentId = 'minecraft:underwater_movement';
}

/**
 * 用于将实体的变体组件组与其他实体区分开来
 * （例如：豹猫、村民）。
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class EntityVariantComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 当前实体的变体值，
     * 通过组件指定。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly value: number;
    static readonly componentId = 'minecraft:variant';
}

/**
 * 当添加此组件时，表示该实体
 * 想要成为骑手。
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class EntityWantsJockeyComponent extends EntityComponent {
    private constructor();
    static readonly componentId = 'minecraft:wants_jockey';
}

/**
 * 修改掉落的藏宝图以标记某处的
 * 战利品物品函数。
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ExplorationMapFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 确定掉落的藏宝图类型。
     *
     */
    readonly destination: string;
}

/**
 * 包含关于已发生爆炸的信息。
 *
 */
export class ExplosionAfterEvent {
    private constructor();
    /**
     * @remarks
     * 爆炸发生的维度。
     *
     */
    readonly dimension: Dimension;
    /**
     * @remarks
     * 爆炸的可选来源。
     *
     */
    readonly source?: Entity;
    /**
     * @remarks
     * 此爆炸事件影响的方块集合。
     *
     */
    getImpactedBlocks(): Block[];
}

/**
 * 管理与爆炸发生影响单个方块时
 * 相关的回调。
 */
export class ExplosionAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，当爆炸发生影响单个方块时
     * 发生时。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: ExplosionAfterEvent) => void): (arg0: ExplosionAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，当爆炸发生影响单个方块时
     * 发生时。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: ExplosionAfterEvent) => void): void;
}

/**
 * 包含关于已发生爆炸的信息。
 *
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ExplosionBeforeEvent extends ExplosionAfterEvent {
    private constructor();
    /**
     * @remarks
     * 如果设置为 true，则取消爆炸事件。
     *
     */
    cancel: boolean;
    /**
     * @remarks
     * 更新受此爆炸事件影响的
     * 方块集合。
     *
     * @param blocks
     * 受此爆炸影响的新方块列表。
     */
    setImpactedBlocks(blocks: Block[]): void;
}

/**
 * 管理连接到爆炸发生前的
 * 回调。
 */
export class ExplosionBeforeEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，将在爆炸发生前被调用。
     * 该回调可以选择性地修改或取消
     * 爆炸行为。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     * @returns
     * 在受限执行权限下调用的闭包。
     */
    subscribe(callback: (arg0: ExplosionBeforeEvent) => void): (arg0: ExplosionBeforeEvent) => void;
    /**
     * @remarks
     * 移除一个将在爆炸发生前被调用的
     * 回调。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     */
    unsubscribe(callback: (arg0: ExplosionBeforeEvent) => void): void;
}

/**
 * 确定战利品掉落是否应被爆炸摧毁的
 * 战利品物品函数。
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ExplosionDecayFunction extends LootItemFunction {
    private constructor();
}

/**
 * 作为可治疗组件的一部分，表示可以喂给实体
 * 以产生生命效果的特定物品。
 */
export class FeedItem {
    private constructor();
    /**
     * @remarks
     * 实体食用此物品时获得的生命值量。
     * 该数字是从 0 开始的整数。
     * 示例值最高可达 40。
     *
     */
    readonly healAmount: number;
    /**
     * @remarks
     * 可喂养物品类型的标识符。如果未指定命名空间，
     *
     * 则假定为 'minecraft:'。示例值包括 'wheat' 或 'golden_apple'。
     *
     *
     *
     *
     */
    readonly item: string;
    /**
     * @remarks
     * 喂养后产生的物品种类 ID。
     *
     * 通常为空，但用于某些场景，例如用鱼桶喂食鹦鹉螺，
     *
     * 结果物品将是一个空桶。
     *
     *
     *
     *
     */
    readonly resultItem?: string;
    /**
     * @remarks
     * 作为可治疗组件的一部分，可选的
     * 因食用物品而产生的副作用集合。
     *
     */
    getEffects(): FeedItemEffect[];
}

/**
 * 表示将食物喂给实体后所应用的效果。
 *
 */
export class FeedItemEffect {
    private constructor();
    /**
     * @remarks
     * 获取可能已应用于此效果的放大器。
     * 有效值是从 0 开始的整数，通常
     * 范围在 0 到 4 之间。
     *
     */
    readonly amplifier: number;
    /**
     * @remarks
     * 因实体食用此物品而应用此效果的
     * 概率。有效值范围在 0 到 1 之间。
     *
     */
    readonly chance: number;
    /**
     * @remarks
     * 获取此效果的持续时间
     * （以刻为单位）。
     *
     */
    readonly duration: number;
    /**
     * @remarks
     * 获取要应用的效果的标识符。示例值
     * 包括 'fire_resistance' 或 'regeneration'。
     *
     */
    readonly name: string;
}

/**
 * 使用另一个战利品表填充掉落的容器物品的
 * 战利品物品函数。
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class FillContainerFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 用于填充容器的战利品表路径。
     *
     */
    readonly lootTable: string;
}

/**
 * 表示与流体容器相关的常量。
 *
 */
export class FluidContainer {
    private constructor();
    /**
     * @remarks
     * 表示流体容器的最大填充水平
     * 的常量。
     *
     */
    static readonly maxFillLevel = 6;
    /**
     * @remarks
     * 表示流体容器的最小填充水平
     * 的常量。
     *
     */
    static readonly minFillLevel = 0;
}

/**
 * 包含关于已更改的游戏规则（world.gameRules）
 * 属性的信息。
 */
export class GameRuleChangeAfterEvent {
    private constructor();
    /**
     * @remarks
     * 更改后的 world.gameRules 属性
     * 的规则标识符。
     *
     */
    readonly rule: GameRule;
    /**
     * @remarks
     * 更改后的 world.gameRules 属性
     * 的值。
     *
     */
    readonly value: boolean | number;
}

/**
 * 管理与 world.gameRules 属性更改
 * 相关的回调。
 */
export class GameRuleChangeAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，将在 world.gameRules
     * 属性更改时被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: GameRuleChangeAfterEvent) => void): (arg0: GameRuleChangeAfterEvent) => void;
    /**
     * @remarks
     * 移除一个在 world.gameRules 属性更改时
     * 被调用的回调。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: GameRuleChangeAfterEvent) => void): void;
}

/**
 * 表示世界体验的游戏规则。
 *
 */
export class GameRules {
    private constructor();
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    commandBlockOutput: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    commandBlocksEnabled: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    doDayLightCycle: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    doEntityDrops: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    doFireTick: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    doImmediateRespawn: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    doInsomnia: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    doLimitedCrafting: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    doMobLoot: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    doMobSpawning: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    doTileDrops: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    doWeatherCycle: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    drowningDamage: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    fallDamage: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    fireDamage: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    freezeDamage: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    functionCommandLimit: number;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    keepInventory: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    maxCommandChainLength: number;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    mobGriefing: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    naturalRegeneration: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    playersSleepingPercentage: number;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    projectilesCanBreakBlocks: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    pvp: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    randomTickSpeed: number;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    recipesUnlock: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    respawnBlocksExplode: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    sendCommandFeedback: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    showBorderEffect: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    showCoordinates: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    showDaysPlayed: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    showDeathMessages: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    showRecipeMessages: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    showTags: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    spawnRadius: number;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    tntExplodes: boolean;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    tntExplosionDropDecay: boolean;
}

/**
 * 包含客户端实例的输入信息。
 *
 */
export class InputInfo {
    private constructor();
    /**
     * @remarks
     * 玩家最后使用的输入模式。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link InvalidEntityError}
     */
    readonly lastInputModeUsed: InputMode;
    /**
     * @remarks
     * 玩家的触摸输入是否仅
     * 影响触摸栏。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     */
    readonly touchOnlyAffectsHotbar: boolean;
    /**
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link InvalidEntityError}
     */
    getButtonState(button: InputButton): ButtonState;
    /**
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getMovementVector(): Vector2;
}

/**
 * 检查掉落战利品的实体是否为幼崽的
 * 战利品物品条件。
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class IsBabyCondition extends LootItemCondition {
    private constructor();
}

/**
 * 当存在于物品上时，此物品是一本书籍物品。
 * 可以访问和修改书籍内容
 * 并签名。
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ItemBookComponent extends ItemComponent {
    private constructor();
    /**
     * @remarks
     * 如果书籍已签名，则为书籍的作者姓名，
     * 否则为 undefined。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidItemStackError}
     */
    readonly author?: string;
    /**
     * @remarks
     * 书籍中字符串格式的页面内容。
     * 非字符串格式的条目将为 undefined。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidItemStackError}
     */
    readonly contents: (string | undefined)[];
    /**
     * @remarks
     * 确定书籍是否已签名。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidItemStackError}
     */
    readonly isSigned: boolean;
    /**
     * @remarks
     * 书籍的页数。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidItemStackError}
     */
    readonly pageCount: number;
    /**
     * @remarks
     * 书籍中 {@link RawMessage} 格式的
     * 页面内容。非 {@link RawMessage} 格式的
     * 条目将为 undefined。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidItemStackError}
     */
    readonly rawContents: (RawMessage | undefined)[];
    /**
     * @remarks
     * 如果书籍已签名，则为书籍的标题，
     * 否则为 undefined。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidItemStackError}
     */
    readonly title?: string;
    static readonly componentId = 'minecraft:book';
    /**
     * @remarks
     * 获取指定索引页面的字符串格式内容。
     *
     * @param pageIndex
     * 页面的索引。
     * @returns
     * 如果提供了有效索引且为字符串格式，则返回页面内容，
     * 否则返回 undefined。
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidItemStackError}
     */
    getPageContent(pageIndex: number): string | undefined;
    /**
     * @remarks
     * 获取指定索引页面的 {@link RawMessage}
     * 格式内容。
     *
     * @param pageIndex
     * 页面的索引。
     * @returns
     * 如果提供了有效索引且为 {@link RawMessage}
     * 格式，则返回页面内容，否则返回 undefined。
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidItemStackError}
     */
    getRawPageContent(pageIndex: number): RawMessage | undefined;
    /**
     * @remarks
     * 在指定索引处插入一页。如果索引大于当前书籍大小，
     * 将创建空白页。
     * 页面的字符串以及 {@link RawMessage} 的 JSON 表示形式的
     * 最大字符限制为 256。
     * 书籍最多可包含 50 页。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param pageIndex
     * 页面的索引。
     * @param content
     * 要设置的页面内容。可以是单个字符串、
     * {@link RawMessage} 或字符串和/或
     * {@link RawMessage}s 的数组
     * @throws 此函数可能会抛出错误。
     *
     * {@link BookError}
     *
     * {@link BookPageContentError}
     *
     * {@link InvalidItemStackError}
     */
    insertPage(pageIndex: number, content: (RawMessage | string)[] | RawMessage | string): void;
    /**
     * @remarks
     * 移除指定索引处的页面。此页面之后的现有页面
     * 将向前移动以填充空白位置。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param pageIndex
     * 页面的索引。
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidItemStackError}
     */
    removePage(pageIndex: number): void;
    /**
     * @remarks
     * 设置书籍页面的内容。预先存在的页面将被清除。
     * 页面的字符串以及 {@link RawMessage} 的 JSON 表示形式的
     * 最大字符限制为 256。
     * 书籍最多可包含 50 页。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param contents
     * 每页内容的数组。每页可以是单个字符串、
     * {@link RawMessage} 或字符串和/或
     * {@link RawMessage}s 的数组。
     * @throws 此函数可能会抛出错误。
     *
     * {@link BookError}
     *
     * {@link BookPageContentError}
     *
     * {@link InvalidItemStackError}
     */
    setContents(contents: ((RawMessage | string)[] | RawMessage | string)[]): void;
    /**
     * @remarks
     * 设置或创建特定页面的内容。如果索引大于当前
     * 书籍大小，将创建空白页。
     * 页面的字符串以及 {@link RawMessage} 的 JSON 表示形式的
     * 最大字符限制为 256。
     * 书籍最多可包含 50 页。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param pageIndex
     * 页面的索引。
     * @param content
     * 要设置的页面内容。可以是单个字符串、
     * {@link RawMessage} 或字符串和/或
     * {@link RawMessage}s 的数组。
     * @throws 此函数可能会抛出错误。
     *
     * {@link BookError}
     *
     * {@link BookPageContentError}
     *
     * {@link InvalidItemStackError}
     */
    setPageContent(pageIndex: number, content: (RawMessage | string)[] | RawMessage | string): void;
    /**
     * @remarks
     * 为书籍签名，赋予其标题和作者姓名。签名后
     * 玩家无法再直接编辑书籍。
     * 标题的最大字符限制为 16。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param title
     * 要赋予书籍的标题。
     * @param author
     * 书籍作者的姓名。
     * @throws 此函数可能会抛出错误。
     *
     * {@link BookError}
     *
     * {@link InvalidEntityError}
     *
     * {@link InvalidItemStackError}
     */
    signBook(title: string, author: string): void;
}

/**
 * 包含与可蓄力物品完成蓄力相关的信息。
 *
 */
export class ItemCompleteUseAfterEvent {
    private constructor();
    /**
     * @remarks
     * 返回已完成蓄力的物品堆叠。
     *
     */
    readonly itemStack: ItemStack;
    /**
     * @remarks
     * 返回触发此物品事件的源实体。
     *
     */
    readonly source: Player;
    /**
     * @remarks
     * 返回蓄力完成周期前剩余的
     * 持续时间（以刻为单位）。
     *
     */
    readonly useDuration: number;
}

/**
 * 管理与可蓄力物品完成蓄力相关的回调。
 *
 */
export class ItemCompleteUseAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，将在可蓄力物品
     * 完成蓄力时被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: ItemCompleteUseAfterEvent) => void): (arg0: ItemCompleteUseAfterEvent) => void;
    /**
     * @remarks
     * 移除一个在可蓄力物品完成蓄力时
     * 被调用的回调。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: ItemCompleteUseAfterEvent) => void): void;
}

/**
 * 包含与可蓄力物品完成蓄力相关的信息。
 *
 */
export class ItemCompleteUseEvent {
    private constructor();
    /**
     * @remarks
     * 返回已完成蓄力的物品堆叠。
     *
     */
    readonly itemStack: ItemStack;
    /**
     * @remarks
     * 返回触发此物品事件的源实体。
     *
     */
    readonly source: Player;
}

/**
 * 物品组件的基类。
 *
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ItemComponent extends Component {
    private constructor();
}

/**
 * 包含关于物品因击中实体而受损前
 * 的信息。
 */
export class ItemComponentBeforeDurabilityDamageEvent {
    private constructor();
    /**
     * @remarks
     * 攻击实体。
     *
     */
    readonly attackingEntity: Entity;
    /**
     * @remarks
     * 事件发生时应用到物品耐久度的
     * 伤害值。
     *
     */
    durabilityDamage: number;
    /**
     * @remarks
     * 被击中的实体。
     *
     */
    readonly hitEntity: Entity;
    /**
     * @remarks
     * 用于击中实体的物品堆叠。
     *
     */
    itemStack?: ItemStack;
}

/**
 * 包含与可蓄力物品通过组件完成蓄力
 * 相关的信息。
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ItemComponentCompleteUseEvent extends ItemCompleteUseEvent {
    private constructor();
}

/**
 * 包含与食物物品被食用相关的信息。
 *
 */
export class ItemComponentConsumeEvent {
    private constructor();
    /**
     * @remarks
     * 被食用的物品堆叠。
     *
     */
    readonly itemStack: ItemStack;
    /**
     * @remarks
     * 食用物品的源实体。
     *
     */
    readonly source: Entity;
}

/**
 * 包含关于物品用于击中实体时
 * 的信息。
 */
export class ItemComponentHitEntityEvent {
    private constructor();
    /**
     * @remarks
     * 攻击实体。
     *
     */
    readonly attackingEntity: Entity;
    /**
     * @remarks
     * 击中是否命中或产生任何效果。
     *
     */
    readonly hadEffect: boolean;
    /**
     * @remarks
     * 被击中的实体。
     *
     */
    readonly hitEntity: Entity;
    /**
     * @remarks
     * 用于击中实体的物品堆叠。
     *
     */
    readonly itemStack?: ItemStack;
}

/**
 * 包含关于使用物品挖掘方块的信息。
 *
 */
export class ItemComponentMineBlockEvent {
    private constructor();
    /**
     * @remarks
     * 受此事件影响的方块。
     *
     */
    readonly block: Block;
    /**
     * @remarks
     * 用于挖掘方块的物品堆叠。
     *
     */
    readonly itemStack?: ItemStack;
    /**
     * @remarks
     * 被挖掘的方块置换。
     *
     */
    readonly minedBlockPermutation: BlockPermutation;
    /**
     * @remarks
     * 挖掘方块的实体。
     *
     */
    readonly source: Entity;
}

/**
 * 提供为物品注册自定义组件的功能。
 *
 */
export class ItemComponentRegistry {
    private constructor();
    /**
     * @remarks
     * 注册一个可在物品 JSON 配置中使用的
     * 物品自定义组件。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param name
     * 表示此自定义组件的 ID。
     * 必须具有命名空间。
     * 此 ID 可以在物品的 JSON 配置中的
     * 'minecraft:custom_components' 下指定。
     * 组件，则返回错误。
     * @param itemCustomComponent
     * 在此自定义组件 ID 的物品上发生事件时
     * 将调用的
     * 事件函数集合。
     * @throws 此函数可能会抛出错误。
     *
     * {@link CustomComponentInvalidRegistryError}
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link ItemCustomComponentAlreadyRegisteredError}
     *
     * {@link ItemCustomComponentReloadNewComponentError}
     *
     * {@link ItemCustomComponentReloadNewEventError}
     *
     * {@link ItemCustomComponentReloadVersionError}
     *
     * {@link NamespaceNameError}
     */
    registerCustomComponent(name: string, itemCustomComponent: ItemCustomComponent): void;
}

/**
 * 包含关于物品使用的信息。
 *
 */
export class ItemComponentUseEvent {
    private constructor();
    /**
     * @remarks
     * 物品使用时的物品堆叠。
     *
     */
    readonly itemStack?: ItemStack;
    /**
     * @remarks
     * 使用物品的玩家。
     *
     */
    readonly source: Player;
}

/**
 * 包含关于通过组件在方块上使用物品
 * 的信息。
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ItemComponentUseOnEvent extends ItemUseOnEvent {
    private constructor();
    /**
     * @remarks
     * 在方块上使用物品的实体。
     *
     */
    readonly source: Entity;
    /**
     * @remarks
     * 物品被使用处的方块置换。
     *
     */
    readonly usedOnBlockPermutation: BlockPermutation;
}

/**
 * 当存在时，如果堆肥概率在 [1 - 100] 范围内，
 * 该物品可以在堆肥桶中堆肥。
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ItemCompostableComponent extends ItemComponent {
    private constructor();
    /**
     * @remarks
     * 物品在堆肥桶中堆肥并产生堆肥层的
     * 百分比概率。请注意，
     * 此 API 也会返回
     * 可堆肥的原版物品的堆肥概率，
     * 即使它们未使用
     * 可堆肥物品组件。
     *
     * @throws
     * 如果值超出 [1 - 100] 范围则抛出错误。
     */
    readonly compostingChance: number;
    static readonly componentId = 'minecraft:compostable';
}

/**
 * 当存在于物品上时，此物品在被实体使用时
 * 具有冷却效果。
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ItemCooldownComponent extends ItemComponent {
    private constructor();
    /**
     * @remarks
     * 表示此物品关联的冷却类别。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly cooldownCategory: string;
    /**
     * @remarks
     * 此物品冷却所需的时长
     * （以刻为单位）。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly cooldownTicks: number;
    static readonly componentId = 'minecraft:cooldown';
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    getCooldownTicksRemaining(player: Player): number;
    /**
     * @remarks
     * 如果物品属于传入的冷却类别则返回 true，
     * 否则返回 false。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param cooldownCategory
     * 可能与此物品关联的冷却类别。
     * @returns
     * 如果物品属于给定的冷却类别则返回 true。
     * @throws 此函数可能会抛出错误。
     */
    isCooldownCategory(cooldownCategory: string): boolean;
    /**
     * @remarks
     * 为此物品启动一个新的冷却周期。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    startCooldown(player: Player): void;
}

/**
 * 物品上自定义组件的实例。
 *
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ItemCustomComponentInstance extends ItemComponent {
    private constructor();
    readonly customComponentParameters: CustomComponentParameters;
}

/**
 * 当存在于物品上时，此物品在使用过程中可以受到耐久度损伤。
 * 请注意，此组件仅适用于数据驱动的物品。
 * @example giveHurtDiamondSword.ts
 * ```typescript
 * import { world, ItemStack, EntityInventoryComponent, EntityComponentTypes, ItemComponentTypes, ItemDurabilityComponent, DimensionLocation } from "@minecraft/server";
 * import { MinecraftItemTypes } from "@minecraft/vanilla-data";
 *
 * function giveHurtDiamondSword(
 *     targetLocation: DimensionLocation
 * ) {
 *   const hurtDiamondSword = new ItemStack(MinecraftItemTypes.DiamondSword);
 *
 *   const durabilityComponent = hurtDiamondSword.getComponent(ItemComponentTypes.Durability) as ItemDurabilityComponent;
 *
 *   if (durabilityComponent !== undefined) {
 *     durabilityComponent.damage = durabilityComponent.maxDurability / 2;
 *   }
 *
 *   for (const player of world.getAllPlayers()) {
 *     const inventory = player.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent;
 *     if (inventory && inventory.container) {
 *       inventory.container.addItem(hurtDiamondSword);
 *     }
 *   }
 * }
 * ```
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ItemDurabilityComponent extends ItemComponent {
    private constructor();
    /**
     * @remarks
     * 返回此特定物品的当前耐久度损伤值。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    damage: number;
    /**
     * @remarks
     * 表示此物品在损坏前可以承受的
     * 耐久度损伤值。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly maxDurability: number;
    /**
     * @remarks
     * 物品是否会损坏或失去耐久度。设置为 true
     * 会临时移除物品的耐久度 HUD，并冻结
     * 物品的耐久度损失。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    unbreakable: boolean;
    static readonly componentId = 'minecraft:durability';
    /**
     * @remarks
     * 返回此物品在给定特定等级的不毁附魔的情况下，
     * 使用 damageRange 属性造成耐久度损伤的
     * 最大概率。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param unbreakingEnchantmentLevel
     * 计算耐久度损伤概率时要考虑的
     * 不毁等级。传入的 unbreaking 参数
     * 必须在 [0, 3] 范围内。
     * 默认值：0
     * 范围：[0, 3]
     * @throws 此函数可能会抛出错误。
     */
    getDamageChance(unbreakingEnchantmentLevel?: number): number;
    /**
     * @remarks
     * 用于计算物品耐久度损伤概率的数字范围。
     * 耐久度损伤概率将落在此范围内。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    getDamageChanceRange(): minecraftcommon.NumberRange;
}

/**
 * 当存在于物品上时，此物品可以被染色。
 *
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ItemDyeableComponent extends ItemComponent {
    private constructor();
    /**
     * @remarks
     * 设置并返回物品的当前颜色。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    color?: RGB;
    /**
     * @remarks
     * 返回物品的默认颜色。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly defaultColor?: RGB;
    static readonly componentId = 'minecraft:dyeable';
}

/**
 * 当存在于物品上时，此物品可以应用附魔。
 *
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ItemEnchantableComponent extends ItemComponent {
    private constructor();
    /**
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly slots: EnchantmentSlot[];
    static readonly componentId = 'minecraft:enchantable';
    /**
     * @remarks
     * 向物品堆叠添加一个附魔。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param enchantment
     * 要添加的附魔接口。
     * @throws
     * ScriptItemEnchantmentUnknownIdError：如果附魔类型
     * 不存在则抛出异常。
     *
     *
     * ScriptItemEnchantmentLevelOutOfBoundsError：如果附魔等级超出
     * 给定附魔类型的允许范围则
     * 抛出异常。
     *
     * ScriptItemEnchantmentTypeNotCompatibleError：如果附魔
     * 与物品堆叠不兼容则
     * 抛出异常。
     *
     *
     * {@link EnchantmentLevelOutOfBoundsError}
     *
     * {@link EnchantmentTypeNotCompatibleError}
     *
     * {@link EnchantmentTypeUnknownIdError}
     *
     * {@link Error}
     */
    addEnchantment(enchantment: Enchantment): void;
    /**
     * @remarks
     * 向物品堆叠添加一个附魔列表。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param enchantments
     * 要添加的附魔列表。
     * @throws
     * ScriptItemEnchantmentUnknownIdError：如果任何附魔类型
     * 不存在则抛出异常。
     *
     *
     * ScriptItemEnchantmentLevelOutOfBoundsError：如果任何附魔等级超出
     * 给定附魔类型的允许范围则抛出异常。
     *
     * ScriptItemEnchantmentTypeNotCompatibleError：如果任何附魔
     * 与物品堆叠不兼容则抛出异常。
     *
     *
     * {@link EnchantmentLevelOutOfBoundsError}
     *
     * {@link EnchantmentTypeNotCompatibleError}
     *
     * {@link EnchantmentTypeUnknownIdError}
     *
     * {@link Error}
     */
    addEnchantments(enchantments: Enchantment[]): void;
    /**
     * @remarks
     * 检查附魔是否可以添加到
     * 物品堆叠。
     *
     * @param enchantment
     * 要添加的附魔接口。
     * @returns
     * 如果附魔可以添加到
     * 物品堆叠则返回 true。
     *
     * @throws
     * ScriptItemEnchantmentUnknownIdError：如果附魔类型
     * 不存在则抛出异常。
     *
     *
     * ScriptItemEnchantmentLevelOutOfBoundsError：如果附魔等级超出
     * 给定附魔类型的允许范围则
     * 抛出异常。
     *
     *
     * {@link EnchantmentLevelOutOfBoundsError}
     *
     * {@link EnchantmentTypeUnknownIdError}
     */
    canAddEnchantment(enchantment: Enchantment): boolean;
    /**
     * @remarks
     * 从物品堆叠中获取给定类型的附魔。
     *
     * @param enchantmentType
     * 要获取的附魔类型。
     * @returns
     * 如果物品堆叠上存在该附魔则返回该附魔。
     * @throws
     * ScriptItemEnchantmentUnknownIdError：如果附魔类型
     * 不存在则抛出异常。

     *
     *
     * {@link EnchantmentTypeUnknownIdError}
     */
    getEnchantment(enchantmentType: EnchantmentType | string): Enchantment | undefined;
    /**
     * @remarks
     * 获取物品堆叠上的所有附魔。
     *
     * @returns
     * 返回物品堆叠上的附魔列表。
     * @throws 此函数可能会抛出错误。
     */
    getEnchantments(): Enchantment[];
    /**
     * @remarks
     * 检查物品堆叠是否具有给定附魔类型。
     *
     * @param enchantmentType
     * 要检查的附魔类型。
     * @returns
     * 如果物品堆叠具有该附魔类型则返回 true。
     *
     * @throws
     * ScriptItemEnchantmentUnknownIdError：如果附魔类型
     * 不存在则抛出异常。

     *
     *
     * {@link EnchantmentTypeUnknownIdError}
     */
    hasEnchantment(enchantmentType: EnchantmentType | string): boolean;
    /**
     * @remarks
     * 移除应用于此物品堆叠的所有附魔。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    removeAllEnchantments(): void;
    /**
     * @remarks
     * 移除给定类型的附魔。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param enchantmentType
     * 要移除的附魔类型。
     * @throws
     * ScriptItemEnchantmentUnknownIdError：如果附魔类型
     * 不存在则抛出异常。

     *
     *
     * {@link EnchantmentTypeUnknownIdError}
     *
     * {@link Error}
     */
    removeEnchantment(enchantmentType: EnchantmentType | string): void;
}

/**
 * 当存在于物品上时，此物品可被实体食用。
 * 请注意，此组件仅适用于
 * 数据驱动的物品。
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ItemFoodComponent extends ItemComponent {
    private constructor();
    /**
     * @remarks
     * 如果为 true，则玩家可以随时
     * 食用此物品（即使不饿）。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly canAlwaysEat: boolean;
    /**
     * @remarks
     * 表示此食物物品被食用时将为实体
     * 提供的营养值。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly nutrition: number;
    /**
     * @remarks
     * 当物品被食用时，此值将根据以下公式
     * (nutrition * saturation_modifier * 2) 应用饱和度效果。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly saturationModifier: number;
    /**
     * @remarks
     * 指定时，将活动物品转换为
     * 此属性指定的物品。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly usingConvertsTo: string;
    static readonly componentId = 'minecraft:food';
}

/**
 * 此组件添加到具有 `Storage Item` 组件的物品上。
 * 可以访问和修改此物品的库存容器。
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ItemInventoryComponent extends ItemComponent {
    private constructor();
    /**
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidContainerError}
     */
    readonly container: Container;
    static readonly componentId = 'minecraft:inventory';
}

/**
 * 当存在于物品上时，此物品是药水物品。
 *
 */
// @ts-ignore 允许为本地定义的类进行类继承
export class ItemPotionComponent extends ItemComponent {
    private constructor();
    /**
     * @remarks
     * 与药水物品关联的药水传递类型。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link Error}
     */
    readonly potionDeliveryType: PotionDeliveryType;
    /**
     * @remarks
     * 与药水物品关联的药水效果类型。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link Error}
     */
    readonly potionEffectType: PotionEffectType;
    static readonly componentId = 'minecraft:potion';
}

/**
 * 包含与可蓄力物品在玩家完成使用并
 * 释放蓄力操作时
 * 相关的信息。
 */
export class ItemReleaseUseAfterEvent {
    private constructor();
    /**
     * @remarks
     * 返回触发此物品事件的物品堆叠。
     *
     */
    readonly itemStack?: ItemStack;
    /**
     * @remarks
     * 返回触发此物品事件的源实体。
     *
     */
    readonly source: Player;
    /**
     * @remarks
     * 返回蓄力完成周期前剩余的
     * 持续时间（以刻为单位）。
     *
     */
    readonly useDuration: number;
}

/**
 * 管理与可蓄力物品释放蓄力相关的回调。
 *
 */
export class ItemReleaseUseAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，将在可蓄力物品
     * 释放蓄力时被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: ItemReleaseUseAfterEvent) => void): (arg0: ItemReleaseUseAfterEvent) => void;
    /**
     * @remarks
     * 移除一个在可蓄力物品释放蓄力时
     * 被调用的回调。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: ItemReleaseUseAfterEvent) => void): void;
}

/**
 * 定义物品集合。
 * @example itemStacks.ts
 * ```typescript
 * import { ItemStack, DimensionLocation } from "@minecraft/server";
 * import { MinecraftItemTypes } from "@minecraft/vanilla-data";
 *
 * function itemStacks(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const oneItemLoc = { x: targetLocation.x + targetLocation.y + 3, y: 2, z: targetLocation.z + 1 };
 *   const fiveItemsLoc = { x: targetLocation.x + 1, y: targetLocation.y + 2, z: targetLocation.z + 1 };
 *   const diamondPickaxeLoc = { x: targetLocation.x + 2, y: targetLocation.y + 2, z: targetLocation.z + 4 };
 *
 *   const oneEmerald = new ItemStack(MinecraftItemTypes.Emerald, 1);
 *   const onePickaxe = new ItemStack(MinecraftItemTypes.DiamondPickaxe, 1);
 *   const fiveEmeralds = new ItemStack(MinecraftItemTypes.Emerald, 5);
 *
 *   log(`Spawning an emerald at (${oneItemLoc.x}, ${oneItemLoc.y}, ${oneItemLoc.z})`);
 *   targetLocation.dimension.spawnItem(oneEmerald, oneItemLoc);
 *
 *   log(`Spawning five emeralds at (${fiveItemsLoc.x}, ${fiveItemsLoc.y}, ${fiveItemsLoc.z})`);
 *   targetLocation.dimension.spawnItem(fiveEmeralds, fiveItemsLoc);
 *
 *   log(`Spawning a diamond pickaxe at (${diamondPickaxeLoc.x}, ${diamondPickaxeLoc.y}, ${diamondPickaxeLoc.z})`);
 *   targetLocation.dimension.spawnItem(onePickaxe, diamondPickaxeLoc);
 * }
 * ```
 * @example givePlayerEquipment.ts
 * ```typescript
 * import { world, ItemStack, EntityEquippableComponent, EquipmentSlot, EntityComponentTypes, DimensionLocation } from "@minecraft/server";
 * import { MinecraftItemTypes } from "@minecraft/vanilla-data";
 *
 * function givePlayerEquipment(
 *     targetLocation: DimensionLocation
 * ) {
 *   const players = world.getAllPlayers();
 *
 *   const armorStandLoc = { x: targetLocation.x, y: targetLocation.y, z: targetLocation.z + 4 };
 *   const armorStand = players[0].dimension.spawnEntity(MinecraftItemTypes.ArmorStand, armorStandLoc);
 *
 *   const equipmentCompPlayer = players[0].getComponent(EntityComponentTypes.Equippable) as EntityEquippableComponent;
 *   if (equipmentCompPlayer) {
 *     equipmentCompPlayer.setEquipment(EquipmentSlot.Head, new ItemStack(MinecraftItemTypes.GoldenHelmet));
 *     equipmentCompPlayer.setEquipment(EquipmentSlot.Chest, new ItemStack(MinecraftItemTypes.IronChestplate));
 *     equipmentCompPlayer.setEquipment(EquipmentSlot.Legs, new ItemStack(MinecraftItemTypes.DiamondLeggings));
 *     equipmentCompPlayer.setEquipment(EquipmentSlot.Feet, new ItemStack(MinecraftItemTypes.NetheriteBoots));
 *     equipmentCompPlayer.setEquipment(EquipmentSlot.Mainhand, new ItemStack(MinecraftItemTypes.WoodenSword));
 *     equipmentCompPlayer.setEquipment(EquipmentSlot.Offhand, new ItemStack(MinecraftItemTypes.Shield));
 *   }
 *
 *   const equipmentCompArmorStand = armorStand.getComponent(EntityComponentTypes.Equippable) as EntityEquippableComponent;
 *   if (equipmentCompArmorStand) {
 *     equipmentCompArmorStand.setEquipment(EquipmentSlot.Head, new ItemStack(MinecraftItemTypes.GoldenHelmet));
 *     equipmentCompArmorStand.setEquipment(EquipmentSlot.Chest, new ItemStack(MinecraftItemTypes.IronChestplate));
 *     equipmentCompArmorStand.setEquipment(EquipmentSlot.Legs, new ItemStack(MinecraftItemTypes.DiamondLeggings));
 *     equipmentCompArmorStand.setEquipment(EquipmentSlot.Feet, new ItemStack(MinecraftItemTypes.NetheriteBoots));
 *     equipmentCompArmorStand.setEquipment(EquipmentSlot.Mainhand, new ItemStack(MinecraftItemTypes.WoodenSword));
 *     equipmentCompArmorStand.setEquipment(EquipmentSlot.Offhand, new ItemStack(MinecraftItemTypes.Shield));
 *   }
 * }
 * ```
 * @example spawnFeatherItem.ts
 * ```typescript
 * import { ItemStack, DimensionLocation } from "@minecraft/server";
 * import { MinecraftItemTypes } from "@minecraft/vanilla-data";
 *
 * function spawnFeatherItem(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const featherItem = new ItemStack(MinecraftItemTypes.Feather, 1);
 *
 *   targetLocation.dimension.spawnItem(featherItem, targetLocation);
 *   log(`New feather created at ${targetLocation.x}, ${targetLocation.y}, ${targetLocation.z}!`);
 * }
 * ```
 */
export class ItemStack {
    /**
     * @remarks
     * 堆叠中的物品数量。有效值范围在
     * 1-255 之间。提供的值将被限制为物品的
     * 最大堆叠大小。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     * 范围：[1, 255]
     * @throws
     * 如果值超出 1-255 范围则抛出错误。
     */
    amount: number;
    /**
     * @remarks
     * 返回物品是否可堆叠。如果物品的最大堆叠大小大于 1
     * 且物品不包含任何自定义数据或属性，
     * 则该物品被视为可堆叠。
     *
     */
    readonly isStackable: boolean;
    /**
     * @remarks
     * 获取或设置物品在死亡时是否保留。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    keepOnDeath: boolean;
    /**
     * @remarks
     * 此物品名称在 .lang 文件中
     * 本地化的键。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link minecraftcommon.EngineError}
     */
    readonly localizationKey: string;
    /**
     * @remarks
     * 获取或设置物品的锁定模式。
     * 默认值为 `ItemLockMode.none`。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    lockMode: ItemLockMode;
    /**
     * @remarks
     * 最大堆叠大小。此值根据物品类型而变化。
     * 例如，火把的最大堆叠大小为 64，
     * 而鸡蛋的最大堆叠大小为 16。
     *
     */
    readonly maxAmount: number;
    /**
     * @remarks
     * 此物品堆叠的给定名称。鼠标悬停在物品上时
     * 会显示名称标签。将名称标签设置为空字符串
     * 或 `undefined` 将移除名称标签。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     * @throws
     * 如果长度超过 255 个字符则抛出错误。
     */
    nameTag?: string;
    /**
     * @remarks
     * 物品的类型。
     *
     */
    readonly 'type': ItemType;
    /**
     * @remarks
     * 堆叠的物品类型标识符。如果未指定命名空间，
     * 则假定为 'minecraft:'。示例包括 'wheat' 或 'apple'。
     *
     */
    readonly typeId: string;
    /**
     * @remarks
     * 堆叠中所有物品的总重量加上使用 `Storage Item`
     * 组件定义的物品容器中所有物品的重量。
     * 每个物品的重量可以通过 `Storage Weight Modifier` 组件修改。
     *
     */
    readonly weight: number;
    /**
     * @remarks
     * 创建用于在世界中使用的物品堆叠的
     * 新实例。
     *
     * @param itemType
     * 要创建的物品类型。请参阅 {@link
     * @minecraft/vanilla-data.MinecraftItemTypes} 枚举
     * 获取 Minecraft 体验中标准物品类型的列表。
     * @param amount
     * 要放入堆叠的物品数量，范围 1-255。The
     * 提供的值将被限制为物品的最大堆叠大小。
     * 请注意，某些物品每个堆叠只能有一个物品。
     * 堆叠只能有一个。
     * 默认值：1
     * 范围：[1, 255]
     * @throws
     * 如果 `itemType` 无效或 `amount` 超出
     * 1-255 范围则抛出错误。
     */
    constructor(itemType: ItemType | string, amount?: number);
    /**
     * @remarks
     * 清除已在此物品堆叠上设置的
     * 所有动态属性。
     *
     */
    clearDynamicProperties(): void;
    /**
     * @remarks
     * 创建物品堆叠的精确副本，包括任何
     * 自定义数据或属性。
     *
     * @returns
     * 返回此物品堆叠的副本。
     */
    clone(): ItemStack;
    /**
     * @remarks
     * 获取此物品在冒险模式下可以破坏的
     * 方块类型列表。
     *
     * 此函数不能在限制执行模式下调用。
     *
     */
    getCanDestroy(): string[];
    /**
     * @remarks
     * 获取此物品在冒险模式下可以放置的
     * 方块类型列表。
     *
     * 此函数不能在限制执行模式下调用。
     *
     */
    getCanPlaceOn(): string[];
    /**
     * @remarks
     * 获取物品堆叠的组件
     * （表示附加功能）。
     *
     * @param componentId
     * 组件的标识符（例如 'minecraft:food'）。如果
     * 未指定命名空间，则默认为 'minecraft:'。
     * 可用的组件 ID 包括 {@link ItemComponentTypes} 枚举中的
     * 以及使用 {@link ItemComponentRegistry} 注册的
     * 自定义组件 ID。
     * @returns
     * 如果物品堆叠上存在该组件则返回该组件，
     * 否则返回 undefined。
     * @example giveHurtDiamondSword.ts
     * ```typescript
     * import { world, ItemStack, EntityInventoryComponent, EntityComponentTypes, ItemComponentTypes, ItemDurabilityComponent, DimensionLocation } from "@minecraft/server";
     * import { MinecraftItemTypes } from "@minecraft/vanilla-data";
     *
     * function giveHurtDiamondSword(
     *     targetLocation: DimensionLocation
     * ) {
     *   const hurtDiamondSword = new ItemStack(MinecraftItemTypes.DiamondSword);
     *
     *   const durabilityComponent = hurtDiamondSword.getComponent(ItemComponentTypes.Durability) as ItemDurabilityComponent;
     *
     *   if (durabilityComponent !== undefined) {
     *     durabilityComponent.damage = durabilityComponent.maxDurability / 2;
     *   }
     *
     *   for (const player of world.getAllPlayers()) {
     *     const inventory = player.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent;
     *     if (inventory && inventory.container) {
     *       inventory.container.addItem(hurtDiamondSword);
     *     }
     *   }
     * }
     * ```
     */
    getComponent<T extends string>(componentId: T): ItemComponentReturnType<T> | undefined;
    /**
     * @remarks
     * 返回此物品堆叠上存在的
     * 所有脚本组件。
     *
     */
    getComponents(): ItemComponent[];
    /**
     * @remarks
     * 返回属性值。
     *
     *
     * @param ident
     *
     * ifier 属性标识符。
     *
     * @returns 返回属
     *
     * 性的值，如果属性尚未设置则返回 undefined。
     *
     *
     *
     */
    getDynamicProperty(identifier: string): boolean | number | string | Vector3 | undefined;
    /**
     * @remarks
     * 返回已在此实体上使用
     *
     * 的动态属性标识符集合。
     *
     *
     * @returns 在此实体
     *
     * 上设置的动态属性字符串数组。
     *
     */
    getDynamicPropertyIds(): string[];
    /**
     * @remarks
     * 返回当前为此实体存储的所有动态属性
     * 的总大小（以字节为单位）。

     * 这包括键和值的大小。这对于
     * 诊断性能警告信号非常有用——

     * 例如，如果一个实体有许多兆字节的关联
     * 动态属性，它在各种设备上可能加载缓慢。
     *
     */
    getDynamicPropertyTotalByteCount(): number;
    /**
     * @remarks
     * 返回 ItemStack 的 lore 值
     * （辅助显示字符串）。
     *
     * @returns
     * 一组 lore 行。如果物品没有 lore，
     * 则返回空数组。
     */
    getLore(): string[];
    /**
     * @remarks
     * 返回 ItemStack 的 lore 值
     * （辅助显示字符串）。字符串
     * lore 行将被转换为
     * {@link RawMessage} 并放入 {@link RawMessage.text} 下。
     *
     * @returns
     * 一组 lore 行。如果物品没有 lore，
     * 则返回空数组。
     */
    getRawLore(): RawMessage[];
    /**
     * @remarks
     * 返回与此物品堆叠关联的标签集合。
     *
     */
    getTags(): string[];
    /**
     * @remarks
     * 返回 true 如果指定的组件
     * 存在于此物品堆叠
     * 上。

     *
     * @param componentId
     * 要检索的组件标识符
     * （例如 'minecraft:food'）。
     * 如果未指定命名空间前缀，
     * 则假定为 'minecraft:'。
     */
    hasComponent(componentId: string): boolean;
    /**
     * @remarks
     * 检查此物品堆叠是否具有
     * 特定关联标签。
     *
     * @param tag
     * 要搜索的标签。
     * @returns
     * 如果物品堆叠具有关联标签则返回 true，
     * 否则返回 false。
     */
    hasTag(tag: string): boolean;
    /**
     * @remarks
     * 返回此物品堆叠是否可以与
     * 给定的 `itemStack` 堆叠。

     * 这是通过比较物品类型以及任何与物品堆叠关联的
     * 自定义数据和属性来确定的。
     * 每个物品堆叠的数量
     * 不在考虑范围内，但对于不可堆叠的物品，
     * 此方法始终返回 false。
     *
     * @param itemStack
     * 要检查堆叠兼容性的 ItemStack。
     * @returns
     * 如果该 ItemStack 与传入的 itemStack 可堆叠则返回 true。
     * 对于不可堆叠的物品返回 false。
     */
    isStackableWith(itemStack: ItemStack): boolean;
    /**
     * @remarks
     * 检查物品是否匹配的版本安全方式。
     *
     * @param itemName
     * 物品的标识符。
     * @param states
     * 仅适用于方块。可选的要比较的状态集合。
     * 如果未指定 states，则匹配检查物品
     * 类型集合。
     * @returns
     * 返回指定的物品是否匹配的布尔值。
     */
    matches(itemName: string, states?: Record<string, boolean | number | string>): boolean;
    /**
     * @remarks
     * 此物品在冒险模式下可以破坏的方块类型列表。
     * 方块名称会显示在物品的工具提示中。
     * 将值设置为 undefined 将清除列表。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param blockIdentifiers
     * 物品可以破坏的方块类型的字符串列表。
     * @throws
     * 如果任何提供的方块标识符无效则抛出错误。
     * @example giveDestroyRestrictedPickaxe.ts
     * ```typescript
     * import { world, ItemStack, EntityInventoryComponent, DimensionLocation } from "@minecraft/server";
     * import { MinecraftItemTypes } from "@minecraft/vanilla-data";
     *
     * function giveDestroyRestrictedPickaxe(
     *     targetLocation: DimensionLocation
     * ) {
     *   for (const player of world.getAllPlayers()) {
     *     const specialPickaxe = new ItemStack(MinecraftItemTypes.DiamondPickaxe);
     *     specialPickaxe.setCanDestroy([MinecraftItemTypes.Cobblestone, MinecraftItemTypes.Obsidian]);
     *
     *     const inventory = player.getComponent("inventory") as EntityInventoryComponent;
     *     if (inventory === undefined || inventory.container === undefined) {
     *       return;
     *     }
     *
     *     inventory.container.addItem(specialPickaxe);
     *   }
     * }
     * ```
     */
    setCanDestroy(blockIdentifiers?: string[]): void;
    /**
     * @remarks
     * 此物品在冒险模式下可以放置的方块类型列表。
     * 这仅适用于方块物品。方块名称会显示在物品的工具提示中。
     * 将值设置为 undefined 将清除列表。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param blockIdentifiers
     * 物品可以放置的方块类型的字符串列表。
     * @throws
     * 如果任何提供的方块标识符无效则抛出错误。
     * @example givePlaceRestrictedGoldBlock.ts
     * ```typescript
     * import { world, ItemStack, EntityInventoryComponent, EntityComponentTypes, DimensionLocation } from "@minecraft/server";
     * import { MinecraftItemTypes } from "@minecraft/vanilla-data";
     *
     * function givePlaceRestrictedGoldBlock(
     *     targetLocation: DimensionLocation
     * ) {
     *   for (const player of world.getAllPlayers()) {
     *     const specialGoldBlock = new ItemStack(MinecraftItemTypes.GoldBlock);
     *     specialGoldBlock.setCanPlaceOn([MinecraftItemTypes.GrassBlock, MinecraftItemTypes.Dirt]);
     *
     *     const inventory = player.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent;
     *     if (inventory === undefined || inventory.container === undefined) {
     *       return;
     *     }
     *
     *     inventory.container.addItem(specialGoldBlock);
     *   }
     * }
     * ```
     */
    setCanPlaceOn(blockIdentifiers?: string[]): void;
    /**
     * @remarks
     * 设置多个具有特定值的动态属性。
     *
     *
     * @param value
     *
     * s 要设置的动态属性键值对记录。如果数据值为 n
     *
     * ull，则改为移除该属性。
     *
     *
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link minecraftcommon.UnsupportedFunctionalityError}
     */
    setDynamicProperties(values: Record<string, boolean | number | string | Vector3 | undefined>): void;
    /**
     * @remarks
     * 将指定属性设置为一个值。请注意：
     * 此函数仅适用于不可堆叠的物品。
     *
     *
     * @param ident
     *
     * ifier 属性标识符。
     *
     * @param value 要
     *
     * 设置的属性数据值。如果值为 null，则改为移除该属性。
     *
     *
     *
     * @throws
     * 如果物品堆叠是可堆叠的则抛出错误。
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link minecraftcommon.UnsupportedFunctionalityError}
     */
    setDynamicProperty(identifier: string, value?: boolean | number | string | Vector3): void;
    /**
     * @remarks
     * 设置 ItemStack 的 lore 值
     * （辅助显示字符串）。如果设置为空字符串
     * 或 undefined，则清除 lore 列表。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param loreList
     * lore 行列表。列表中的每个元素代表一个新行。
     * 最大 lore 行数为 20。最大 lore 行长度为 50 个字符。
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link Error}
     * @example diamondAwesomeSword.ts
     * ```typescript
     * import { EntityComponentTypes, ItemStack, Player } from '@minecraft/server';
     * import { MinecraftItemTypes } from '@minecraft/vanilla-data';
     *
     * function giveAwesomeSword(player: Player) {
     *     const diamondAwesomeSword = new ItemStack(MinecraftItemTypes.DiamondSword, 1);
     *     diamondAwesomeSword.setLore([
     *         '§c§lDiamond Sword of Awesome§r',
     *          '+10 coolness', '§p+4 shiny§r'
     *     ]);
     *
     *     // hover over/select the item in your inventory to see the lore.
     *     const inventory = player.getComponent(EntityComponentTypes.Inventory);
     *     if (inventory === undefined || inventory.container === undefined) {
     *         return;
     *     }
     *
     *     inventory.container.setItem(0, diamondAwesomeSword);
     * }
     * ```
     */
    setLore(loreList?: (RawMessage | string)[]): void;
}

/**
 * 包含与可蓄力物品开始蓄力相关的信息。
 *
 */
export class ItemStartUseAfterEvent {
    private constructor();
    /**
     * @remarks
     * 正在开始蓄力的受影响物品堆叠。
     *
     */
    readonly itemStack: ItemStack;
    /**
     * @remarks
     * 返回触发此物品事件的源实体。
     *
     */
    readonly source: Player;
    /**
     * @remarks
     * 返回蓄力完成周期前剩余的
     * 持续时间（以刻为单位）。
     *
     */
    readonly useDuration: number;
}

/**
 * 管理开始蓄力相关的回调。
 *
 */
export class ItemStartUseAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，将在可蓄力物品
     * 开始蓄力时被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: ItemStartUseAfterEvent) => void): (arg0: ItemStartUseAfterEvent) => void;
    /**
     * @remarks
     * 移除一个在可蓄力物品开始蓄力时
     * 被调用的回调。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: ItemStartUseAfterEvent) => void): void;
}

/**
 * 包含与物品在方块上使用相关的信息。当玩家按下
 * 使用物品/放置方块按钮成功使用物品或放置方块时
 * 触发此事件。在执行建筑操作时，为第一个被
 * 交互的方块触发。注意：此事件不能与
 * 锄头或斧头物品一起使用。
 *
 */
export class ItemStartUseOnAfterEvent {
    private constructor();
    /**
     * @remarks
     * 物品所使用的方块。
     *
     */
    readonly block: Block;
    /**
     * @remarks
     * 物品正在使用的方块面。
     *
     */
    readonly blockFace: Direction;
    /**
     * @remarks
     * 正在开始使用的受影响物品堆栈。在某些游戏场景中可能为
     * undefined，例如空手按下按钮时。
     *
     */
    readonly itemStack?: ItemStack;
    /**
     * @remarks
     * 返回触发此物品事件的源实体。
     *
     */
    readonly source: Player;
}

/**
 * 管理与物品开始在方块上使用事件相关的回调。
 *
 */
export class ItemStartUseOnAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，当物品在
      * 一个方块上时将被调用。
      *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: ItemStartUseOnAfterEvent) => void): (arg0: ItemStartUseOnAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，当物品在
      * 一个方块上时不再调用。
      *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: ItemStartUseOnAfterEvent) => void): void;
}

/**
 * 包含与可蓄力物品已完成物品使用周期相关的信息，
 * 或当玩家释放物品使用动作时。
 *
 */
export class ItemStopUseAfterEvent {
    private constructor();
    /**
     * @remarks
     * 正在停止蓄力的受影响物品堆栈。
     * ItemStopUseAfterEvent 可能在传送到
     * 不同维度时被调用，此时该值可能为 undefined。
     *
     */
    readonly itemStack?: ItemStack;
    /**
     * @remarks
     * 返回触发此物品事件的源实体。
     *
     */
    readonly source: Player;
    /**
     * @remarks
     * 返回在蓄力完成其周期之前剩余的时间（以刻为单位）。
     *
     */
    readonly useDuration: number;
}

/**
  * 管理与可蓄力物品停止蓄力相关的回调。
 * 用于已注册
 * minecraft:chargeable 组件的物品。
 *
 */
export class ItemStopUseAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，当可蓄力物品停止蓄力时将被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: ItemStopUseAfterEvent) => void): (arg0: ItemStopUseAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，当可蓄力物品停止蓄力时不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: ItemStopUseAfterEvent) => void): void;
}

/**
 * 包含与物品已停止在方块上使用相关的信息。当玩家
 * 按下使用物品/放置方块按钮成功使用物品或
 * 放置方块时触发此事件。如果放置了多个方块，
 * 此事件仅在方块放置开始时触发一次。
 * 注意：此事件不能与锄头或斧头物品一起使用。
 *
 */
export class ItemStopUseOnAfterEvent {
    private constructor();
    /**
     * @remarks
     * 物品所使用的方块。
     *
     */
    readonly block: Block;
    /**
     * @remarks
     * 在方块上正在使用的受影响物品堆栈。
     *
     */
    readonly itemStack?: ItemStack;
    /**
     * @remarks
     * 返回触发此物品事件的源实体。
     *
     */
    readonly source: Player;
}

/**
 * 管理与物品停止在方块上使用事件相关的回调。
 *
 */
export class ItemStopUseOnAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，当物品停止在方块上使用时将被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: ItemStopUseOnAfterEvent) => void): (arg0: ItemStopUseOnAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，当物品在
      * 一个方块上时不再调用。
      *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: ItemStopUseOnAfterEvent) => void): void;
}

/**
 * 表示物品的类型——例如，羊毛。
 *
 */
export class ItemType {
    private constructor();
    /**
     * @remarks
     * 返回物品类型的标识符——例如，
     * 'minecraft:apple'。
     *
     */
    readonly id: string;
    /**
     * @remarks
     * 此 ItemType 名称用于本地化的键，用于
     * .lang 文件。
     *
     */
    readonly localizationKey: string;
}

/**
 * 返回 Minecraft 中注册的所有物品类型集合。
 *
 */
export class ItemTypes {
    private constructor();
    /**
     * @remarks
     * 返回一个特定的物品类型（如果在 Minecraft 中可用）。
     *
     */
    static get(itemId: string): ItemType | undefined;
    /**
     * @remarks
     * 检索所有在 Minecraft 中注册的可用物品类型。
     *
     *
     */
    static getAll(): ItemType[];
}

/**
 * 包含与物品在方块上使用相关的信息。当玩家使用的物品
 * 成功触发实体交互时触发此事件。
 *
 */
export class ItemUseAfterEvent {
    private constructor();
    /**
     * @remarks
     * 正在被使用的受影响物品堆栈。
     *
     */
    itemStack: ItemStack;
    /**
     * @remarks
     * 返回触发此物品事件的源实体。
     *
     */
    readonly source: Player;
}

/**
  * 管理物品使用事件的回调。
  *
 */
export class ItemUseAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，当物品被使用时将被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: ItemUseAfterEvent) => void): (arg0: ItemUseAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，当物品被使用时不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: ItemUseAfterEvent) => void): void;
}

/**
 * 包含与物品被使用相关的信息。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class ItemUseBeforeEvent extends ItemUseAfterEvent {
    private constructor();
    /**
     * @remarks
     * 如果设置为 true，将取消物品使用行为。
     *
     */
    cancel: boolean;
}

/**
  * 管理在物品使用前触发的回调。
  *
 */
export class ItemUseBeforeEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在物品被使用之前将被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     * @returns
     * 在受限执行权限下调用的闭包。
     *
     */
    subscribe(callback: (arg0: ItemUseBeforeEvent) => void): (arg0: ItemUseBeforeEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在物品被使用之前不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     *
     */
    unsubscribe(callback: (arg0: ItemUseBeforeEvent) => void): void;
}

/**
  * 包含关于物品在方块上使用的信息。
  * 。
  *
 */
export class ItemUseOnEvent {
    private constructor();
    /**
     * @remarks
     * 此事件影响的方块。
     *
     */
    readonly block: Block;
    /**
     * @remarks
     * 物品被使用的方块面。
     *
     */
    readonly blockFace: Direction;
    /**
     * @remarks
      * 相对于方块底部西北角的交互位置
     * item was used on.
     *
     */
    readonly faceLocation: Vector3;
    /**
     * @remarks
     * 在方块上使用的物品堆栈。
     *
     */
    readonly itemStack: ItemStack;
}

/**
 * 战利品条件，用于检查掉落来源是否被特定类型的实体杀死。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class KilledByEntityCondition extends LootItemCondition {
    private constructor();
    /**
     * @remarks
     * 此条件需要满足的实体类型。例如：
     *
     * 'minecraft:skeleton'。
     *
     *
     */
    readonly entityType: string;
}

/**
 * 战利品条件，用于检查掉落来源是否被玩家杀死。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class KilledByPlayerCondition extends LootItemCondition {
    private constructor();
}

/**
 * 战利品条件，用于检查掉落来源是否被玩家或玩家的任何宠物杀死。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class KilledByPlayerOrPetsCondition extends LootItemCondition {
    private constructor();
}

/**
  * 包含与拉杆激活或取消激活变化相关的信息。
 * 激活或取消激活。
 * @example leverActionEvent.ts
 * ```typescript
 * import { world, system, BlockPermutation, LeverActionAfterEvent, DimensionLocation } from "@minecraft/server";
 * import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
 *
 * function leverActionEvent(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   // set up a lever
 *   const cobblestone = targetLocation.dimension.getBlock(targetLocation);
 *   const lever = targetLocation.dimension.getBlock({
 *     x: targetLocation.x,
 *     y: targetLocation.y + 1,
 *     z: targetLocation.z,
 *   });
 *
 *   if (cobblestone === undefined || lever === undefined) {
 *     log("Could not find block at ");
 *     return -1;
 *   }
 *
 *   cobblestone.setPermutation(BlockPermutation.resolve(MinecraftBlockTypes.Cobblestone));
 *   lever.setPermutation(
 *     BlockPermutation.resolve(MinecraftBlockTypes.Lever).withState("lever_direction", "up_north_south")
 *   );
 *
 *   world.afterEvents.leverAction.subscribe((leverActionEvent: LeverActionAfterEvent) => {
 *     const eventLoc = leverActionEvent.block.location;
 *
 *     if (eventLoc.x === targetLocation.x && eventLoc.y === targetLocation.y + 1 && eventLoc.z === targetLocation.z) {
 *       log("Lever activate event at tick " + system.currentTick);
 *     }
 *   });
 * }
 * ```
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class LeverActionAfterEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
     * 如果拉杆已激活（即正在传输电力）则为 true。
     *
     */
    readonly isPowered: boolean;
    /**
     * @remarks
     * 触发拉杆激活的可选玩家。
     *
     */
    readonly player: Player;
}

/**
  * 管理与拉杆移动（激活或取消激活）相关的回调。
 * （激活或取消激活）。
 * @example leverActionEvent.ts
 * ```typescript
 * import { world, system, BlockPermutation, LeverActionAfterEvent, DimensionLocation } from "@minecraft/server";
 * import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
 *
 * function leverActionEvent(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   // set up a lever
 *   const cobblestone = targetLocation.dimension.getBlock(targetLocation);
 *   const lever = targetLocation.dimension.getBlock({
 *     x: targetLocation.x,
 *     y: targetLocation.y + 1,
 *     z: targetLocation.z,
 *   });
 *
 *   if (cobblestone === undefined || lever === undefined) {
 *     log("Could not find block at ");
 *     return -1;
 *   }
 *
 *   cobblestone.setPermutation(BlockPermutation.resolve(MinecraftBlockTypes.Cobblestone));
 *   lever.setPermutation(
 *     BlockPermutation.resolve(MinecraftBlockTypes.Lever).withState("lever_direction", "up_north_south")
 *   );
 *
 *   world.afterEvents.leverAction.subscribe((leverActionEvent: LeverActionAfterEvent) => {
 *     const eventLoc = leverActionEvent.block.location;
 *
 *     if (eventLoc.x === targetLocation.x && eventLoc.y === targetLocation.y + 1 && eventLoc.z === targetLocation.z) {
 *       log("Lever activate event at tick " + system.currentTick);
 *     }
 *   });
 * }
 * ```
 *
 */
export class LeverActionAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，当拉杆被移动（激活或取消激活）时将被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: LeverActionAfterEvent) => void): (arg0: LeverActionAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，当拉杆被移动（激活或取消激活）时不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: LeverActionAfterEvent) => void): void;
}

/**
 * 在点之间线性插值的样条曲线。
 *
 */
export class LinearSpline {
    /**
     * @remarks
     * 线性样条曲线的控制点。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    controlPoints: Vector3[];
}

/**
 * 由唯一方块位置的无序容器组成的体积。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class ListBlockVolume extends BlockVolumeBase {
    /**
     * @remarks
     * 创建 ListBlockVolume 的新实例。
     *
     * @param locations
     * 用于构造 ListBlockVolume 的初始方块位置数组。
     *
     */
    constructor(locations: Vector3[]);
    /**
     * @remarks
     * 将方块位置插入容器。
     *
     * @param locations
     * 要插入到容器中的方块位置数组。
     *
     */
    add(locations: Vector3[]): void;
    /**
     * @remarks
     * 从容器的方块位置。
     *
     * @param locations
     * 要从容器的方块位置数组。
     *
     */
    remove(locations: Vector3[]): void;
}

/**
 * 战利品物品函数，如果提供的工具具有抢夺附魔，
 * 则会掉落额外物品。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class LootingEnchantFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 函数随机选择额外物品掉落数量的值范围。包含最小值
     * 和最大值。
     *
     */
    readonly count: minecraftcommon.NumberRange;
}

/**
 * 表示包含要掉落物品的战利品池条目。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class LootItem extends LootPoolEntry {
    private constructor();
    readonly functions: LootItemFunction[];
    /**
     * @remarks
     * 此条目中包含的物品名称。
     *
     */
    readonly name?: ItemType;
}

/**
 * 所有战利品条件派生自的抽象基类。战利品条件是一组规则或
 * 要求，必须满足才能进行战利品掉落。
 *
 */
export class LootItemCondition {
    private constructor();
}

/**
 * 所有战利品函数派生自的抽象基类。
 * 战利品函数可以在战利品掉落时以多种方式修改它们，
 * 可选地依赖于一组必须满足的条件。
 *
 */
export class LootItemFunction {
    private constructor();
    readonly conditions: LootItemCondition[];
}

/**
 * 一组条目，分别确定战利品
 * 掉落。可以包含确定掉落结果的值，
 * 包括投掷次数、奖励投掷次数和等级。
 *
 */
export class LootPool {
    private constructor();
    /**
     * @remarks
     * 根据玩家的幸运等级，战利品池将额外投掷的次数，
     * 表示为一个从最小到最大投掷次数的范围。
     *
     */
    readonly bonusRolls: minecraftcommon.NumberRange;
    readonly conditions: LootItemCondition[];
    /**
     * @remarks
     * 获取战利品池中包含的所有战利品池条目的完整列表。
     *
     */
    readonly entries: LootPoolEntry[];
    /**
     * @remarks
     * 返回战利品池将投掷的次数，
     * 表示为一个从最小到最大投掷次数的范围。
     *
     */
    readonly rolls: minecraftcommon.NumberRange;
    /**
     * @remarks
     * 获取给定战利品表的战利品池等级值（如果存在）。
     *
     */
    readonly tiers?: LootPoolTiers;
}

/**
 * 表示战利品表中的一个条目，描述战利品掉落时的一个
 * 可能掉落物。可以包含一个物品、
 * 另一个战利品表、另一个战利品表的路径，或者
 * 空掉落。
 *
 */
export class LootPoolEntry {
    private constructor();
    /**
     * @remarks
     * 获取给定战利品池条目的质量。
     *
     */
    readonly quality: number;
    /**
     * @remarks
     * 获取给定战利品池条目的子表。
     *
     */
    readonly subTable?: LootPoolEntry;
    /**
     * @remarks
     * 获取给定战利品池条目的权重。
     *
     */
    readonly weight: number;
}

/**
 * 表示确定分级战利品池中战利品掉落的值。
 * 分级战利品池的潜在掉落物是有序的，
 * 并通过此对象中的值控制的逻辑进行选择。
 *
 */
export class LootPoolTiers {
    private constructor();
    /**
     * @remarks
     * 每次额外奖励投掷尝试升级掉落物品等级的机会。
     *
     */
    readonly bonusChance: number;
    /**
     * @remarks
     * 战利品掉落尝试升级其等级的次数，
     * 从而增加其在战利品池条目数组中的位置，
     * 从而产生更高等级的掉落。
     *
     */
    readonly bonusRolls: number;
    /**
     * @remarks
     * 表示确定掉落战利品等级时起点的上限。
     * 下限始终为 1。例如，值为 3 将导致等级
     * 掉落逻辑从战利品池条目数组中
     * 在 1 到 3 之间随机选择的位置开始。
     *
     */
    readonly initialRange: number;
}

/**
 * 表示单个战利品表，确定在
 * 击杀生物、破坏方块、填充容器等情况下生成哪些物品。
 *
 */
export class LootTable {
    private constructor();
    /**
     * @remarks
     * 返回表示此战利品表的 JSON 文件的路径。
     * 不包括文件扩展名或 'loot_tables/'
     * 文件夹前缀。示例：`entities/creeper`。
     *
     */
    readonly path: string;
    /**
     * @remarks
     * 返回给定战利品表上的战利品池数组。
     *
     */
    readonly pools: LootPool[];
}

/**
 * 表示包含另一个独立的嵌套战利品表的战利品池条目。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class LootTableEntry extends LootPoolEntry {
    private constructor();
    /**
     * @remarks
     * 获取作为子表存储在父战利品池中的战利品表。
     *
     */
    readonly lootTable: LootTable;
}

/**
 * 战利品表相关 API 的管理器。允许根据战利品表
 * 从方块和实体生成掉落物。
 *
 */
export class LootTableManager {
    private constructor();
    /**
     * @remarks
     * 从给定的方块生成战利品，如同该方块已被开采。
     *
     * @param block
     * 要从中生成战利品的方块。
     * @param tool
     * 可选。在抢夺操作中使用的工具。
     * @returns
     * 从战利品掉落事件中掉落的物品堆栈数组。
     * 如果没有掉落战利品则可能为空，如果
     * 提供的工具不足以开采该方块则为 undefined。
     * @throws
     * 如果方块位于未加载的区块中，或方块位置超出世界边界则抛出错误。
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     *
     * {@link UnloadedChunksError}
     *
     */
    generateLootFromBlock(block: Block, tool?: ItemStack): ItemStack[] | undefined;
    /**
     * @remarks
     * 从给定的方块置换生成战利品，如同该方块已被开采。
     *
     * @param tool
     * 可选。在抢夺操作中使用的工具。
     * @returns
     * 从战利品掉落事件中掉落的物品堆栈数组。
     * 如果没有掉落战利品则可能为空，如果
     * 提供的工具不足以开采该方块则为 undefined。
     *
     */
    generateLootFromBlockPermutation(blockPermutation: BlockPermutation, tool?: ItemStack): ItemStack[] | undefined;
    /**
     * @remarks
     * 从给定的方块类型生成战利品，如同该方块已被开采。
     *
     * @param tool
     * 可选。在抢夺操作中使用的工具。
     * @returns
     * 从战利品掉落事件中掉落的物品堆栈数组。
     * 如果没有掉落战利品则可能为空，如果
     * 提供的工具不足以开采该方块则为 undefined。
     *
     */
    generateLootFromBlockType(scriptBlockType: BlockType, tool?: ItemStack): ItemStack[] | undefined;
    /**
     * @remarks
     * 从给定的实体生成战利品，如同该实体已被击杀。
     *
     * @param tool
     * 可选。在抢夺操作中使用的工具。
     * @returns
     * 从战利品掉落事件中掉落的物品堆栈数组。
     * 如果没有掉落战利品则可能为空，如果实体无效则为 undefined。
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     *
     */
    generateLootFromEntity(entity: Entity, tool?: ItemStack): ItemStack[] | undefined;
    /**
     * @remarks
     * 从给定的实体类型生成战利品，如同该实体已被击杀。
     *
     * @param tool
     * 可选。在抢夺操作中使用的工具。
     * @returns
     * 从战利品掉落事件中掉落的物品堆栈数组。
     * 如果没有掉落战利品则可能为空。
     *
     */
    generateLootFromEntityType(entityType: EntityType, tool?: ItemStack): ItemStack[] | undefined;
    /**
     * @remarks
     * 从给定的战利品表生成战利品。
     *
     * @param tool
     * 可选。在抢夺操作中使用的工具。
     * @returns
     * 从战利品掉落事件中掉落的物品堆栈数组。
     * 如果没有掉落战利品则可能为空，如果
     * 提供的工具不足以开采该方块则为 undefined。
     *
     */
    generateLootFromTable(lootTable: LootTable, tool?: ItemStack): ItemStack[] | undefined;
    /**
     * @remarks
     * 从世界的当前注册表中检索单个战利品表。
     *
     * @param path
     * 要检索的表的路径。不包括文件
     * 扩展名或 'loot_tables/' 文件夹前缀。示例：
     * `entities/creeper`。
     * @returns
     * 如果找到则返回 LootTable，如果提供的路径不对应现有战利品表则返回 `undefined`。
     *
     */
    getLootTable(path: string): LootTable | undefined;
}

/**
 * 表示包含对另一个战利品表的引用（通过其路径描述）的战利品池条目。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class LootTableReference extends LootPoolEntry {
    private constructor();
    /**
     * @remarks
     * 被引用的战利品表的路径。示例：
     * `loot_tables/chests/village/village_bundle.json`
     *
     */
    readonly path: string;
}

/**
 * 战利品条件，用于检查是否使用了适当的工具来触发战利品事件。
 * 可以描述物品类型、数量、耐久度、附魔或要比较的物品标签数组。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class MatchToolCondition extends LootItemCondition {
    private constructor();
    /**
     * @remarks
     * 此条件通过所需的堆栈大小或数量。
     *
     */
    readonly count: minecraftcommon.NumberRange;
    /**
     * @remarks
     * 此条件通过所需的耐久度值。
     *
     */
    readonly durability: minecraftcommon.NumberRange;
    /**
     * @remarks
     * 此条件通过所需的附魔数组。
     *
     */
    readonly enchantments: EnchantInfo[];
    /**
     * @remarks
     * 此条件通过所需的工具物品名称。
     *
     */
    readonly itemName: string;
    /**
     * @remarks
     * 所有都必须匹配此条件才能通过的物品标签数组。
     *
     */
    readonly itemTagsAll: string[];
    /**
     * @remarks
     * 至少需要匹配 1 个此条件才能通过的物品标签数组。
     *
     */
    readonly itemTagsAny: string[];
    /**
     * @remarks
     * 必须正好匹配 0 个此条件才能通过的物品标签数组。
     *
     */
    readonly itemTagsNone: string[];
}

/**
  * 包含一组额外的变量值，用于进一步
  * 定义渲染和动画的功能。
  *
 */
export class MolangVariableMap {
    /**
     * @remarks
     * 向 Molang 添加以下变量：
     * - `<variable_name>.r` - 红色颜色值 [0-1]
     * - `<variable_name>.g` - 绿色颜色值 [0-1]
     * - `<variable_name>.b` - 蓝色颜色值 [0-1]
     *
     * @throws 此函数可能会抛出错误。
     *
     */
    setColorRGB(variableName: string, color: RGB): void;
    /**
     * @remarks
     * 向 Molang 添加以下变量：
     * - `<variable_name>.r` - 红色颜色值 [0-1]
     * - `<variable_name>.g` - 绿色颜色值 [0-1]
     * - `<variable_name>.b` - 蓝色颜色值 [0-1]
     * - `<variable_name>.a` - Alpha（透明度）颜色值 [0-1]
     *
     * @throws 此函数可能会抛出错误。
     *
     */
    setColorRGBA(variableName: string, color: RGBA): void;
    /**
     * @remarks
     * 在 Molang 变量映射中设置一个数值（小数）。
     *
     * @param variableName
     * 要设置的浮点数的名称。
     * @param number
     * 要设置的 Molang 变量的值。
     * @throws 此函数可能会抛出错误。
     *
     */
    setFloat(variableName: string, number: number): void;
    /**
     * @remarks
     * 向 Molang 添加以下变量：
     * - `<variable_name>.speed` - 提供的速度数值
     * - `<variable_name>.direction_x` - 提供的 {@link Vector3} 的 X 值
     * - `<variable_name>.direction_y` - 提供的 {@link Vector3} 的 Y 值
     * - `<variable_name>.direction_z` - 提供的 {@link Vector3} 的 Z 值
     *
     * @throws 此函数可能会抛出错误。
     *
     */
    setSpeedAndDirection(variableName: string, speed: number, direction: Vector3): void;
    /**
     * @remarks
     * 向 Molang 添加以下变量：
     * - `<variable_name>.x` - 提供的 {@link Vector3} 的 X 值
     * - `<variable_name>.y` - 提供的 {@link Vector3} 的 Y 值
     * - `<variable_name>.z` - 提供的 {@link Vector3} 的 Z 值
     *
     * @throws 此函数可能会抛出错误。
     *
     */
    setVector3(variableName: string, vector: Vector3): void;
}

/**
 * 战利品条件，用于检查抢夺实体当前是否为特定类型实体的乘客。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class PassengerOfEntityCondition extends LootItemCondition {
    private constructor();
    /**
     * @remarks
     * 此条件通过所需的实体类型。
     *
     */
    readonly entityType: string;
}

/**
  * 包含与活塞伸出或收回变化相关的信息。
 * 伸出或收回。
 * @example pistonAfterEvent.ts
 * ```typescript
 * import { world, system, BlockPermutation, BlockPistonState, PistonActivateAfterEvent, DimensionLocation } from "@minecraft/server";
 * import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
 *
 * function pistonAfterEvent(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   // set up a couple of piston blocks
 *   const piston = targetLocation.dimension.getBlock(targetLocation);
 *   const button = targetLocation.dimension.getBlock({
 *     x: targetLocation.x,
 *     y: targetLocation.y + 1,
 *     z: targetLocation.z,
 *   });
 *
 *   if (piston === undefined || button === undefined) {
 *     log("Could not find block at ");
 *     return -1;
 *   }
 *
 *   piston.setPermutation(BlockPermutation.resolve(MinecraftBlockTypes.Piston).withState("facing_direction", 3));
 *   button.setPermutation(BlockPermutation.resolve(MinecraftBlockTypes.AcaciaButton).withState("facing_direction", 1));
 *
 *   world.afterEvents.pistonActivate.subscribe((pistonEvent: PistonActivateAfterEvent) => {
 *     const eventLoc = pistonEvent.piston.block.location;
 *
 *     if (eventLoc.x === targetLocation.x && eventLoc.y === targetLocation.y && eventLoc.z === targetLocation.z) {
 *       log(
 *         "Piston event at " +
 *           system.currentTick +
 *           (pistonEvent.piston.isMoving ? " Moving" : "") +
 *           (pistonEvent.piston.state === BlockPistonState.Expanding ? " Expanding" : "") +
 *           (pistonEvent.piston.state === BlockPistonState.Expanded ? " Expanded" : "") +
 *           (pistonEvent.piston.state === BlockPistonState.Retracting ? " Retracting" : "") +
 *           (pistonEvent.piston.state === BlockPistonState.Retracted ? " Retracted" : "")
 *       );
 *     }
 *   });
 * }
 * ```
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class PistonActivateAfterEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
     * 如果活塞正在伸出过程中则为 true。
     *
     */
    readonly isExpanding: boolean;
    /**
     * @remarks
     * 包含活塞的附加属性和详细信息。
     *
     */
    readonly piston: BlockPistonComponent;
}

/**
  * 管理与活塞激活相关的回调。
  *
 */
export class PistonActivateAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，当活塞伸出或收回时将被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @example pistonAfterEvent.ts
     * ```typescript
     * import { world, system, BlockPermutation, BlockPistonState, PistonActivateAfterEvent, DimensionLocation } from "@minecraft/server";
     * import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
     *
     * function pistonAfterEvent(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
     *   // set up a couple of piston blocks
     *   const piston = targetLocation.dimension.getBlock(targetLocation);
     *   const button = targetLocation.dimension.getBlock({
     *     x: targetLocation.x,
     *     y: targetLocation.y + 1,
     *     z: targetLocation.z,
     *   });
     *
     *   if (piston === undefined || button === undefined) {
     *     log("Could not find block at ");
     *     return -1;
     *   }
     *
     *   piston.setPermutation(BlockPermutation.resolve(MinecraftBlockTypes.Piston).withState("facing_direction", 3));
     *   button.setPermutation(BlockPermutation.resolve(MinecraftBlockTypes.AcaciaButton).withState("facing_direction", 1));
     *
     *   world.afterEvents.pistonActivate.subscribe((pistonEvent: PistonActivateAfterEvent) => {
     *     const eventLoc = pistonEvent.piston.block.location;
     *
     *     if (eventLoc.x === targetLocation.x && eventLoc.y === targetLocation.y && eventLoc.z === targetLocation.z) {
     *       log(
     *         "Piston event at " +
     *           system.currentTick +
     *           (pistonEvent.piston.isMoving ? " Moving" : "") +
     *           (pistonEvent.piston.state === BlockPistonState.Expanding ? " Expanding" : "") +
     *           (pistonEvent.piston.state === BlockPistonState.Expanded ? " Expanded" : "") +
     *           (pistonEvent.piston.state === BlockPistonState.Retracting ? " Retracting" : "") +
     *           (pistonEvent.piston.state === BlockPistonState.Retracted ? " Retracted" : "")
     *       );
     *     }
     *   });
     * }
     * ```
     *
     */
    subscribe(callback: (arg0: PistonActivateAfterEvent) => void): (arg0: PistonActivateAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，当活塞伸出或收回时不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PistonActivateAfterEvent) => void): void;
}

/**
 * 表示世界中的玩家。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class Player extends Entity {
    private constructor();
    /**
     * @remarks
     * 玩家的摄像机。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     */
    readonly camera: Camera;
    /**
     * @remarks
     * 包含玩家的设备信息。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     */
    readonly clientSystemInfo: ClientSystemInfo;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    commandPermissionLevel: CommandPermissionLevel;
    /**
     * @remarks
     * 获取玩家客户端的当前图形模式。可以在设置菜单的视频部分
     * 根据可用的硬件进行更改。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     *
     */
    readonly graphicsMode: GraphicsMode;
    /**
     * @remarks
     * 包含玩家的输入信息。
     *
     */
    readonly inputInfo: InputInfo;
    /**
     * @remarks
     * 玩家的输入权限。
     *
     */
    readonly inputPermissions: PlayerInputPermissions;
    /**
     * @remarks
     * 如果为 true，则玩家当前正在做表情。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     */
    readonly isEmoting: boolean;
    /**
     * @remarks
     * 玩家是否在飞行。例如，在创造或旁观模式中。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     */
    readonly isFlying: boolean;
    /**
     * @remarks
     * 玩家是否正在使用鞘翅滑翔。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     */
    readonly isGliding: boolean;
    /**
     * @remarks
     * 玩家是否在跳跃。当玩家按住跳跃动作时，这将保持为 true。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     */
    readonly isJumping: boolean;
    /**
     * @remarks
     * 玩家当前的总体等级，基于其经验值。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     */
    readonly level: number;
    /**
     * @remarks
     * 玩家的名称。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     */
    readonly name: string;
    /**
     * @remarks
     * 包含操作玩家屏幕显示的方法。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     */
    readonly onScreenDisplay: ScreenDisplay;
    /**
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidEntityError}
     *
     */
    readonly playerPermissionLevel: PlayerPermissionLevel;
    /**
     * @remarks
     * 此属性不能在限制执行模式下编辑。
     *
     */
    selectedSlotIndex: number;
    /**
     * @remarks
     * 玩家达到下一级所需的全部总经验值。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     */
    readonly totalXpNeededForNextLevel: number;
    /**
     * @remarks
     * 玩家在当前等级获得的经验值集合。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     */
    readonly xpEarnedAtCurrentLevel: number;
    /**
     * @remarks
     * 向玩家添加/移除经验值，并返回玩家的当前经验值。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param amount
     * 要添加的经验值数量。注意：这可以是负数。
     * 最小/最大界限为 -2^24 ~ 2^24
     * 范围：[-16777216, 16777216]
     * @returns
     * 返回玩家当前的 经验值。
     * @throws 此函数可能会抛出错误。
     *
     */
    addExperience(amount: number): number;
    /**
     * @remarks
     * 向玩家添加/移除等级，并返回玩家的当前等级。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param amount
     * 要添加到玩家的数量。最小/最大界限为 -2^24 ~ 2^24
     * 范围：[-16777216, 16777216]
     * @returns
     * 返回玩家当前的等级。
     * @throws 此函数可能会抛出错误。
     *
     */
    addLevels(amount: number): number;
    /**
     * @remarks
     * 为此玩家，移除目标实体上所有实体属性的覆盖。
     * 此更改直到下一个刻才会应用，并且不会应用于其他玩家。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param targetEntity
     * 要清除其实体属性覆盖的实体或实体 ID。
     * @throws
     * 如果实体或实体 ID 无效则抛出错误。
     *
     */
    clearPropertyOverridesForEntity(targetEntity: Entity | string): void;
    /**
     * @remarks
     * 返回玩家当前的控制方案。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     *
     */
    getControlScheme(): ControlScheme;
    /**
     * @remarks
     * 检索此玩家的活动游戏模式（如果已指定）。
     *
     * @throws 此函数可能会抛出错误。
     *
     */
    getGameMode(): GameMode;
    /**
     * @remarks
     * 获取特定冷却类别的当前物品冷却时间。
     *
     * @param cooldownCategory
     * 指定要检索当前冷却时间的冷却类别。
     * @throws 此函数可能会抛出错误。
     *
     */
    getItemCooldown(cooldownCategory: string): number;
    /**
     * @remarks
     * 获取玩家的当前重生点。
     *
     * @throws 此函数可能会抛出错误。
     *
     */
    getSpawnPoint(): DimensionLocation | undefined;
    /**
     * @remarks
     * 获取玩家的总经验值。
     *
     * @throws 此函数可能会抛出错误。
     *
     */
    getTotalXp(): number;
    /**
     * @remarks
     * 播放只有此特定玩家能听到的音乐曲目。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param trackId
     * 要播放的音乐曲目的标识符。
     * @param musicOptions
     * 音乐曲目的附加选项。
     * @throws 此函数可能会抛出错误。
     *
     */
    playMusic(trackId: string, musicOptions?: MusicOptions): void;
    /**
     * @remarks
     * 播放只有此特定玩家能听到的声音。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param soundOptions
     * 声音的附加可选选项。
     * @throws 此函数可能会抛出错误。
     * @example playMusicAndSound.ts
     * ```typescript
     * import { world, MusicOptions, WorldSoundOptions, PlayerSoundOptions, DimensionLocation } from "@minecraft/server";
     *
     * function playMusicAndSound(targetLocation: DimensionLocation) {
     *   const players = world.getPlayers();
     *
     *   const musicOptions: MusicOptions = {
     *     fade: 0.5,
     *     loop: true,
     *     volume: 1.0,
     *   };
     *   world.playMusic("music.menu", musicOptions);
     *
     *   const worldSoundOptions: WorldSoundOptions = {
     *     pitch: 0.5,
     *     volume: 4.0,
     *   };
     *   world.playSound("ambient.weather.thunder", targetLocation, worldSoundOptions);
     *
     *   const playerSoundOptions: PlayerSoundOptions = {
     *     pitch: 1.0,
     *     volume: 1.0,
     *   };
     *
     *   players[0].playSound("bucket.fill_water", playerSoundOptions);
     * }
     * ```
     *
     */
    playSound(soundId: string, soundOptions?: PlayerSoundOptions): void;
    /**
     * @remarks
     * 排队一首只有此特定玩家能听到的附加音乐曲目。
     * 如果没有曲目在播放，则会播放一首音乐曲目。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param trackId
     * 要播放的音乐曲目的标识符。
     * @param musicOptions
     * 音乐曲目的附加选项。
     * @throws
     * 如果音量小于 0.0 将抛出错误。
     * 如果淡入时间小于 0.0 将抛出错误。
     *
     */
    queueMusic(trackId: string, musicOptions?: MusicOptions): void;
    /**
     * @remarks
     * 为此玩家，移除实体属性上的覆盖。
     * 此更改直到下一个刻才会应用，并且不会应用于其他玩家。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param targetEntity
     * 要移除其实体属性覆盖的实体。
     * @param identifier
     * 实体属性标识符。

     * @throws
     * 如果实体无效则抛出错误。

     * 如果提供了无效标识符则抛出错误。

     * 如果提供的值类型与

     * 属性类型不兼容则抛出错误。

     *
     */
    removePropertyOverrideForEntity(targetEntity: Entity, identifier: string): void;
    /**
     * @remarks
     * 重置玩家的等级。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     *
     */
    resetLevel(): void;
    /**
     * @remarks
     * 向玩家发送消息。
     *
     * @param message
     * 要显示的消息。
     * @throws
     * 如果提供的 {@link RawMessage} 格式无效，此方法可能抛出错误。
     * 例如，如果向 `score` 提供了空的 `name` 字符串。
     *
     * {@link InvalidEntityError}
     *
     * {@link RawMessageError}
     * @example nestedTranslation.ts
     * ```typescript
     * import { world, DimensionLocation } from "@minecraft/server";
     *
     * function nestedTranslation(targetLocation: DimensionLocation) {
     *   // Displays "Apple or Coal"
     *   const rawMessage = {
     *     translate: "accessibility.list.or.two",
     *     with: { rawtext: [{ translate: "item.apple.name" }, { translate: "item.coal.name" }] },
     *   };
     *   world.sendMessage(rawMessage);
     * }
     * ```
     * @example scoreWildcard.ts
     * ```typescript
     * import { world, DimensionLocation } from "@minecraft/server";
     *
     * function scoreWildcard(targetLocation: DimensionLocation) {
     *   // Displays the player's score for objective "obj". Each player will see their own score.
     *   const rawMessage = { score: { name: "*", objective: "obj" } };
     *   world.sendMessage(rawMessage);
     * }
     * ```
     * @example sendBasicMessage.ts
     * ```typescript
     * import { world, DimensionLocation } from "@minecraft/server";
     *
     * function sendBasicMessage(targetLocation: DimensionLocation) {
     *   const players = world.getPlayers();
     *
     *   players[0].sendMessage("Hello World!");
     * }
     * ```
     * @example sendPlayerMessages.ts
     * ```typescript
     * import { world, DimensionLocation } from "@minecraft/server";
     *
     * function sendPlayerMessages(targetLocation: DimensionLocation) {
     *   for (const player of world.getAllPlayers()) {
     *     // Displays "First or Second"
     *     const rawMessage = { translate: "accessibility.list.or.two", with: ["First", "Second"] };
     *     player.sendMessage(rawMessage);
     *
     *     // Displays "Hello, world!"
     *     player.sendMessage("Hello, world!");
     *
     *     // Displays "Welcome, Amazing Player 1!"
     *     player.sendMessage({ translate: "authentication.welcome", with: ["Amazing Player 1"] });
     *
     *     // Displays the player's score for objective "obj". Each player will see their own score.
     *     const rawMessageWithScore = { score: { name: "*", objective: "obj" } };
     *     player.sendMessage(rawMessageWithScore);
     *
     *     // Displays "Apple or Coal"
     *     const rawMessageWithNestedTranslations = {
     *       translate: "accessibility.list.or.two",
     *       with: { rawtext: [{ translate: "item.apple.name" }, { translate: "item.coal.name" }] },
     *     };
     *     player.sendMessage(rawMessageWithNestedTranslations);
     *   }
     * }
     * ```
     * @example sendTranslatedMessage.ts
     * ```typescript
     * import { world, DimensionLocation } from "@minecraft/server";
     *
     * function sendTranslatedMessage(
     *     targetLocation: DimensionLocation
     * ) {
     *   const players = world.getPlayers();
     *
     *   players[0].sendMessage({ translate: "authentication.welcome", with: ["Amazing Player 1"] });
     * }
     * ```
     *
     */
    sendMessage(message: (RawMessage | string)[] | RawMessage | string): void;
    /**
     * @remarks
     * 设置玩家的控制方案。玩家的活动摄像机预设必须通过脚本（如 camera.setCamera()）或命令设置。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param controlScheme
     * 控制方案类型。如果此参数为 undefined，
     * 此方法将清除玩家的控制方案，恢复为
     * 玩家摄像机的默认控制方案。
     * @returns
     * 如果控制方案添加或更新成功则返回空值。
     * 如果控制方案不被玩家当前摄像机允许，
     * 此方法可能抛出 InvalidArgumentError。
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidEntityError}
     *
     */
    setControlScheme(controlScheme?: ControlScheme): void;
    /**
     * @remarks
     * 为此玩家设置游戏模式覆盖。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param gameMode
     * 活动游戏模式。
     * @throws 此函数可能会抛出错误。
     *
     */
    setGameMode(gameMode?: GameMode): void;
    /**
     * @remarks
     * 为此玩家，覆盖目标实体上的实体属性为提供的值。
     * 此属性必须为客户端同步。此更改直到下一个刻才会应用，
     * 并且不会应用于其他玩家。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param targetEntity
     * 要覆盖其实体属性的实体。
     * @param identifier
     * 实体属性标识符。

     * @param value
     * 覆盖值。提供的类型必须与实体定义中指定的类型兼容。
     * @throws
     * 如果实体无效则抛出错误。

     * 如果提供了无效标识符则抛出错误。

     * 如果提供的值类型与

     * 属性类型不兼容则抛出错误。

     * 如果提供的值超出预期范围

     * （int、float 属性）。

     * 如果提供的字符串值与

     * 接受的枚举值集合（枚举属性）不匹配则抛出错误。

     *
     */
    setPropertyOverrideForEntity(targetEntity: Entity, identifier: string, value: boolean | number | string): void;
    /**
     * @remarks
     * 为此特定玩家设置当前的起始重生点。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link Error}
     *
     * {@link LocationOutOfWorldBoundariesError}
     *
     */
    setSpawnPoint(spawnPoint?: DimensionLocation): void;
    /**
     * @remarks
     * 在世界的指定位置创建一个新的粒子发射器。仅对目标玩家可见。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param effectName
     * 要创建的粒子的标识符。
     * @param location
     * 创建粒子发射器的位置。
     * @param molangVariables
     * 一组可选的、可自定义的变量，可以针对此粒子进行调整。
     * @throws 此函数可能会抛出错误。
     *
     * {@link Error}
     *
     * {@link LocationInUnloadedChunkError}
     *
     * {@link LocationOutOfWorldBoundariesError}
     * @example spawnParticle.ts
     * ```typescript
     * import { world, MolangVariableMap, Vector3 } from '@minecraft/server';
     *
     * world.afterEvents.playerSpawn.subscribe(event => {
     *     const targetLocation = event.player.location;
     *     for (let i = 0; i < 100; i++) {
     *         const molang = new MolangVariableMap();
     *
     *         molang.setColorRGB('variable.color', {
     *             red: Math.random(),
     *             green: Math.random(),
     *             blue: Math.random()
     *         });
     *
     *         const newLocation: Vector3 = {
     *             x: targetLocation.x + Math.floor(Math.random() * 8) - 4,
     *             y: targetLocation.y + Math.floor(Math.random() * 8) - 4,
     *             z: targetLocation.z + Math.floor(Math.random() * 8) - 4,
     *         };
     *         event.player.spawnParticle('minecraft:colored_flame_particle', newLocation, molang);
     *     }
     * });
     * ```
     *
     */
    spawnParticle(effectName: string, location: Vector3, molangVariables?: MolangVariableMap): void;
    /**
     * @remarks
     * 设置特定冷却类别的物品冷却时间。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param cooldownCategory
     * 指定要检索当前冷却时间的冷却类别。
     * @param tickDuration
     * 物品冷却的持续时间（以刻为单位）。
     * 范围：[0, 32767]
     * @throws 此函数可能会抛出错误。
     *
     */
    startItemCooldown(cooldownCategory: string, tickDuration: number): void;
    /**
     * @remarks
     * 停止为此特定玩家播放的任何音乐曲目。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     *
     */
    stopMusic(): void;
}

/**
  * 包含关于玩家交互事件后
 * 破坏方块的信息。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class PlayerBreakBlockAfterEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
      * 返回此方块在破坏前
      * 的置换信息。
      *
     */
    readonly brokenBlockPermutation: BlockPermutation;
    /**
     * @remarks
     * 用于破坏方块后所使用的物品堆栈，如果空手则为 undefined。
     *
     */
    readonly itemStackAfterBreak?: ItemStack;
    /**
     * @remarks
     * 用于破坏方块前所使用的物品堆栈，如果空手则为 undefined。
     *
     */
    readonly itemStackBeforeBreak?: ItemStack;
    /**
     * @remarks
     * 此事件中破坏方块的玩家。
     *
     */
    readonly player: Player;
}

/**
 * 管理与玩家破坏方块时相关的回调。
 *
 */
export class PlayerBreakBlockAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，当方块被破坏时将调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: PlayerBreakBlockAfterEvent) => void,
        options?: BlockEventOptions,
    ): (arg0: PlayerBreakBlockAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，当玩家破坏方块时不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerBreakBlockAfterEvent) => void): void;
}

/**
  * 包含关于玩家在破坏方块前的事件
 * 的信息。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class PlayerBreakBlockBeforeEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
     * 如果设置为 true，则取消方块破坏事件。
     *
     */
    cancel: boolean;
    /**
     * @remarks
     * 正在用于破坏方块的物品堆栈，如果空手则为 undefined。
     *
     */
    itemStack?: ItemStack;
    /**
     * @remarks
     * 此事件中破坏方块的玩家。
     *
     */
    readonly player: Player;
}

/**
 * 管理玩家破坏方块前触发的回调。
 *
 */
export class PlayerBreakBlockBeforeEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在方块被破坏前将被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     * @returns
     * 在受限执行权限下调用的闭包。
     *
     */
    subscribe(
        callback: (arg0: PlayerBreakBlockBeforeEvent) => void,
        options?: BlockEventOptions,
    ): (arg0: PlayerBreakBlockBeforeEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在玩家破坏方块前不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerBreakBlockBeforeEvent) => void): void;
}

/**
 * 玩家按下按钮时的事件数据。
 *
 */
export class PlayerButtonInputAfterEvent {
    private constructor();
    /**
     * @remarks
     * 此事件涉及的按钮。
     *
     */
    readonly button: InputButton;
    /**
     * @remarks
     * 此按钮转移到的状态。
     *
     */
    readonly newButtonState: ButtonState;
    /**
     * @remarks
     * 执行输入事件的玩家。
     *
     */
    readonly player: Player;
}

/**
 * 管理与玩家输入相关的回调。
 *
 */
export class PlayerButtonInputAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在玩家执行输入后将被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: PlayerButtonInputAfterEvent) => void,
        options?: InputEventOptions,
    ): (arg0: PlayerButtonInputAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在玩家执行输入后不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerButtonInputAfterEvent) => void): void;
}

/**
 * 表示玩家的光标物品栏。用于在物品栏 UI 中
 * 的容器之间移动物品。不适用于触控控制。
 *
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class PlayerCursorInventoryComponent extends EntityComponent {
    private constructor();
    /**
     * @remarks
     * 当前在玩家光标物品栏中的物品堆栈。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     */
    readonly item?: ItemStack;
    static readonly componentId = 'minecraft:cursor_inventory';
    /**
     * @remarks
     * 清空玩家的光标物品栏。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     *
     */
    clear(): void;
}

/**
 * 包含与玩家维度变更相关的信息。
 *
 */
export class PlayerDimensionChangeAfterEvent {
    private constructor();
    /**
     * @remarks
     * 玩家正在离开的维度。
     *
     */
    readonly fromDimension: Dimension;
    /**
     * @remarks
     * 玩家在变更维度前所在的位置。
     *
     */
    readonly fromLocation: Vector3;
    /**
     * @remarks
     * 正在变更维度的玩家句柄。
     *
     */
    readonly player: Player;
    /**
     * @remarks
     * 玩家正在前往的维度。
     *
     */
    readonly toDimension: Dimension;
    /**
     * @remarks
     * 玩家变更维度后将生成的位置。
     *
     */
    readonly toLocation: Vector3;
}

/**
 * 管理与玩家维度变更成功相关的回调。
 *
 */
export class PlayerDimensionChangeAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 将指定的回调订阅到玩家维度变更后事件。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: PlayerDimensionChangeAfterEvent) => void,
    ): (arg0: PlayerDimensionChangeAfterEvent) => void;
    /**
     * @remarks
     * 从玩家维度变更后事件中移除指定的回调。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerDimensionChangeAfterEvent) => void): void;
}

export class PlayerEmoteAfterEvent {
    private constructor();
    readonly personaPieceId: string;
    readonly player: Player;
}

export class PlayerEmoteAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: PlayerEmoteAfterEvent) => void): (arg0: PlayerEmoteAfterEvent) => void;
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerEmoteAfterEvent) => void): void;
}

/**
 * 包含玩家游戏模式改变后的事件信息。
 *
 */
export class PlayerGameModeChangeAfterEvent {
    private constructor();
    /**
     * @remarks
     * 改变前的游戏模式。
     *
     */
    readonly fromGameMode: GameMode;
    /**
     * @remarks
     * 此事件的源玩家。
     *
     */
    readonly player: Player;
    /**
     * @remarks
     * 改变后的当前游戏模式。
     *
     */
    readonly toGameMode: GameMode;
}

/**
 * 管理玩家游戏模式改变后触发的回调。
 *
 */
export class PlayerGameModeChangeAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在玩家游戏模式改变后将被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: PlayerGameModeChangeAfterEvent) => void): (arg0: PlayerGameModeChangeAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在玩家游戏模式改变后不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerGameModeChangeAfterEvent) => void): void;
}

/**
  * 包含关于玩家放置方块前的事件
  * 与实体交互的信息。
  *
 */
export class PlayerGameModeChangeBeforeEvent {
    private constructor();
    /**
     * @remarks
     * 如果设置为 true，游戏模式更改将被取消。
     *
     */
    cancel: boolean;
    /**
     * @remarks
     * 当前的游戏模式。
     *
     */
    readonly fromGameMode: GameMode;
    /**
     * @remarks
     * 此事件的源玩家。
     *
     */
    readonly player: Player;
    /**
     * @remarks
     * 要更改到的游戏模式。
     *
     */
    toGameMode: GameMode;
}

/**
 * 管理玩家游戏模式改变前触发的回调。
 *
 */
export class PlayerGameModeChangeBeforeEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在玩家游戏模式改变前将被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     * @returns
     * 在受限执行权限下调用的闭包。
     *
     */
    subscribe(
        callback: (arg0: PlayerGameModeChangeBeforeEvent) => void,
    ): (arg0: PlayerGameModeChangeBeforeEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在玩家游戏模式改变前不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerGameModeChangeBeforeEvent) => void): void;
}

/**
  * 包含关于更改
 * 玩家选定快捷栏槽位的信息。
 *
 */
export class PlayerHotbarSelectedSlotChangeAfterEvent {
    private constructor();
    /**
     * @remarks
     * 新选定槽位的物品堆栈。
     *
     */
    readonly itemStack?: ItemStack;
    /**
     * @remarks
     * 选定的新快捷栏槽位索引。
     *
     */
    readonly newSlotSelected: number;
    /**
     * @remarks
     * 此事件的源玩家。
     *
     */
    readonly player: Player;
    /**
     * @remarks
     * 先前选定的快捷栏槽位索引。
     *
     */
    readonly previousSlotSelected: number;
}

/**
 * 管理玩家选定快捷栏槽位更改后触发的回调。
 *
 */
export class PlayerHotbarSelectedSlotChangeAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在玩家选定快捷栏槽位更改后将被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此事件触发时调用的函数回调。
     * @param options
     * 事件订阅的附加过滤选项。
     *
     */
    subscribe(
        callback: (arg0: PlayerHotbarSelectedSlotChangeAfterEvent) => void,
        options?: HotbarEventOptions,
    ): (arg0: PlayerHotbarSelectedSlotChangeAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在玩家选定快捷栏槽位更改后不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerHotbarSelectedSlotChangeAfterEvent) => void): void;
}

/**
 * 玩家输入模式改变时的事件数据。
 *
 */
export class PlayerInputModeChangeAfterEvent {
    private constructor();
    /**
     * @remarks
     * 玩家使用的新输入模式。
     *
     */
    readonly newInputModeUsed: InputMode;
    /**
     * @remarks
     * 输入模式发生改变的玩家。
     *
     */
    readonly player: Player;
    /**
     * @remarks
     * 玩家先前使用的输入模式。
     *
     */

    readonly previousInputModeUsed: InputMode;
}

/**
 * 管理与玩家输入模式相关的回调。
 */
export class PlayerInputModeChangeAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在玩家输入模式改变后调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: PlayerInputModeChangeAfterEvent) => void,
    ): (arg0: PlayerInputModeChangeAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在玩家输入模式改变后不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerInputModeChangeAfterEvent) => void): void;
}

/**
  * 包含关于玩家输入权限改变后事件的信息。
  * 输入权限改变。
 */
export class PlayerInputPermissionCategoryChangeAfterEvent {
    private constructor();
    /**
     * @remarks
     * 已更改的输入权限类别。
     *
     */
    readonly category: InputPermissionCategory;
    /**
     * @remarks
     * 玩家输入权限的启用/禁用状态。
     *
     */
    readonly enabled: boolean;
    /**
     * @remarks
     * 其输入权限已被更改的玩家。
     *
     */
    readonly player: Player;
}

/**
  * 管理与玩家输入权限改变后相关的回调。
  * 输入权限改变。
 */
export class PlayerInputPermissionCategoryChangeAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在玩家输入权限改变后调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: PlayerInputPermissionCategoryChangeAfterEvent) => void,
    ): (arg0: PlayerInputPermissionCategoryChangeAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在玩家输入权限改变后不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerInputPermissionCategoryChangeAfterEvent) => void): void;
}

/**
 * 包含启用/禁用玩家输入权限的API。
 */
export class PlayerInputPermissions {
    private constructor();
    /**
     * @remarks
     * 返回 true if an input permission is enabled.

     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    isPermissionCategoryEnabled(permissionCategory: InputPermissionCategory): boolean;
    /**
     * @remarks
     * 启用或禁用输入权限。启用时输入将正常工作，禁用时将不工作。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    setPermissionCategory(permissionCategory: InputPermissionCategory, isEnabled: boolean): void;
}

/**
  * 包含关于玩家交互事件后
 * 成功与方块交互的信息。
 */
export class PlayerInteractWithBlockAfterEvent {
    private constructor();
    /**
     * @remarks
     * 交互成功前的物品堆栈，如果手为空则为 undefined。
     *
     */
    readonly beforeItemStack?: ItemStack;
    /**
     * @remarks
     * 将要与之交互的方块。
     *
     */
    readonly block: Block;
    /**
     * @remarks
     * 正在被交互的方块面。
     *
     */
    readonly blockFace: Direction;
    /**
     * @remarks
      * 相对于方块底部西北角的交互位置
     * 物品放置位置所在方块。
     *
     */
    readonly faceLocation: Vector3;
    /**
     * @remarks
     * 如果事件是在玩家首次按下交互按钮时触发，则为 true；如果是在按住交互按钮时触发的事件，则为 false。
     *
     */
    readonly isFirstEvent: boolean;
    /**
     * @remarks
     * 交互成功后的物品堆栈，如果手为空则为 undefined。
     *
     */
    readonly itemStack?: ItemStack;
    /**
     * @remarks
     * 此事件的源玩家。
     *
     */
    readonly player: Player;
}

/**
  * 管理与玩家与方块交互后相关的回调。
  * 与方块交互的信息。
 */
export class PlayerInteractWithBlockAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在玩家与方块交互后调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: PlayerInteractWithBlockAfterEvent) => void,
    ): (arg0: PlayerInteractWithBlockAfterEvent) => void;
    /**
     * @remarks
      * 移除一个回调，在玩家与方块交互后不再调用。
      * 与方块交互的信息。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerInteractWithBlockAfterEvent) => void): void;
}

/**
  * 包含关于玩家放置方块前的事件
  * 与方块交互的信息。
 */
export class PlayerInteractWithBlockBeforeEvent {
    private constructor();
    /**
     * @remarks
     * 将要与之交互的方块。
     *
     */
    readonly block: Block;
    /**
     * @remarks
     * 正在被交互的方块面。
     *
     */
    readonly blockFace: Direction;
    /**
     * @remarks
     * 如果设置为 true，交互将被取消。
     *
     */
    cancel: boolean;
    /**
     * @remarks
      * 相对于方块底部西北角的交互位置
     * 物品放置位置所在方块。
     *
     */
    readonly faceLocation: Vector3;
    /**
     * @remarks
     * 如果事件是在玩家首次按下交互按钮时触发，则为 true；如果是在按住交互按钮时触发的事件，则为 false。
     *
     */
    readonly isFirstEvent: boolean;
    /**
     * @remarks
     * 交互中正在使用的物品堆栈，如果手为空则为 undefined。
     *
     */
    readonly itemStack?: ItemStack;
    /**
     * @remarks
     * 此事件的源玩家。
     *
     */
    readonly player: Player;
}

/**
  * 管理与玩家与方块交互前相关的回调。
  * 与方块交互的信息。
 */
export class PlayerInteractWithBlockBeforeEventSignal {
    private constructor();
    /**
     * @remarks
      * 添加一个回调，在玩家与方块交互前调用。
      * 与方块交互的信息。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     * @returns
     * 在受限执行权限下调用的闭包。
     */
    subscribe(
        callback: (arg0: PlayerInteractWithBlockBeforeEvent) => void,
    ): (arg0: PlayerInteractWithBlockBeforeEvent) => void;
    /**
     * @remarks
      * 移除一个回调，在玩家与方块交互前不再调用。
      * 与方块交互的信息。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     */
    unsubscribe(callback: (arg0: PlayerInteractWithBlockBeforeEvent) => void): void;
}

/**
  * 包含关于玩家交互事件后
 * 成功与实体交互的信息。
 */
export class PlayerInteractWithEntityAfterEvent {
    private constructor();
    /**
     * @remarks
     * 交互成功前的物品堆栈，如果手为空则为 undefined。
     *
     */
    readonly beforeItemStack?: ItemStack;
    /**
     * @remarks
     * 交互成功后的物品堆栈，如果手为空则为 undefined。
     *
     */
    readonly itemStack?: ItemStack;
    /**
     * @remarks
     * 此事件的源玩家。
     *
     */
    readonly player: Player;
    /**
     * @remarks
     * 将要与之交互的实体。
     *
     */
    readonly target: Entity;
}

/**
  * 管理与玩家与方块交互后相关的回调。
  * 与实体交互的信息。
 */
export class PlayerInteractWithEntityAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在玩家与实体交互后调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: PlayerInteractWithEntityAfterEvent) => void,
    ): (arg0: PlayerInteractWithEntityAfterEvent) => void;
    /**
     * @remarks
      * 移除一个回调，在玩家与方块交互后不再调用。
      * 与实体交互的信息。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerInteractWithEntityAfterEvent) => void): void;
}

/**
  * 包含关于玩家放置方块前的事件
  * 与实体交互的信息。
 */
export class PlayerInteractWithEntityBeforeEvent {
    private constructor();
    /**
     * @remarks
     * 如果设置为 true，交互将被取消。
     *
     */
    cancel: boolean;
    /**
     * @remarks
     * 交互中正在使用的物品堆栈，如果手为空则为 undefined。
     *
     */
    readonly itemStack?: ItemStack;
    /**
     * @remarks
     * 此事件的源玩家。
     *
     */
    readonly player: Player;
    /**
     * @remarks
     * 将要与之交互的实体。
     *
     */
    readonly target: Entity;
}

/**
  * 管理与玩家与方块交互前相关的回调。
  * 与实体交互的信息。
 */
export class PlayerInteractWithEntityBeforeEventSignal {
    private constructor();
    /**
     * @remarks
      * 添加一个回调，在玩家与方块交互前调用。
      * 与实体交互的信息。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     * @returns
     * 在受限执行权限下调用的闭包。
     */
    subscribe(
        callback: (arg0: PlayerInteractWithEntityBeforeEvent) => void,
    ): (arg0: PlayerInteractWithEntityBeforeEvent) => void;
    /**
     * @remarks
      * 移除一个回调，在玩家与方块交互前不再调用。
      * 与实体交互的信息。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     */
    unsubscribe(callback: (arg0: PlayerInteractWithEntityBeforeEvent) => void): void;
}

/**
  * 包含关于玩家物品栏物品改变后事件的信息。
  * 物品栏物品改变。
 */
export class PlayerInventoryItemChangeAfterEvent {
    private constructor();
    /**
     * @remarks
     * 先前的物品堆栈。
     *
     */
    readonly beforeItemStack?: ItemStack;
    /**
     * @remarks
     * 物品栏类型。
     *
     */
    readonly inventoryType: PlayerInventoryType;
    /**
     * @remarks
     * 新的物品堆栈。
     *
     */
    readonly itemStack?: ItemStack;
    /**
     * @remarks
     * 此事件的源玩家。
     *
     */
    readonly player: Player;
    /**
     * @remarks
     * 发生变化的槽位索引。
     *
     */
    readonly slot: number;
}

/**
  * 管理与玩家物品栏物品被改变后相关的回调。
  * 物品栏物品被改变。
 */
export class PlayerInventoryItemChangeAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在玩家物品栏物品被改变后调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此事件触发时调用的函数回调。
     * @param options
     * 事件订阅的附加过滤选项。
     */
    subscribe(
        callback: (arg0: PlayerInventoryItemChangeAfterEvent) => void,
        options?: InventoryItemEventOptions,
    ): (arg0: PlayerInventoryItemChangeAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在玩家物品栏物品被改变后不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerInventoryItemChangeAfterEvent) => void): void;
}

/**
  * 包含关于已加入玩家的信息。
  * 有关玩家首次在游戏中生成后可能返回的更详细信息，请参阅 playerSpawn 事件。
  * 有关玩家首次生成后可能返回的更详细信息。
  * 在游戏中。
 */
export class PlayerJoinAfterEvent {
    private constructor();
    /**
     * @remarks
     * 加入游戏的玩家的不透明字符串标识符。
     *
     */
    readonly playerId: string;
    /**
     * @remarks
     * 已加入玩家的名称。
     *
     */
    readonly playerName: string;
}

/**
  * 管理连接到玩家加入世界的回调。
  * 类型。
 */
export class PlayerJoinAfterEventSignal {
    private constructor();
    /**
     * @remarks
      * 添加一个回调，在玩家加入世界时调用。
      * 类型。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: PlayerJoinAfterEvent) => void): (arg0: PlayerJoinAfterEvent) => void;
    /**
     * @remarks
      * 移除一个回调，在玩家加入世界时不再调用。
      * 类型。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerJoinAfterEvent) => void): void;
}

/**
  * 包含关于已离开世界的玩家的信息。
  * 类型。
 */
export class PlayerLeaveAfterEvent {
    private constructor();
    /**
     * @remarks
      * 已离开世界玩家的不透明字符串标识符。
      * 事件。
     *
     */
    readonly playerId: string;
    /**
     * @remarks
     * 已离开世界的玩家。
     *
     */
    readonly playerName: string;
}

/**
  * 管理连接到玩家离开世界的回调。
  * 类型。
 */
export class PlayerLeaveAfterEventSignal {
    private constructor();
    /**
     * @remarks
      * 添加一个回调，在玩家离开世界时调用。
      * 类型。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: PlayerLeaveAfterEvent) => void): (arg0: PlayerLeaveAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在玩家离开世界时不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerLeaveAfterEvent) => void): void;
}

/**
  * 包含关于即将离开世界的玩家的信息。
  * 类型。
 */
export class PlayerLeaveBeforeEvent {
    private constructor();
    /**
     * @remarks
     * 正在离开的玩家。
     *
     */
    readonly player: Player;
}

/**
  * 管理连接到玩家离开世界的回调。
  * 类型。
 */
export class PlayerLeaveBeforeEventSignal {
    private constructor();
    /**
     * @remarks
      * 添加一个回调，在玩家离开世界时调用。
      * 类型。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     * @returns
     * 在受限执行权限下调用的闭包。
     */
    subscribe(callback: (arg0: PlayerLeaveBeforeEvent) => void): (arg0: PlayerLeaveBeforeEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在玩家离开世界时不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     */
    unsubscribe(callback: (arg0: PlayerLeaveBeforeEvent) => void): void;
}

/**
  * 包含关于玩家放置方块事件的信息。
  * 的信息。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class PlayerPlaceBlockAfterEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
     * 此事件中放置方块的玩家。
     *
     */
    readonly player: Player;
}

/**
  * 管理连接到玩家放置方块时的回调。
  * 由玩家放置。
 */
export class PlayerPlaceBlockAfterEventSignal {
    private constructor();
    /**
     * @remarks
      * 添加一个回调，在玩家放置方块时调用。
      * 破坏的信息。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: PlayerPlaceBlockAfterEvent) => void,
        options?: BlockEventOptions,
    ): (arg0: PlayerPlaceBlockAfterEvent) => void;
    /**
     * @remarks
      * 移除一个回调，在玩家放置方块时不再调用。
      * 破坏的信息。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerPlaceBlockAfterEvent) => void): void;
}

/**
  * 包含有关玩家生成的更多信息的事件。
  * 生成。
 */
export class PlayerSpawnAfterEvent {
    private constructor();
    /**
     * @remarks
     * 如果为 true，表示玩家加入游戏后的首次生成。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    initialSpawn: boolean;
    /**
     * @remarks
     * 表示加入游戏的玩家的对象。
     *
     * 此属性不能在限制执行模式下编辑。
     *
     */
    player: Player;
}

/**
  * 注册一个事件，当玩家（死亡后重新）生成并在世界中完全准备就绪时触发。
  * 死亡后重新生成并在世界中完全准备就绪时触发。
 */
export class PlayerSpawnAfterEventSignal {
    private constructor();
    /**
     * @remarks
      * 为此特定类型的事件注册新的事件接收器。
      * 事件。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: PlayerSpawnAfterEvent) => void): (arg0: PlayerSpawnAfterEvent) => void;
    /**
     * @remarks
     * 取消注册玩家生成事件的事件接收器。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerSpawnAfterEvent) => void): void;
}

/**
  * 包含关于玩家开始挥动的信息
 * 手臂的信息。
 */
export class PlayerSwingStartAfterEvent {
    private constructor();
    /**
     * @remarks
     * 玩家开始挥动时手持的物品堆栈。
     *
     */
    readonly heldItemStack?: ItemStack;
    /**
     * @remarks
     * 此事件的源玩家。
     *
     */
    readonly player: Player;
    /**
     * @remarks
     * 玩家挥动的来源，请参阅 {@link EntitySwingSource}。
     *
     */
    readonly swingSource: EntitySwingSource;
}

/**
  * 管理连接到玩家开始挥动手臂时的回调（例如攻击、使用物品、交互）。
  * 开始挥动手臂（例如攻击、使用物品、交互）。
  * 交互）。
 */
export class PlayerSwingStartAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在玩家开始挥动手臂时调用（例如攻击、使用物品、交互）。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: PlayerSwingStartAfterEvent) => void,
        options?: PlayerSwingEventOptions,
    ): (arg0: PlayerSwingStartAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在玩家开始挥动手臂时不再调用（例如攻击、使用物品、交互）。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PlayerSwingStartAfterEvent) => void): void;
}

/**
 * 表示药水效果的传递方式。
 */
export class PotionDeliveryType {
    private constructor();
    readonly id: string;
}

/**
  * 表示一种药水效果类型 - 如治疗或跳跃。
  * 跳跃。
 */
export class PotionEffectType {
    private constructor();
    /**
     * @remarks
     * 效果应用于实体时的持续时间（以刻为单位）。Undefined 表示效果不会过期。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link minecraftcommon.EngineError}
     */
    readonly durationTicks?: number;
    readonly id: string;
}

/**
  * 用于访问所有药水效果类型、传递类型以及创建药水。
  * 以及创建药水。
 */
export class Potions {
    private constructor();
    /**
     * @remarks
     * 获取所有已注册的药水传递类型的句柄。
     *
     * @returns
     * 所有已注册传递类型句柄的数组。
     */
    static getAllDeliveryTypes(): PotionDeliveryType[];
    /**
     * @remarks
     * 获取所有已注册的药水效果的类型句柄。
     *
     * @returns
     * 所有已注册效果类型句柄的数组。
     */
    static getAllEffectTypes(): PotionEffectType[];
    /**
     * @remarks
     * 获取指定药水传递 ID 的类型句柄。
     *
     * @returns
     * 包装有效传递 ID 的类型句柄，对于无效传递 ID 则为 undefined。
     */
    static getDeliveryType(potionDeliveryId: string): PotionDeliveryType | undefined;
    /**
     * @remarks
     * 获取指定药水效果 ID 的类型句柄。
     *
     * @param potionEffectId
     * 一个有效的药水效果 ID。请参阅
     * @minecraft/vanilla-data.MinecraftPotionEffectTypes
     * @returns
     * 包装有效效果 ID 的类型句柄，对于无效效果 ID 则为 undefined。
     */
    static getEffectType(potionEffectId: string): PotionEffectType | undefined;
    /**
     * @remarks
     * 根据给定的效果和传递类型创建药水。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link InvalidPotionDeliveryTypeError}
     *
     * {@link InvalidPotionEffectTypeError}
     */
    static resolve(
        potionEffectType: PotionEffectType | string,
        potionDeliveryType: PotionDeliveryType | string,
    ): ItemStack;
}

/**
  * 包含与压力板变化相关的信息。
  * 弹起。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class PressurePlatePopAfterEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
     * 压力板弹起前的红石能量。
     *
     */
    readonly previousRedstonePower: number;
    /**
     * @remarks
     * 压力板弹起时的红石能量。
     *
     */
    readonly redstonePower: number;
}

/**
  * 管理连接到压力板时的回调。
  * 弹起时。
 */
export class PressurePlatePopAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在压力板弹起时调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: PressurePlatePopAfterEvent) => void): (arg0: PressurePlatePopAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在压力板弹起时不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PressurePlatePopAfterEvent) => void): void;
}

/**
  * 包含与压力板变化相关的信息。
  * 按下。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class PressurePlatePushAfterEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
     * 压力板按下前的红石能量。
     *
     */
    readonly previousRedstonePower: number;
    /**
     * @remarks
     * 压力板按下时的红石能量。
     *
     */
    readonly redstonePower: number;
    /**
     * @remarks
     * 触发压力板按下的源实体。
     *
     */
    readonly source: Entity;
}

/**
  * 管理连接到压力板时的回调。
  * 按下时。
 */
export class PressurePlatePushAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在压力板按下时调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: PressurePlatePushAfterEvent) => void): (arg0: PressurePlatePushAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在压力板按下时不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: PressurePlatePushAfterEvent) => void): void;
}

/**
  * 包含与射弹击中的相关信息。
  * 。
 */
export class ProjectileHitBlockAfterEvent {
    private constructor();
    /**
     * @remarks
     * 此射弹击中发生的维度。
     *
     */
    readonly dimension: Dimension;
    /**
     * @remarks
     * 射弹击中方块时的方向向量。
     *
     */
    readonly hitVector: Vector3;
    /**
     * @remarks
     * 射弹击中发生的位置。
     *
     */
    readonly location: Vector3;
    /**
     * @remarks
     * 击中方块的射弹实体。
     *
     */
    readonly projectile: Entity;
    /**
     * @remarks
     * 发射射弹的可选源实体。
     *
     */
    readonly source?: Entity;
    /**
     * @remarks
     * 包含关于被射弹击中的方块的附加信息。
     *
     * 此函数不能在限制执行模式下调用。
     *
     */
    getBlockHit(): BlockHitInformation;
}

/**
  * 管理连接到射弹时的回调。
  * 击中方块时。
 */
export class ProjectileHitBlockAfterEventSignal {
    private constructor();
    /**
     * @remarks
      * 添加一个回调，在射弹时调用。
      * 。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: ProjectileHitBlockAfterEvent) => void): (arg0: ProjectileHitBlockAfterEvent) => void;
    /**
     * @remarks
      * 移除一个回调，在射弹时不再调用。
      * 一个方块。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: ProjectileHitBlockAfterEvent) => void): void;
}

/**
  * 包含与射弹击中的相关信息。
  * 实体。
 */
export class ProjectileHitEntityAfterEvent {
    private constructor();
    /**
     * @remarks
     * 此射弹击中发生的维度。
     *
     */
    readonly dimension: Dimension;
    /**
     * @remarks
     * 射弹击中实体时的方向向量。
     *
     */
    readonly hitVector: Vector3;
    /**
     * @remarks
     * 射弹击中发生的位置。
     *
     */
    readonly location: Vector3;
    /**
     * @remarks
     * 击中实体的射弹实体。
     *
     */
    readonly projectile: Entity;
    /**
     * @remarks
     * 发射射弹的可选源实体。
     *
     */
    readonly source?: Entity;
    /**
     * @remarks
      * 包含关于被射弹击中的实体的附加信息。
      * 击中时。
     *
     * 此函数不能在限制执行模式下调用。
     *
     */
    getEntityHit(): EntityHitInformation;
}

/**
  * 管理连接到射弹时的回调。
  * 击中实体。
 */
export class ProjectileHitEntityAfterEventSignal {
    private constructor();
    /**
     * @remarks
      * 添加一个回调，在射弹时调用。
      * 一个实体。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: ProjectileHitEntityAfterEvent) => void): (arg0: ProjectileHitEntityAfterEvent) => void;
    /**
     * @remarks
      * 移除一个回调，在射弹时不再调用。
      * 一个实体。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: ProjectileHitEntityAfterEvent) => void): void;
}

/**
  * 战利品物品函数，随机修改的数据值。
  * 掉落物品。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class RandomAuxValueFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 函数从中随机选择要分配的数据值的值范围。包含最小值和最大值。
     *
     */
    readonly values: minecraftcommon.NumberRange;
}

/**
  * 战利品物品函数，随机修改的方块状态。
  * 掉落物品。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class RandomBlockStateFunction extends LootItemFunction {
    private constructor();
    readonly blockState: string;
    /**
     * @remarks
     * 函数从中随机选择要分配给给定方块状态的值的范围。包含最小值和最大值。
     *
     */
    readonly values: minecraftcommon.NumberRange;
}

/**
  * 战利品物品条件，将给定值应用于。
  * 战利品掉落几率。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class RandomChanceCondition extends LootItemCondition {
    private constructor();
    /**
     * @remarks
     * 战利品掉落的几率，范围为 0.0 到 1.0。
     *
     */
    readonly chance: number;
}

/**
  * 战利品物品条件，将给定值应用于。
  * 战利品掉落几率，受等级影响。
  * 所使用的工具的抢夺附魔。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class RandomChanceWithLootingCondition extends LootItemCondition {
    private constructor();
    /**
     * @remarks
     * 战利品掉落的基础几率，范围为 0.0 到 1.0。将根据 'lootingMultiplier' 值进行修改。
     *
     */
    readonly chance: number;
    /**
     * @remarks
     * 每级抢夺附魔增加的掉落几率。
     *
     */
    readonly lootingMultiplier: number;
}

/**
  * 战利品物品条件，将给定值应用于。
  * 根据当前难度级别的战利品掉落几率。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class RandomDifficultyChanceCondition extends LootItemCondition {
    private constructor();
    /**
     * @remarks
     * 一个包含四个元素的数组，依次包含每个难度级别（和平、简单、普通、困难）的战利品掉落几率。
     *
     */
    readonly chances: number[];
}

/**
  * 战利品物品函数，对应用随机染料。
  * 掉落物品。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class RandomDyeFunction extends LootItemFunction {
    private constructor();
}

/**
  * 战利品物品条件，将给定值应用于。
  * 战利品掉落几率，受区域影响。
  * 掉落发生的区域。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class RandomRegionalDifficultyChanceCondition extends LootItemCondition {
    private constructor();
    /**
     * @remarks
     * 战利品掉落的基础几率，范围为 0.0 到 1.0。将根据当前区域倍率进行修改。
     *
     */
    readonly maxChance: number;
}

/**
  * 包含记分板的目标和参与者。
 * @example updateScoreboard.ts
 * ```typescript
 * import { world, DisplaySlotId, ObjectiveSortOrder, DimensionLocation } from "@minecraft/server";
 *
 * function updateScoreboard(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const scoreboardObjectiveId = "scoreboard_demo_objective";
 *   const scoreboardObjectiveDisplayName = "Demo Objective";
 *
 *   const players = world.getPlayers();
 *
 *   // Ensure a new objective.
 *   let objective = world.scoreboard.getObjective(scoreboardObjectiveId);
 *
 *   if (!objective) {
 *     objective = world.scoreboard.addObjective(scoreboardObjectiveId, scoreboardObjectiveDisplayName);
 *   }
 *
 *   // get the scoreboard identity for player 0
 *   const player0Identity = players[0].scoreboardIdentity;
 *
 *   if (player0Identity === undefined) {
 *     log("Could not get a scoreboard identity for player 0.");
 *     return -1;
 *   }
 *
 *   // initialize player score to 100;
 *   objective.setScore(player0Identity, 100);
 *
 *   world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, {
 *     objective: objective,
 *     sortOrder: ObjectiveSortOrder.Descending,
 *   });
 *
 *   const playerScore = objective.getScore(player0Identity) ?? 0;
 *
 *   // score should now be 110.
 *   objective.setScore(player0Identity, playerScore + 10);
 * }
 * ```
 */
export class Scoreboard {
    private constructor();
    /**
     * @remarks
     * 向记分板添加新的目标。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     * @example updateScoreboard.ts
     * ```typescript
     * import { world, DisplaySlotId, ObjectiveSortOrder, DimensionLocation } from "@minecraft/server";
     *
     * function updateScoreboard(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
     *   const scoreboardObjectiveId = "scoreboard_demo_objective";
     *   const scoreboardObjectiveDisplayName = "Demo Objective";
     *
     *   const players = world.getPlayers();
     *
     *   // Ensure a new objective.
     *   let objective = world.scoreboard.getObjective(scoreboardObjectiveId);
     *
     *   if (!objective) {
     *     objective = world.scoreboard.addObjective(scoreboardObjectiveId, scoreboardObjectiveDisplayName);
     *   }
     *
     *   // get the scoreboard identity for player 0
     *   const player0Identity = players[0].scoreboardIdentity;
     *
     *   if (player0Identity === undefined) {
     *     log("Could not get a scoreboard identity for player 0.");
     *     return -1;
     *   }
     *
     *   // initialize player score to 100;
     *   objective.setScore(player0Identity, 100);
     *
     *   world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, {
     *     objective: objective,
     *     sortOrder: ObjectiveSortOrder.Descending,
     *   });
     *
     *   const playerScore = objective.getScore(player0Identity) ?? 0;
     *
     *   // score should now be 110.
     *   objective.setScore(player0Identity, playerScore + 10);
     * }
     * ```
     */
    addObjective(objectiveId: string, displayName?: string): ScoreboardObjective;
    /**
     * @remarks
     * 清除占据显示槽位的目标。
     *
     * 此函数不能在限制执行模式下调用。
     *
     */
    clearObjectiveAtDisplaySlot(displaySlotId: DisplaySlotId): ScoreboardObjective | undefined;
    /**
     * @remarks
     * 返回指定目标（按 ID）。
     *
     * @param objectiveId
     * 目标的标识符。
     */
    getObjective(objectiveId: string): ScoreboardObjective | undefined;
    /**
     * @remarks
     * 返回占据指定显示槽位的目标。
     *
     */
    getObjectiveAtDisplaySlot(displaySlotId: DisplaySlotId): ScoreboardObjectiveDisplayOptions | undefined;
    /**
     * @remarks
     * 返回所有已定义的目标。
     *
     */
    getObjectives(): ScoreboardObjective[];
    /**
     * @remarks
     * 返回所有已定义的记分板标识。
     *
     */
    getParticipants(): ScoreboardIdentity[];
    /**
     * @remarks
     * 从记分板移除一个目标。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     */
    removeObjective(objectiveId: ScoreboardObjective | string): boolean;
    /**
     * @remarks
     * 将目标放入显示槽位，并指定额外的显示设置。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @returns
     * 返回先前设置在该显示槽位的 `ScoreboardObjective`，如果之前没有设置目标，则返回
      * 返回 `undefined`。
     * @throws 此函数可能会抛出错误。
     */
    setObjectiveAtDisplaySlot(
        displaySlotId: DisplaySlotId,
        objectiveDisplaySetting: ScoreboardObjectiveDisplayOptions,
    ): ScoreboardObjective | undefined;
}

/**
 * 包含记分板项目的标识。
 */
export class ScoreboardIdentity {
    private constructor();
    /**
     * @remarks
     * 返回此标识的玩家可见名称。
     *
     */
    readonly displayName: string;
    /**
     * @remarks
     * 记分板标识的标识符。
     *
     */
    readonly id: number;
    /**
     * @remarks
     * 返回 true if the ScoreboardIdentity reference is still

     * valid.
     *
     */
    readonly isValid: boolean;
    /**
     * @remarks
     * 记分板标识的类型。
     *
     */
    readonly 'type': ScoreboardIdentityType;
    /**
     * @remarks
     * 如果记分板标识是实体或玩家，则返回此记分板项目对应的实体。
     *
     * @throws 此函数可能会抛出错误。
     */
    getEntity(): Entity | undefined;
}

/**
  * 包含记分板的目标和参与者。
 */
export class ScoreboardObjective {
    private constructor();
    /**
     * @remarks
     * 返回此记分板目标的玩家可见名称。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly displayName: string;
    /**
     * @remarks
     * 记分板目标的标识符。
     *
     * @throws 此属性在使用时可能会抛出异常。
     */
    readonly id: string;
    /**
     * @remarks
     * 返回 true if the ScoreboardObjective reference is still

     * valid.
     *
     */
    readonly isValid: boolean;
    /**
     * @remarks
     * 向给定的参与者和目标添加分数。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param participant
     * 要应用值加法的参与者。
     * @throws 此函数可能会抛出错误。
     */
    addScore(participant: Entity | ScoreboardIdentity | string, scoreToAdd: number): number;
    /**
     * @remarks
     * 返回所有目标参与者标识。
     *
     * @throws 此函数可能会抛出错误。
     */
    getParticipants(): ScoreboardIdentity[];
    /**
     * @remarks
     * 返回参与者的特定分数。
     *
     * @param participant
     * 要获取分数的参与者的标识符。
     * @throws 此函数可能会抛出错误。
     */
    getScore(participant: Entity | ScoreboardIdentity | string): number | undefined;
    /**
     * @remarks
     * 返回此目标对所有参与者的特定分数。
     *
     * @throws 此函数可能会抛出错误。
     */
    getScores(): ScoreboardScoreInfo[];
    /**
     * @remarks
     * 返回指定的标识是否为记分板目标的参与者。
     *
     * @throws 此函数可能会抛出错误。
     */
    hasParticipant(participant: Entity | ScoreboardIdentity | string): boolean;
    /**
     * @remarks
     * 从此记分板目标中移除参与者。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param participant
     * 要从此目标追踪中移除的参与者。
     * @throws 此函数可能会抛出错误。
     */
    removeParticipant(participant: Entity | ScoreboardIdentity | string): boolean;
    /**
     * @remarks
     * 为参与者设置分数。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param participant
     * 参与者的标识。
     * @param score
     * 分数的新值。
     * @throws 此函数可能会抛出错误。
     */
    setScore(participant: Entity | ScoreboardIdentity | string, score: number): void;
}

/**
  * 包含一对记分板参与者及其。
  * 相应分数。
 */
export class ScoreboardScoreInfo {
    private constructor();
    /**
     * @remarks
     * 此分数对应的记分板参与者。
     *
     */
    readonly participant: ScoreboardIdentity;
    /**
     * @remarks
     * 此目标下该标识的分数值。
     *
     */
    readonly score: number;
}

/**
  * 包含有关显示在屏幕上的用户界面元素的信息。
 * showing up on the screen.
 * @example setTitle.ts
 * ```typescript
 * import { world, DimensionLocation } from "@minecraft/server";
 *
 * function setTitle(targetLocation: DimensionLocation) {
 *   const players = world.getPlayers();
 *
 *   if (players.length > 0) {
 *     players[0].onScreenDisplay.setTitle("§o§6Fancy Title§r");
 *   }
 * }
 * ```
 * @example setTitleAndSubtitle.ts
 * ```typescript
 * import { world, DimensionLocation } from "@minecraft/server";
 *
 * function setTitleAndSubtitle(
 *     targetLocation: DimensionLocation
 * ) {
 *   const players = world.getPlayers();
 *
 *   players[0].onScreenDisplay.setTitle("Chapter 1", {
 *     stayDuration: 100,
 *     fadeInDuration: 2,
 *     fadeOutDuration: 4,
 *     subtitle: "Trouble in Block Town",
 *   });
 * }
 * ```
 * @example countdown.ts
 * ```typescript
 * import { world, system, DimensionLocation } from "@minecraft/server";
 *
 * function countdown(targetLocation: DimensionLocation) {
 *   const players = world.getPlayers();
 *
 *   players[0].onScreenDisplay.setTitle("Get ready!", {
 *     stayDuration: 220,
 *     fadeInDuration: 2,
 *     fadeOutDuration: 4,
 *     subtitle: "10",
 *   });
 *
 *   let countdown = 10;
 *
 *   const intervalId = system.runInterval(() => {
 *     countdown--;
 *     players[0].onScreenDisplay.updateSubtitle(countdown.toString());
 *
 *     if (countdown == 0) {
 *       system.clearRun(intervalId);
 *     }
 *   }, 20);
 * }
 * ```
 */
export class ScreenDisplay {
    private constructor();
    /**
     * @remarks
     * 返回 true if the current reference to this screen display

      * 管理器对象有效且功能正常。
     *
     */
    readonly isValid: boolean;
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    getHiddenHudElements(): HudElement[];
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    hideAllExcept(hudElements?: HudElement[]): void;
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    isForcedHidden(hudElement: HudElement): boolean;
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    resetHudElementsVisibility(): void;
    /**
     * @remarks
     * 设置动作栏文本 - 显示在标题下方和快捷栏上方的一段文本。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param text
     * 动作栏文本的新值。
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     *
     * {@link RawMessageError}
     */
    setActionBar(text: (RawMessage | string)[] | RawMessage | string): void;
    /**
     * @remarks
     * 设置抬头显示器（HUD）特定元素的可见性。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param visible
     * 是将 HUD 元素设置为不可见，还是将其重置为默认值。
     * @param hudElements
     * 可选的要配置可见性的 HUD 元素列表。
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     */
    setHudVisibility(visible: HudVisibility, hudElements?: HudElement[]): void;
    /**
     * @remarks
     * 将在玩家的屏幕显示上显示标题。如果设置为空字符串，将清除标题。您可以选择指定额外的副标题以及淡入、停留和淡出时间。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link InvalidEntityError}
     *
     * {@link RawMessageError}
     * @example setTitle.ts
     * ```typescript
     * import { world, DimensionLocation } from "@minecraft/server";
     *
     * function setTitle(targetLocation: DimensionLocation) {
     *   const players = world.getPlayers();
     *
     *   if (players.length > 0) {
     *     players[0].onScreenDisplay.setTitle("§o§6Fancy Title§r");
     *   }
     * }
     * ```
     * @example setTitleAndSubtitle.ts
     * ```typescript
     * import { world, DimensionLocation } from "@minecraft/server";
     *
     * function setTitleAndSubtitle(
     *     targetLocation: DimensionLocation
     * ) {
     *   const players = world.getPlayers();
     *
     *   players[0].onScreenDisplay.setTitle("Chapter 1", {
     *     stayDuration: 100,
     *     fadeInDuration: 2,
     *     fadeOutDuration: 4,
     *     subtitle: "Trouble in Block Town",
     *   });
     * }
     * ```
     * @example countdown.ts
     * ```typescript
     * import { world, system, DimensionLocation } from "@minecraft/server";
     *
     * function countdown(targetLocation: DimensionLocation) {
     *   const players = world.getPlayers();
     *
     *   players[0].onScreenDisplay.setTitle("Get ready!", {
     *     stayDuration: 220,
     *     fadeInDuration: 2,
     *     fadeOutDuration: 4,
     *     subtitle: "10",
     *   });
     *
     *   let countdown = 10;
     *
     *   const intervalId = system.runInterval(() => {
     *     countdown--;
     *     players[0].onScreenDisplay.updateSubtitle(countdown.toString());
     *
     *     if (countdown == 0) {
     *       system.clearRun(intervalId);
     *     }
     *   }, 20);
     * }
     * ```
     */
    setTitle(title: (RawMessage | string)[] | RawMessage | string, options?: TitleDisplayOptions): void;
    /**
     * @remarks
     * 如果之前通过 setTitle 方法显示了副标题，则更新副标题。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws 此函数可能会抛出错误。
     *
     * {@link InvalidEntityError}
     *
     * {@link RawMessageError}
     * @example countdown.ts
     * ```typescript
     * import { world, system, DimensionLocation } from "@minecraft/server";
     *
     * function countdown(targetLocation: DimensionLocation) {
     *   const players = world.getPlayers();
     *
     *   players[0].onScreenDisplay.setTitle("Get ready!", {
     *     stayDuration: 220,
     *     fadeInDuration: 2,
     *     fadeOutDuration: 4,
     *     subtitle: "10",
     *   });
     *
     *   let countdown = 10;
     *
     *   const intervalId = system.runInterval(() => {
     *     countdown--;
     *     players[0].onScreenDisplay.updateSubtitle(countdown.toString());
     *
     *     if (countdown == 0) {
     *       system.clearRun(intervalId);
     *     }
     *   }, 20);
     * }
     * ```
     */
    updateSubtitle(subtitle: (RawMessage | string)[] | RawMessage | string): void;
}

/**
  * 返回有关 /scriptevent 命令调用的附加数据。
  * 调用。
 */
export class ScriptEventCommandMessageAfterEvent {
    private constructor();
    /**
     * @remarks
     * 此 ScriptEvent 命令消息的标识符。
     *
     */
    readonly id: string;
    /**
     * @remarks
     * 如果此命令是通过 NPC 发起的，则返回发起 NPC 对话的实体。
     *
     */
    readonly initiator?: Entity;
    /**
     * @remarks
     * 随脚本事件命令传入的可选附加数据。
     *
     */
    readonly message: string;
    /**
     * @remarks
     * 如果此命令是通过方块（例如命令方块）触发的，则为源方块。
     *
     */
    readonly sourceBlock?: Block;
    /**
     * @remarks
     * 如果此命令是由实体（例如 NPC）触发的，则为源实体。
     *
     */
    readonly sourceEntity?: Entity;
    /**
     * @remarks
     * 返回触发此命令的源类型。
     *
     */
    readonly sourceType: ScriptEventSource;
}

/**
  * 允许注册响应传入的 /scriptevent 命令的事件处理器。
 * inbound /scriptevent commands.
 */
export class ScriptEventCommandMessageAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 注册一个新的 ScriptEvent 处理器。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(
        callback: (arg0: ScriptEventCommandMessageAfterEvent) => void,
        options?: ScriptEventMessageFilterOptions,
    ): (arg0: ScriptEventCommandMessageAfterEvent) => void;
    /**
     * @remarks
     * 取消注册特定 ScriptEvent 事件的处理器。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: ScriptEventCommandMessageAfterEvent) => void): void;
}

/**
  * 描述此可骑乘实体上的特定座位位置。
  * 实体。
 */
export class Seat {
    private constructor();
    /**
     * @remarks
     * 骑手在骑乘此实体时允许旋转的角度（以度为单位）。
     *
     */
    readonly lockRiderRotation: number;
    /**
     * @remarks
     * 此座位可以支持的最大骑手数量。
     *
     */
    readonly maxRiderCount: number;
    /**
     * @remarks
     * 如果要填充此座位位置，可以放置的最小骑手数量。
     *
     */
    readonly minRiderCount: number;
    /**
     * @remarks
     * 此座位的物理位置，相对于实体的
     * 
     *
     */
    readonly position: Vector3;
    /**
     * @remarks
     * 骑手旋转的角度（以度为单位）。
     *
     */
    readonly seatRotation: number;
}

/**
  * 战利品物品函数，修改掉落的盔甲。
  * 物品。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SetArmorTrimFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 应用于盔甲装饰的材料。
     *
     */
    readonly material: string;
    /**
     * @remarks
     * 应用于盔甲装饰的图案。
     *
     */
    readonly pattern: string;
}

/**
  * 战利品物品函数，修改的旗帜类型。
  * 掉落。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SetBannerDetailsFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 要掉落的旗帜类型。
     *
     */
    readonly 'type': number;
}

/**
  * 战利品物品函数，修改掉落的。
  * 书的内容。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SetBookContentsFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 书籍作者的名称。
     *
     */
    readonly author: string;
    /**
     * @remarks
     * 要放置在书页中的文本数组。
     *
     */
    readonly pages: string[];
    /**
     * @remarks
     * 书籍的标题。
     *
     */
    readonly title: string;
}

/**
  * 战利品物品函数，修改掉落物品的。
  * 基于颜色索引的数据值。如果未设置颜色索引，默认为零。
  * 索引已设置。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SetDataFromColorIndexFunction extends LootItemFunction {
    private constructor();
}

/**
  * 战利品物品函数，修改掉落的物品数量。
  * 从战利品池条目。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SetItemCountFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 函数从中随机选择掉落物品数量的值范围。包含最小值和最大值。
     *
     */
    readonly count: minecraftcommon.NumberRange;
}

/**
  * 战利品物品函数，修改的耐久度值。
  * 掉落物品。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SetItemDamageFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 函数从中随机选择要分配的耐久度值的值范围。包含最小值和最大值。必须始终在 0.0 和 1.0 之间。
     *
     */
    readonly damage: minecraftcommon.NumberRange;
}

/**
  * 战利品物品函数，修改的。
 * dropped.
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SetItemDataFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 函数从中随机选择要分配的数据值的值范围。包含最小值和最大值。
     *
     */
    readonly data: minecraftcommon.NumberRange;
}

/**
  * 战利品物品函数，修改的 lore。
 * dropped.
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SetItemLoreFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 应用于掉落物品的 lore。
     *
     */
    readonly lore: string[];
}

/**
  * 战利品物品函数，修改的名称。
 * dropped.
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SetItemNameFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 应用于掉落物品的名称。
     *
     */
    readonly name: string;
}

/**
  * 战利品物品函数，修改不祥之瓶的。
  * 放大值。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SetOminousBottleFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 函数从中随机选择要分配的放大值的值范围。包含最小值和最大值。
     *
     */
    readonly amplifier: minecraftcommon.NumberRange;
}

/**
 * 战利品物品函数，为掉落的药水分配类型。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SetPotionFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 要分配给掉落药水的 ID。
     *
     */
    readonly id: string;
}

/**
  * 战利品物品函数，为掉落的分配实体类型。
  * 刷怪蛋。仅适用于刷怪蛋。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SetSpawnEggFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 要分配给掉落蛋的实体。
     *
     */
    readonly id: string;
}

/**
  * 战利品物品函数，修改掉落的。
  * 煲的效果。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SetStewEffectFunction extends LootItemFunction {
    private constructor();
    /**
     * @remarks
     * 一个整数数组，对应要随机选择并应用于掉落物品的煲效果。
     *
     */
    readonly effects: number[];
}

/**
  * 提供一个可适应的接口，供调用者订阅在游戏世界关闭前触发的事件。
  * 此事件在玩家离开后、世界关闭前发生。
 * event occurs after players have left, but before the world
  * 已关闭。
 */
export class ShutdownBeforeEventSignal {
    private constructor();
    /**
     * @remarks
     * 为此事件添加新的订阅者回调。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此事件触发时调用的函数回调。
     * 此闭包在受限执行权限下被调用。
     * @returns
     * 在受限执行权限下调用的闭包。
     */
    subscribe(callback: (arg0: ShutdownEvent) => void): (arg0: ShutdownEvent) => void;
    /**
     * @remarks
     * 移除先前通过 subscribe 方法订阅的订阅者回调。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 先前传递给 subscribe 方法的函数闭包。
     * 此闭包在受限执行权限下被调用。
     */
    unsubscribe(callback: (arg0: ShutdownEvent) => void): void;
}

/**
  * 当游戏世界关闭时分发的事件对象。
  * 关闭。
 */
export class ShutdownEvent {
    private constructor();
}

/**
  * 战利品物品函数，处理掉落物品如同。
  * 在熔炉中冶炼或烹饪过一样。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SmeltItemFunction extends LootItemFunction {
    private constructor();
}

/**
  * 战利品物品函数，将一种或多种预定义的。
  * 附魔应用到掉落物品上。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class SpecificEnchantFunction extends LootItemFunction {
    private constructor();
    readonly enchantments: EnchantInfo[];
}

export class StartupBeforeEventSignal {
    private constructor();
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在早期执行权限下被调用。
     * @returns
     * 在早期执行权限下调用的闭包。
     */
    subscribe(callback: (arg0: StartupEvent) => void): (arg0: StartupEvent) => void;
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在早期执行权限下被调用。
     */
    unsubscribe(callback: (arg0: StartupEvent) => void): void;
}

export class StartupEvent {
    private constructor();
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly blockComponentRegistry: BlockComponentRegistry;
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly customCommandRegistry: CustomCommandRegistry;
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly itemComponentRegistry: ItemComponentRegistry;
}

/**
  * 表示已加载的结构模板（.mcstructure 文件）。
  * 可以使用 /structure 命令或 {@link StructureManager} API 在世界中放置结构。
 * command or the {@link StructureManager} APIs.
 */
export class Structure {
    private constructor();
    /**
     * @remarks
     * 结构的名称。标识符必须包含命名空间。对于通过 /structure 命令或结构方块创建的结构，此命名空间默认为 "mystructure"。
     *
     */
    readonly id: string;
    /**
     * @remarks
      * 返回结构是否有效。如果结构被删除，则可能变为无效。

      * 如果被删除则无效。
     *
     */
    readonly isValid: boolean;
    /**
     * @remarks
     * 结构的尺寸。例如，单个方块结构的大小为 {x:1, y:1, z:1}。
     *
     * @throws 此属性在使用时可能会抛出异常。
     *
     * {@link InvalidStructureError}
     */
    readonly size: Vector3;
    /**
     * @remarks
     * 返回表示结构中指定位置的方块的 BlockPermutation。 
     *
     * @param location
     * 相对于结构原点的方块位置。
     * @returns
     * 返回 BlockPermutation。如果指定位置不存在方块，则返回 undefined。 
     * @throws
     * 如果位置超出结构边界则抛出错误。如果结构已被删除则抛出错误。
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidStructureError}
     */
    getBlockPermutation(location: Vector3): BlockPermutation | undefined;
    /**
     * @remarks
      * 返回指定位置的方块是否含水。

      * 含水。
     *
     * @param location
     * 相对于结构原点的方块位置。
     * @returns
      * 返回指定位置的方块是否含水。

     * waterlogged. 返回 false if a block does not exist at the

     * given 
     * @throws
     * 如果位置超出结构边界则抛出错误。如果结构已被删除则抛出错误。
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidStructureError}
     */
    getIsWaterlogged(location: Vector3): boolean;
    /**
     * @remarks
     * 创建结构的副本并保存为新名称。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param identifier
     * 新创建的结构的名称。
     * @param saveMode
     * 确定结构的保存方式。默认为保存到世界。
     * 默认值：1
     * @returns
     * 返回新创建的结构。
     * @throws
     * 如果标识符无效则抛出错误。有效标识符必须包含命名空间且必须唯一。
     * 如果结构已被删除则抛出错误。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidStructureError}
     */
    saveAs(identifier: string, saveMode?: StructureSaveMode): Structure;
    /**
     * @remarks
     * 将修改后的结构保存到世界文件。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws
     * 如果结构已被删除则抛出错误。
     *
     * {@link InvalidStructureError}
     */
    saveToWorld(): void;
    /**
     * @remarks
     * 在结构中设置 BlockPermutation。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param location
     * 相对于结构原点的方块位置。
     * @param blockPermutation
     * 要设置的 BlockPermutation。
     * 默认值：null
     * @param waterlogged
     * 指定方块是否应含水。空气和未定义的方块不能含水。
     * 默认值：false
     * @throws
     * 如果方块类型为 StructureVoid 则抛出错误。
     * 如果方块未定义且含水设置为 true 则抛出错误。
     * 如果方块是空气且含水设置为 true 则抛出错误。
     * true。
     * 如果方块为空气且 waterlogged 设置为 true 则抛出错误。
     * 如果位置超出结构的边界则抛出错误。
     * 如果结构已被删除则抛出错误。
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidStructureError}
     */
    setBlockPermutation(location: Vector3, blockPermutation?: BlockPermutation, waterlogged?: boolean): void;
}

/**
 * 结构相关 API 的管理器。包含创建、获取、放置和删除结构的 API。
 * 创建、获取、放置和删除结构。
 */
export class StructureManager {
    private constructor();
    /**
     * @remarks
     * 在内存中创建一个空结构。使用 {@link
     * Structure.setBlockPermutation} 来填充结构
     * 的方块，并使用 {@link Structure.saveAs} 保存更改。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param identifier
     * 结构的名称。有效标识符必须包含
     * 命名空间且必须唯一。
     * @param size
     * 结构的大小。例如，要创建
     * 一个单方块结构，大小应为 {x:1, y:1, z:1}。
     * @param saveMode
     * 创建时结构的保存方式。默认为
     * StructureSaveMode.Memory。
     * 默认值：0
     * @returns
     * 返回新创建的结构。
     * @throws
     * 如果标识符无效则抛出错误。有效标识符必须
     * 包含命名空间且必须唯一。
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     */
    createEmpty(identifier: string, size: Vector3, saveMode?: StructureSaveMode): Structure;
    /**
     * @remarks
     * 从世界中的方块创建新结构。这
     * 在功能上等同于 /structure save 命令。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param identifier
     * 结构的名称。有效标识符必须包含
     * 命名空间且必须唯一。
     * @param dimension
     * 应从中读取方块的维度。
     * @param options
     * 从世界创建结构的附加选项。
     * @returns
     * 返回新创建的结构。
     * @throws
     * 如果标识符无效则抛出错误。有效标识符必须
     * 包含命名空间且必须唯一。
     * 如果结构边界超过最大尺寸则抛出错误。
     * 如果结构边界包含超出
     * 世界边界的方块则抛出错误。
     *
     *
     * {@link minecraftcommon.InvalidArgumentError}
     */
    createFromWorld(
        identifier: string,
        dimension: Dimension,
        from: Vector3,
        to: Vector3,
        options?: StructureCreateOptions,
    ): Structure;
    /**
     * @remarks
     * 从内存和世界中删除结构（如果
     * 存在）。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param structure
     * 要删除的结构标识符或结构对象。
     * 注意，删除后结构对象将变为无效。
     * 删除后结构对象将变为无效。
     * @returns
     * 返回结构是否已被移除。
     * @throws
     * 如果无法移除结构则抛出错误。例如，
     * 从行为包加载的结构。
     *
     * {@link minecraftcommon.InvalidArgumentError}
     */
    delete(structure: string | Structure): boolean;
    /**
     * @remarks
     * 获取保存到内存或世界中的结构。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param identifier
     * 要获取的结构的名称。
     * @returns
     * 如果结构存在则返回结构，否则返回 undefined。
     */
    get(identifier: string): Structure | undefined;
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     */
    getWorldStructureIds(): string[];
    /**
     * @remarks
     * 在世界中放置结构。放置在
     * 未加载区块中的结构将被排队等待加载。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param structure
     * 结构的标识符或结构对象。
     * @param dimension
     * 应放置结构的维度。
     * @param location
     * 维度中应放置结构的位置。
     * 放置结构。
     * @param options
     * 结构放置的附加选项。
     * @throws
     * 如果完整性值超出 [0,1] 范围则抛出错误。
     * 如果完整性种子无效则抛出错误。
     * 如果放置位置包含超出
     * 世界边界的方块则抛出错误。
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link InvalidStructureError}
     */
    place(
        structure: string | Structure,
        dimension: Dimension,
        location: Vector3,
        options?: StructurePlaceOptions,
    ): void;
    /**
     * @remarks
     * 在世界中放置部分拼图结构。这
     * 有助于调试拼图方块之间的连接。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param pool
     * 要开始的模板池的标识符。
     * @param targetJigsaw
     * 要开始的拼图方块的名称。该方块
     * 必须至少包含在起始池结构模板之一中。
     * 模板。
     * @param maxDepth
     * 拼图结构的最大递归深度。
     * 范围：[1, 20]
     * @param dimension
     * 放置拼图结构的维度。
     * @param location
     * 拼图结构开始生成的位置。请注意，
     * 相对于 targetJigsaw 方块生成。
     * @param options
     * 生成拼图结构时使用的可选设置。
     * 结构。
     * @returns
     * 返回一个 {@link BlockBoundingBox} 对象，表示
     * 拼图结构的最大边界。
     * @throws
     * 如果 maxDepth 超出 [1,20] 范围则抛出错误。
     * 如果由于参数无效或拼图配置
     * 导致生成失败则抛出错误。
     * 如果放置位置包含超出
     * 世界边界的方块则抛出错误。
     *
     * {@link PlaceJigsawError}
     */
    placeJigsaw(
        pool: string,
        targetJigsaw: string,
        maxDepth: number,
        dimension: Dimension,
        location: Vector3,
        options?: JigsawPlaceOptions,
    ): BlockBoundingBox;
    /**
     * @remarks
     * 在世界中放置拼图结构。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param identifier
     * 拼图结构的标识符。
     * @param dimension
     * 放置拼图结构的维度。
     * @param location
     * 拼图结构开始生成的位置。请注意，
     * y 值将被结构的起始高度覆盖，除非
     * 设置了
     * ignoreStartHeight 选项。
     * 选项被设置。
     * @param options
     * 生成拼图结构时使用的可选设置。
     * 结构。
     * @returns
     * 返回一个 {@link BlockBoundingBox} 对象，表示
     * 拼图结构的最大边界。
     * @throws
     * 如果由于参数无效或拼图配置
     * 导致生成失败则抛出错误。
     * 如果放置位置包含超出
     * 世界边界的方块则抛出错误。
     *
     * {@link PlaceJigsawError}
     */
    placeJigsawStructure(
        identifier: string,
        dimension: Dimension,
        location: Vector3,
        options?: JigsawStructurePlaceOptions,
    ): BlockBoundingBox;
}

/**
 * 提供系统级事件和函数的类。
 */
export class System {
    private constructor();
    /**
     * @remarks
     * 返回系统级操作的
     * after 事件集合。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly afterEvents: SystemAfterEvents;
    /**
     * @remarks
     * 返回系统级操作的
     * after 事件集合。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly beforeEvents: SystemBeforeEvents;
    /**
     * @remarks
     * 表示服务器的当前世界 tick。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly currentTick: number;
    /**
     * @remarks
     * 返回此世界是否已加载了编辑器，
     * 否则返回 false。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly isEditorWorld: boolean;
    /**
     * @remarks
     * 包含服务器的设备信息。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly serverSystemInfo: SystemInfo;
    /**
     * @remarks
     * 取消通过 {@link
     * System.runJob} 排队的作业的执行。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param jobId
     * 从 {@link System.runJob} 返回的作业 ID。
     */
    clearJob(jobId: number): void;
    /**
     * @remarks
     * 取消先前通过 {@link System.run}
     * 调度的函数运行的执行。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    clearRun(runId: number): void;
    /**
     * @remarks
     * 在下一个可用的未来时间运行指定函数。
     * 这通常用于实现延迟行为
     * 和游戏循环。在事件处理程序上下文中运行时，
     * 通常会在事件发生的同一 tick 结束时
     * 执行代码。在其他代码（
     * system.run 调用）中运行时，将在下一个 tick
     * 中执行函数。但请注意，取决于系统负载，
     * 不能保证在同一 tick 或下一个 tick 中运行。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 要在下一个游戏 tick 运行的函数回调。
     * @returns
     * 一个不透明标识符，可与 `clearRun`
     * 函数一起使用以取消此运行的执行。
     * @example trapTick.ts
     * ```typescript
     * import { world, system } from "@minecraft/server";
     *
     * function trapTick() {
     *   try {
     *     // Minecraft runs at 20 ticks per second.
     *     if (system.currentTick % 1200 === 0) {
     *       world.sendMessage("Another minute passes...");
     *     }
     *   } catch (e) {
     *     console.warn("Error: " + e);
     *   }
     *
     *   system.run(trapTick);
     * }
     * ```
     */
    run(callback: () => void): number;
    /**
     * @remarks
     * 按时间间隔运行一组代码。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 在此时间间隔触发时将运行的功能代码。
     * @param tickInterval
     * 回调将被调用的
     * 每隔 N tick 的时间间隔。
     * @returns
     * 一个不透明句柄，可与 clearRun 方法
     * 一起使用以停止此函数在间隔上的运行。
     * @example every30Seconds.ts
     * ```typescript
     * import { world, system, DimensionLocation } from "@minecraft/server";
     *
     * function every30Seconds(targetLocation: DimensionLocation) {
     *   const intervalRunIdentifier = Math.floor(Math.random() * 10000);
     *
     *   system.runInterval(() => {
     *     world.sendMessage("This is an interval run " + intervalRunIdentifier + " sending a message every 30 seconds.");
     *   }, 600);
     * }
     * ```
     */
    runInterval(callback: () => void, tickInterval?: number): number;
    /**
     * @remarks
     * 将生成器排队运行直到完成。生成器
     * 每个 tick 将获得一个时间片，并持续运行直到
     * 其 yield 或完成。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param generator
     * 要运行的生成器实例。
     * @returns
     * 一个不透明句柄，可与 {@link
     * System.clearJob} 一起使用以停止此生成器的运行。
     * @example cubeGenerator.ts
     * ```typescript
     * import { system, BlockPermutation, DimensionLocation } from "@minecraft/server";
     *
     * function cubeGenerator(targetLocation: DimensionLocation) {
     *   const blockPerm = BlockPermutation.resolve("minecraft:cobblestone");
     *
     *   system.runJob(blockPlacingGenerator(blockPerm, targetLocation, 15));
     * }
     *
     * function* blockPlacingGenerator(blockPerm: BlockPermutation, startingLocation: DimensionLocation, size: number) {
     *   for (let x = startingLocation.x; x < startingLocation.x + size; x++) {
     *     for (let y = startingLocation.y; y < startingLocation.y + size; y++) {
     *       for (let z = startingLocation.z; z < startingLocation.z + size; z++) {
     *         const block = startingLocation.dimension.getBlock({ x: x, y: y, z: z });
     *         if (block) {
     *           block.setPermutation(blockPerm);
     *         }
     *         yield;
     *       }
     *     }
     *   }
     * }
     * ```
     */
    runJob(generator: Generator<void, void, void>): number;
    /**
     * @remarks
     * 在由 tickDelay 指定的未来时间运行一组代码。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 在此超时触发时将运行的功能代码。
     * @param tickDelay
     * 时间间隔被调用之前的
     * tick 数。
     * @returns
     * 一个不透明句柄，可与 clearRun 方法
     * 一起使用以停止此函数在间隔上的运行。
     */
    runTimeout(callback: () => void, tickDelay?: number): number;
    /**
     * @remarks
     * 使用指定的消息 ID 和载荷
     * 在脚本中触发事件。
     *
     * @param id
     * 要发送的消息的标识符。这是自定义的，
     * 取决于您在世界中安装的
     * 行为包和内容类型。
     * @param message
     * 要发送的消息的数据组件。这是自定义的，
     * 取决于您在世界中安装的
     * 行为包和内容类型。
     * @throws This function can throw errors.
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     *
     * {@link NamespaceNameError}
     */
    sendScriptEvent(id: string, message: string): void;
    /**
     * @remarks
     * waitTicks 返回一个在请求的 tick 数
     * 之后解析的 promise。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param ticks
     * 要等待的 tick 数。最小值为 1。
     * @returns
     * 当指定数量的 tick
     * 已过去时解析的 promise。
     * @throws This function can throw errors.
     *
     * {@link minecraftcommon.EngineError}
     */
    waitTicks(ticks: number): Promise<void>;
}

/**
 * 提供在 Minecraft 更广泛的
 * 脚本系统中触发的事件集。
 */
export class SystemAfterEvents {
    private constructor();
    /**
     * @remarks
     * 当设置 /scriptevent 命令时触发的事件。这
     * 为命令和其他系统提供了一种
     * 在脚本中触发行为的方式。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly scriptEventReceive: ScriptEventCommandMessageAfterEventSignal;
}

/**
 * 在一系列实际操作发生之前触发的事件集。在
 * 大多数情况下，您可以取消或修改
 * 即将发生的事件。请注意，在 before 事件中，任何
 * 修改游戏状态的 API 将不会生效并会抛出错误。
 * 错误。
 */
export class SystemBeforeEvents {
    private constructor();
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly shutdown: ShutdownBeforeEventSignal;
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly startup: StartupBeforeEventSignal;
}

/**
 * 包含设备信息，如内存层级。
 */
export class SystemInfo {
    private constructor();
    /**
     * @remarks
     * 描述设备的内存。
     *
     */
    readonly memoryTier: MemoryTier;
}

/**
 * 包含与目标方块被击中相关的更改信息。
 * 击中。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class TargetBlockHitAfterEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
     * 源实体击中方块的位置。
     *
     */
    readonly hitVector: Vector3;
    /**
     * @remarks
     * 方块被击中前的红石能量。
     *
     */
    readonly previousRedstonePower: number;
    /**
     * @remarks
     * 方块被击中时的红石能量。
     *
     */
    readonly redstonePower: number;
    /**
     * @remarks
     * 击中目标方块的可选源实体。
     *
     */
    readonly source: Entity;
}

/**
 * 管理与目标方块被击中时相关的回调。
 * 被击中时。
 */
export class TargetBlockHitAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，当目标方块被击中时
     * 时。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: TargetBlockHitAfterEvent) => void): (arg0: TargetBlockHitAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，当目标方块被击中时
     * 时。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: TargetBlockHitAfterEvent) => void): void;
}

/**
 * 此管理器用于向维度添加、移除或查询临时
 * ticking 区域。这些 ticking 区域受
 * 每个包固定数量的 ticking 区块限制，
 * 独立于命令限制。无法修改或查询
 * 由其他包或命令添加的 ticking 区域。
 */
export class TickingAreaManager {
    private constructor();
    /**
     * @remarks
     * 此管理器中当前 ticking 的区块数。
     *
     */
    readonly chunkCount: number;
    /**
     * @remarks
     * 允许的最大 ticking 区块数。重叠的
     * ticking 区域区块会计入总数。
     *
     */
    readonly maxChunkCount: number;
    /**
     * @remarks
     * 创建一个 ticking 区域。当该区域中的
     * 所有区块都已加载并开始 ticking 时，Promise 将返回。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws This function can throw errors.
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link TickingAreaError}
     */
    createTickingArea(identifier: string, options: TickingAreaOptions): Promise<void>;
    /**
     * @remarks
     * 获取此管理器添加的所有 ticking 区域。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws This function can throw errors.
     *
     * {@link minecraftcommon.EngineError}
     */
    getAllTickingAreas(): TickingArea[];
    /**
     * @remarks
     * 尝试通过标识符获取特定的 ticking 区域。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws This function can throw errors.
     *
     * {@link minecraftcommon.EngineError}
     */
    getTickingArea(identifier: string | TickingArea): TickingArea | undefined;
    /**
     * @remarks
     * 如果管理器有足够的区块容量用于该
     * ticking 区域则返回 true，否则返回 false。
     * 如果长度或宽度超过 255 个区块的限制，也会返回 false。
     *
     * 此函数不能在限制执行模式下调用。
     *
     */
    hasCapacity(options: TickingAreaOptions): boolean;
    /**
     * @remarks
     * 如果标识符已存在于管理器中则返回 true，
     * 否则返回 false。
     *
     * 此函数不能在限制执行模式下调用。
     *
     */
    hasTickingArea(identifier: string): boolean;
    /**
     * @remarks
     * 移除此管理器添加的所有 ticking 区域。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws This function can throw errors.
     *
     * {@link minecraftcommon.EngineError}
     */
    removeAllTickingAreas(): void;
    /**
     * @remarks
     * 通过唯一标识符移除特定的 ticking 区域。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws This function can throw errors.
     *
     * {@link minecraftcommon.EngineError}
     *
     * {@link TickingAreaError}
     */
    removeTickingArea(identifier: string | TickingArea): void;
}

/**
 * 表示用于触发事件的触发器。
 */
export class Trigger {
    /**
     * @remarks
     * 触发器的事件名称。
     *
     */
    eventName: string;
    /**
     * @remarks
     * 创建一个新的触发器。
     *
     */
    constructor(eventName: string);
}

/**
 * 包含与绊线触发相关的更改信息。
 * @example tripWireTripEvent.ts
 * ```typescript
 * import { world, system, BlockPermutation, TripWireTripAfterEvent, DimensionLocation } from "@minecraft/server";
 * import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
 *
 * function tripWireTripEvent(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   // set up a tripwire
 *   const redstone = targetLocation.dimension.getBlock({
 *     x: targetLocation.x,
 *     y: targetLocation.y - 1,
 *     z: targetLocation.z,
 *   });
 *   const tripwire = targetLocation.dimension.getBlock(targetLocation);
 *
 *   if (redstone === undefined || tripwire === undefined) {
 *     log("Could not find block at location.");
 *     return -1;
 *   }
 *
 *   redstone.setPermutation(BlockPermutation.resolve(MinecraftBlockTypes.RedstoneBlock));
 *   tripwire.setPermutation(BlockPermutation.resolve(MinecraftBlockTypes.TripWire));
 *
 *   world.afterEvents.tripWireTrip.subscribe((tripWireTripEvent: TripWireTripAfterEvent) => {
 *     const eventLoc = tripWireTripEvent.block.location;
 *
 *     if (eventLoc.x === targetLocation.x && eventLoc.y === targetLocation.y && eventLoc.z === targetLocation.z) {
 *       log(
 *         "Tripwire trip event at tick " +
 *           system.currentTick +
 *           (tripWireTripEvent.sources.length > 0 ? " by entity " + tripWireTripEvent.sources[0].id : "")
 *       );
 *     }
 *   });
 * }
 * ```
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class TripWireTripAfterEvent extends BlockEvent {
    private constructor();
    /**
     * @remarks
     * 方块是否有红石能量。
     *
     */
    readonly isPowered: boolean;
    /**
     * @remarks
     * 触发绊线的源实体。
     *
     */
    readonly sources: Entity[];
}

/**
 * 管理与绊线被触发时相关的回调。
 * 被触发时。
 * @example tripWireTripEvent.ts
 * ```typescript
 * import { world, system, BlockPermutation, TripWireTripAfterEvent, DimensionLocation } from "@minecraft/server";
 * import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
 *
 * function tripWireTripEvent(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   // set up a tripwire
 *   const redstone = targetLocation.dimension.getBlock({
 *     x: targetLocation.x,
 *     y: targetLocation.y - 1,
 *     z: targetLocation.z,
 *   });
 *   const tripwire = targetLocation.dimension.getBlock(targetLocation);
 *
 *   if (redstone === undefined || tripwire === undefined) {
 *     log("Could not find block at location.");
 *     return -1;
 *   }
 *
 *   redstone.setPermutation(BlockPermutation.resolve(MinecraftBlockTypes.RedstoneBlock));
 *   tripwire.setPermutation(BlockPermutation.resolve(MinecraftBlockTypes.TripWire));
 *
 *   world.afterEvents.tripWireTrip.subscribe((tripWireTripEvent: TripWireTripAfterEvent) => {
 *     const eventLoc = tripWireTripEvent.block.location;
 *
 *     if (eventLoc.x === targetLocation.x && eventLoc.y === targetLocation.y && eventLoc.z === targetLocation.z) {
 *       log(
 *         "Tripwire trip event at tick " +
 *           system.currentTick +
 *           (tripWireTripEvent.sources.length > 0 ? " by entity " + tripWireTripEvent.sources[0].id : "")
 *       );
 *     }
 *   });
 * }
 * ```
 */
export class TripWireTripAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，当绊线被触发时
     * 时。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: TripWireTripAfterEvent) => void): (arg0: TripWireTripAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，当绊线被触发时
     * 时。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: TripWireTripAfterEvent) => void): void;
}

/**
 * 包含与环境中天气变化相关的信息。
 * 环境。
 */
export class WeatherChangeAfterEvent {
    private constructor();
    /**
     * @remarks
     * 天气发生变化的维度。
     *
     */
    readonly dimension: string;
    /**
     * @remarks
     * 天气变化后的天气类型。
     *
     */
    readonly newWeather: WeatherType;
    /**
     * @remarks
     * 天气变化前的天气类型。
     *
     */
    readonly previousWeather: WeatherType;
}

/**
 * 管理与天气变化相关的回调。
 */
export class WeatherChangeAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，当天气变化时将被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: WeatherChangeAfterEvent) => void): (arg0: WeatherChangeAfterEvent) => void;
    /**
     * @remarks
     * 移除一个回调，当天气变化时将不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: WeatherChangeAfterEvent) => void): void;
}

/**
 * 包含与环境中天气变化相关的信息。
 * 环境。
 */
export class WeatherChangeBeforeEvent {
    private constructor();
    /**
     * @remarks
     * 如果设置为 true，天气变化将被取消。
     *
     */
    cancel: boolean;
    /**
     * @remarks
     * 设置新天气的持续时间（以 tick 计）。
     *
     */
    duration: number;
    /**
     * @remarks
     * 将应用的天气类型。
     *
     */
    newWeather: WeatherType;
    /**
     * @remarks
     * 事件触发之前的
     * 天气类型。
     *
     */
    readonly previousWeather: WeatherType;
}

/**
 * 管理与天气变化之前相关的回调。
 * 变化。
 */
export class WeatherChangeBeforeEventSignal {
    private constructor();
    /**
     * @remarks
     * 添加一个回调，在天气变化之前将被调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     * @returns
     * 此闭包在受限执行权限下被调用。
     */
    subscribe(callback: (arg0: WeatherChangeBeforeEvent) => void): (arg0: WeatherChangeBeforeEvent) => void;
    /**
     * @remarks
     * 移除一个回调，在天气变化之前将不再调用。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     * @param callback
     * 此闭包在受限执行权限下被调用。
     */
    unsubscribe(callback: (arg0: WeatherChangeBeforeEvent) => void): void;
}

/**
 * 封装世界状态的类——包含一组维度
 * 及 Minecraft 环境。
 */
export class World {
    private constructor();
    /**
     * @remarks
     * 包含一组适用于整个
     * 世界的事件。事件回调以延迟方式调用。
     * 事件回调在读-写模式下执行。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly afterEvents: WorldAfterEvents;
    /**
     * @remarks
     * 包含一组适用于整个
     * 世界的事件。事件回调立即调用。
     * 事件回调在只读模式下执行。
     *
     * 此属性可以在早期执行模式下读取。
     *
     * @example customCommand.ts
     * ```typescript
     * import { world, DimensionLocation } from "@minecraft/server";
     *
     * function customCommand(targetLocation: DimensionLocation) {
     *   const chatCallback = world.beforeEvents.chatSend.subscribe((eventData) => {
     *     if (eventData.message.includes("cancel")) {
     *       // Cancel event if the message contains "cancel"
     *       eventData.cancel = true;
     *     } else {
     *       const args = eventData.message.split(" ");
     *
     *       if (args.length > 0) {
     *         switch (args[0].toLowerCase()) {
     *           case "echo":
     *             // Send a modified version of chat message
     *             world.sendMessage(`Echo '${eventData.message.substring(4).trim()}'`);
     *             break;
     *           case "help":
     *             world.sendMessage(`Available commands: echo <message>`);
     *             break;
     *         }
     *       }
     *     }
     *   });
     * }
     * ```
     */
    readonly beforeEvents: WorldBeforeEvents;
    /**
     * @remarks
     * 适用于世界的游戏规则。
     *
     */
    readonly gameRules: GameRules;
    readonly isHardcore: boolean;
    /**
     * @remarks
     * 返回适用于该
     * 世界。
     *
     */
    readonly scoreboard: Scoreboard;
    /**
     * @remarks
     * 世界种子。
     *
     */
    readonly seed: string;
    /**
     * @remarks
     * 返回用于 {@link Structure} 相关 API 的管理器。
     *
     */
    readonly structureManager: StructureManager;
    /**
     * @remarks
     * 用于添加、移除和查询特定于包的
     * ticking 区域的管理器。
     *
     */
    readonly tickingAreaManager: TickingAreaManager;
    /**
     * @remarks
     * 清除在此世界内为此行为包
     * 声明的动态属性集合。
     *
     */
    clearDynamicProperties(): void;
    /**
     * @remarks
     * 返回自世界开始以来的绝对时间。
     *
     */
    getAbsoluteTime(): number;
    /**
     * @remarks
     * 返回世界中所有活跃玩家的数组。
     *
     * @throws This function can throw errors.
     *
     * {@link CommandError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     */
    getAllPlayers(): Player[];
    /**
     * @remarks
     * 返回当前天数。
     *
     * @returns
     * 当前天数，由世界时间除以每天的 tick 数确定。
     * 新世界从第 0 天开始。
     */
    getDay(): number;
    /**
     * @remarks
     * 返回默认主世界出生点位置。
     *
     * @returns
     * 默认主世界出生点位置。默认情况下，Y
     * 坐标为 32767，表示玩家的出生高度
     * 不固定，将由周围的方块决定。
     */
    getDefaultSpawnLocation(): Vector3;
    /**
     * @remarks
     * 获取世界的难度。
     *
     * @returns
     * 返回世界难度。
     */
    getDifficulty(): Difficulty;
    /**
     * @remarks
     * 返回维度对象。
     *
     * @param dimensionId
     * 维度的名称。例如，"overworld"、
     * "nether" 或 "the_end"。
     * @returns
     * 请求的维度。
     * @throws
     * 如果给定的维度名称无效则抛出错误。
     */
    getDimension(dimensionId: string): Dimension;
    /**
     * @remarks
     * 返回属性值。
     *
     * @param identifier
     * 属性标识符。
     * @returns
     * 返回属性值，如果属性尚未设置则返回
     * undefined。
     * @throws
     * 如果给定的动态属性标识符
     * 未定义则抛出错误。
     * @example incrementDynamicProperty.ts
     * ```typescript
     * import { world, DimensionLocation } from "@minecraft/server";
     *
     * function incrementDynamicProperty(
     *   log: (message: string, status?: number) => void,
     *   targetLocation: DimensionLocation
     * ) {
     *   let number = world.getDynamicProperty("samplelibrary:number");
     *
     *   log("Current value is: " + number);
     *
     *   if (number === undefined) {
     *     number = 0;
     *   }
     *
     *   if (typeof number !== "number") {
     *     log("Number is of an unexpected type.");
     *     return -1;
     *   }
     *
     *   world.setDynamicProperty("samplelibrary:number", number + 1);
     * }
     * ```
     * @example incrementDynamicPropertyInJsonBlob.ts
     * ```typescript
     * import { world, DimensionLocation } from "@minecraft/server";
     *
     * function incrementDynamicPropertyInJsonBlob(
     *   log: (message: string, status?: number) => void,
     *   targetLocation: DimensionLocation
     * ) {
     *   let paintStr = world.getDynamicProperty("samplelibrary:longerjson");
     *   let paint: { color: string; intensity: number } | undefined = undefined;
     *
     *   log("Current value is: " + paintStr);
     *
     *   if (paintStr === undefined) {
     *     paint = {
     *       color: "purple",
     *       intensity: 0,
     *     };
     *   } else {
     *     if (typeof paintStr !== "string") {
     *       log("Paint is of an unexpected type.");
     *       return -1;
     *     }
     *
     *     try {
     *       paint = JSON.parse(paintStr);
     *     } catch (e) {
     *       log("Error parsing serialized struct.");
     *       return -1;
     *     }
     *   }
     *
     *   if (!paint) {
     *     log("Error parsing serialized struct.");
     *     return -1;
     *   }
     *
     *   paint.intensity++;
     *   paintStr = JSON.stringify(paint); // be very careful to ensure your serialized JSON str cannot exceed limits
     *   world.setDynamicProperty("samplelibrary:longerjson", paintStr);
     * }
     * ```
     */
    getDynamicProperty(identifier: string): boolean | number | string | Vector3 | undefined;
    /**
     * @remarks
     * 获取在此世界中已设置的
     * 动态属性标识符集合。
     *
     * @returns
     * 活跃动态属性标识符的字符串数组。
     */
    getDynamicPropertyIds(): string[];
    /**
     * @remarks
     * 获取动态属性的总字节数。这可用于
     * 您自己的分析，以确保不会存储
     * 过大的动态属性集合。
     *
     */
    getDynamicPropertyTotalByteCount(): number;
    /**
     * @remarks
     * 根据提供的 ID 返回实体。
     *
     * @param id
     * 实体的 ID。
     * @returns
     * 请求的实体对象。
     * @throws
     * 如果给定的实体 ID 无效则抛出错误。
     */
    getEntity(id: string): Entity | undefined;
    /**
     * @remarks
     * 返回一个能够从各种来源
     * 生成战利品的管理器。
     *
     * @returns
     * 具有多种战利品生成方法的
     * 战利品表管理器。
     */
    getLootTableManager(): LootTableManager;
    /**
     * @remarks
     * 返回当前时间的月相。
     *
     */
    getMoonPhase(): MoonPhase;
    /**
     * @remarks
     * 基于通过 EntityQueryOptions 筛选条件集
     * 定义的条件返回一组玩家。
     *
     * @param options
     * 可用于筛选返回的
     * 玩家集合的附加选项。
     * @returns
     * 玩家数组。
     * @throws
     * 如果提供的 EntityQueryOptions 无效则抛出错误。
     *
     * {@link CommandError}
     *
     * {@link minecraftcommon.InvalidArgumentError}
     */
    getPlayers(options?: EntityQueryOptions): Player[];
    /**
     * @remarks
     * 返回一天中的时间。
     *
     * @returns
     * 一天中的时间，以 tick 计，范围在 0 到 24000 之间。
     */
    getTimeOfDay(): number;
    /**
     * @remarks
     * 为所有玩家播放特定的音乐曲目。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @throws This function can throw errors.
     *
     * {@link minecraftcommon.PropertyOutOfBoundsError}
     * @example playMusicAndSound.ts
     * ```typescript
     * import { world, MusicOptions, WorldSoundOptions, PlayerSoundOptions, DimensionLocation } from "@minecraft/server";
     *
     * function playMusicAndSound(targetLocation: DimensionLocation) {
     *   const players = world.getPlayers();
     *
     *   const musicOptions: MusicOptions = {
     *     fade: 0.5,
     *     loop: true,
     *     volume: 1.0,
     *   };
     *   world.playMusic("music.menu", musicOptions);
     *
     *   const worldSoundOptions: WorldSoundOptions = {
     *     pitch: 0.5,
     *     volume: 4.0,
     *   };
     *   world.playSound("ambient.weather.thunder", targetLocation, worldSoundOptions);
     *
     *   const playerSoundOptions: PlayerSoundOptions = {
     *     pitch: 1.0,
     *     volume: 1.0,
     *   };
     *
     *   players[0].playSound("bucket.fill_water", playerSoundOptions);
     * }
     * ```
     */
    playMusic(trackId: string, musicOptions?: MusicOptions): void;
    /**
     * @remarks
     * 为玩家排队额外的音乐曲目。如果
     * 没有曲目正在播放，音乐曲目将会播放。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param trackId
     * 要播放的音乐曲目的标识符。
     * @param musicOptions
     * 音乐曲目的附加选项。
     * @throws
     * 如果音量小于 0.0 将抛出错误。
     * 如果淡入淡出值小于 0.0 将抛出错误。
     *
     *
     * {@link minecraftcommon.PropertyOutOfBoundsError}
     */
    queueMusic(trackId: string, musicOptions?: MusicOptions): void;
    /**
     * @remarks
     * 向所有玩家发送消息。
     *
     * @param message
     * 要显示的消息。
     * @throws
     * 如果提供的 {@link RawMessage} 格式无效，
     * 此方法可能会抛出错误。例如，如果向 `score`
     * 提供了空的 `name` 字符串。
     */
    sendMessage(message: (RawMessage | string)[] | RawMessage | string): void;
    /**
     * @remarks
     * 设置世界时间。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param absoluteTime
     * 世界时间，以 tick 计。
     */
    setAbsoluteTime(absoluteTime: number): void;
    /**
     * @remarks
     * 为所有玩家设置默认出生点位置。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param spawnLocation
     * 出生点的位置。请注意，这
     * 假定在主世界维度内。
     * @throws
     * 如果提供的出生点位置超出边界则抛出错误。
     *
     * {@link Error}
     *
     * {@link LocationOutOfWorldBoundariesError}
     */
    setDefaultSpawnLocation(spawnLocation: Vector3): void;
    /**
     * @remarks
     * 设置世界难度。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param difficulty
     * 我们想要设置的世界难度。
     */
    setDifficulty(difficulty: Difficulty): void;
    /**
     * @remarks
     * 使用特定值设置多个动态属性。
     *
     * @param values
     * 要设置的动态属性键值对记录。
     * 设置。如果数据值为 null，则移除该属性
     * 而非设置。
     * @throws This function can throw errors.
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     */
    setDynamicProperties(values: Record<string, boolean | number | string | Vector3 | undefined>): void;
    /**
     * @remarks
     * 将指定属性设置为一个值。
     *
     * @param identifier
     * 属性标识符。
     * @param value
     * 要设置的属性数据值。如果值为 null，
     * 则移除该属性。
     * @throws
     * 如果给定的动态属性标识符
     * 未定义则抛出错误。
     *
     * {@link minecraftcommon.ArgumentOutOfBoundsError}
     * @example incrementDynamicProperty.ts
     * ```typescript
     * import { world, DimensionLocation } from "@minecraft/server";
     *
     * function incrementDynamicProperty(
     *   log: (message: string, status?: number) => void,
     *   targetLocation: DimensionLocation
     * ) {
     *   let number = world.getDynamicProperty("samplelibrary:number");
     *
     *   log("Current value is: " + number);
     *
     *   if (number === undefined) {
     *     number = 0;
     *   }
     *
     *   if (typeof number !== "number") {
     *     log("Number is of an unexpected type.");
     *     return -1;
     *   }
     *
     *   world.setDynamicProperty("samplelibrary:number", number + 1);
     * }
     * ```
     * @example incrementDynamicPropertyInJsonBlob.ts
     * ```typescript
     * import { world, DimensionLocation } from "@minecraft/server";
     *
     * function incrementDynamicPropertyInJsonBlob(
     *   log: (message: string, status?: number) => void,
     *   targetLocation: DimensionLocation
     * ) {
     *   let paintStr = world.getDynamicProperty("samplelibrary:longerjson");
     *   let paint: { color: string; intensity: number } | undefined = undefined;
     *
     *   log("Current value is: " + paintStr);
     *
     *   if (paintStr === undefined) {
     *     paint = {
     *       color: "purple",
     *       intensity: 0,
     *     };
     *   } else {
     *     if (typeof paintStr !== "string") {
     *       log("Paint is of an unexpected type.");
     *       return -1;
     *     }
     *
     *     try {
     *       paint = JSON.parse(paintStr);
     *     } catch (e) {
     *       log("Error parsing serialized struct.");
     *       return -1;
     *     }
     *   }
     *
     *   if (!paint) {
     *     log("Error parsing serialized struct.");
     *     return -1;
     *   }
     *
     *   paint.intensity++;
     *   paintStr = JSON.stringify(paint); // be very careful to ensure your serialized JSON str cannot exceed limits
     *   world.setDynamicProperty("samplelibrary:longerjson", paintStr);
     * }
     * ```
     */
    setDynamicProperty(identifier: string, value?: boolean | number | string | Vector3): void;
    /**
     * @remarks
     * 设置一天中的时间。
     *
     * 此函数不能在限制执行模式下调用。
     *
     * @param timeOfDay
     * 一天中的时间，以 tick 计，范围在 0 到 24000 之间。
     * @throws
     * 如果提供的时间不在有效
     * 范围内则抛出错误。
     */
    setTimeOfDay(timeOfDay: number | TimeOfDay): void;
    /**
     * @remarks
     * 停止所有音乐曲目的播放。
     *
     * 此函数不能在限制执行模式下调用。
     *
     */
    stopMusic(): void;
}

/**
 * 包含一组在整个世界
 * 范围内可用的事件。
 */
export class WorldAfterEvents {
    private constructor();
    /**
     * @remarks
     * 此事件针对爆炸破坏的每个方块位置触发。
     * 在方块已被破坏后触发。
     * 被破坏后。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly blockExplode: BlockExplodeAfterEventSignal;
    /**
     * @remarks
     * 当按钮被按下时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly buttonPush: ButtonPushAfterEventSignal;
    /**
     * @remarks
     * 当实体事件被触发且将更新
     * 实体的组件定义状态时触发此事件。
     * 实体。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly dataDrivenEntityTrigger: DataDrivenEntityTriggerAfterEventSignal;
    /**
     * @remarks
     * 当效果（如中毒）被添加到
     * 实体时。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly effectAdd: EffectAddAfterEventSignal;
    /**
     * @remarks
     * 当实体死亡时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entityDie: EntityDieAfterEventSignal;
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entityHeal: EntityHealAfterEventSignal;
    /**
     * @remarks
     * 当实体健康值发生任何程度的变化时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entityHealthChanged: EntityHealthChangedAfterEventSignal;
    /**
     * @remarks
     * 当实体击中（即近战攻击）
     * 方块时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entityHitBlock: EntityHitBlockAfterEventSignal;
    /**
     * @remarks
     * 当实体击中（即近战攻击）
     * 另一个实体时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entityHitEntity: EntityHitEntityAfterEventSignal;
    /**
     * @remarks
     * 当实体受伤（受到伤害）时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entityHurt: EntityHurtAfterEventSignal;
    /**
     * @remarks
     * 当实体掉落物品时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entityItemDrop: EntityItemDropAfterEventSignal;
    /**
     * @remarks
     * 当实体拾取物品时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entityItemPickup: EntityItemPickupAfterEventSignal;
    /**
     * @remarks
     * 当实体加载时触发。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entityLoad: EntityLoadAfterEventSignal;
    /**
     * @remarks
     * 当实体被移除时触发（例如，可能
     * 被卸载，或在被击杀后移除）。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entityRemove: EntityRemoveAfterEventSignal;
    /**
     * @remarks
     * 当实体生成时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entitySpawn: EntitySpawnAfterEventSignal;
    /**
     * @remarks
     * 在爆炸发生后触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly explosion: ExplosionAfterEventSignal;
    /**
     * @remarks
     * 当 world.gameRules 属性
     * 发生变化时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly gameRuleChange: GameRuleChangeAfterEventSignal;
    /**
     * @remarks
     * 当可充能物品完成充能时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly itemCompleteUse: ItemCompleteUseAfterEventSignal;
    /**
     * @remarks
     * 当可充能物品从充能状态
     * 释放时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly itemReleaseUse: ItemReleaseUseAfterEventSignal;
    /**
     * @remarks
     * 当可充能物品开始充能时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly itemStartUse: ItemStartUseAfterEventSignal;
    /**
     * @remarks
     * 当玩家通过按下使用物品/放置方块按钮成功
     * 使用物品或放置方块时触发此事件。如果
     * 放置了多个方块，此事件仅在方块放置开始时
     * 触发一次。注意：此事件不能与锄头或
     * 斧头物品一起使用。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly itemStartUseOn: ItemStartUseOnAfterEventSignal;
    /**
     * @remarks
     * 当可充能物品停止充能时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly itemStopUse: ItemStopUseAfterEventSignal;
    /**
     * @remarks
     * 当玩家在成功使用物品后释放使用物品/放置
     * 方块按钮时触发此事件。注意：此事件不能
     * 与锄头或斧头物品一起使用。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly itemStopUseOn: ItemStopUseOnAfterEventSignal;
    /**
     * @remarks
     * 当物品被玩家成功使用时
     * 玩家时。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly itemUse: ItemUseAfterEventSignal;
    /**
     * @remarks
     * 拉杆已被拉动。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly leverAction: LeverActionAfterEventSignal;
    /**
     * @remarks
     * 当活塞伸出或收缩时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly pistonActivate: PistonActivateAfterEventSignal;
    /**
     * @remarks
     * 此事件针对玩家破坏的方块触发。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerBreakBlock: PlayerBreakBlockAfterEventSignal;
    /**
     * @remarks
     * 当 {@link InputButton} 状态
     * 发生变化时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerButtonInput: PlayerButtonInputAfterEventSignal;
    /**
     * @remarks
     * 当玩家移动到不同维度时触发。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerDimensionChange: PlayerDimensionChangeAfterEventSignal;
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerEmote: PlayerEmoteAfterEventSignal;
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerGameModeChange: PlayerGameModeChangeAfterEventSignal;
    /**
     * @remarks
     * 当玩家选择的快捷栏槽位变化时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerHotbarSelectedSlotChange: PlayerHotbarSelectedSlotChangeAfterEventSignal;
    /**
     * @remarks
     * 当玩家的 {@link InputMode} 变化时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerInputModeChange: PlayerInputModeChangeAfterEventSignal;
    /**
     * @remarks
     * 当玩家的输入权限变化时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerInputPermissionCategoryChange: PlayerInputPermissionCategoryChangeAfterEventSignal;
    /**
     * @remarks
     * 当玩家与方块交互时的事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerInteractWithBlock: PlayerInteractWithBlockAfterEventSignal;
    /**
     * @remarks
     * 当玩家与实体交互时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerInteractWithEntity: PlayerInteractWithEntityAfterEventSignal;
    /**
     * @remarks
     * 当物品被添加或移除到
     * 玩家物品栏时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerInventoryItemChange: PlayerInventoryItemChangeAfterEventSignal;
    /**
     * @remarks
     * 当玩家加入世界时触发此事件。另请参阅
     * playerSpawn，了解玩家首次在世界中生成时
     * 可捕获的另一个相关事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerJoin: PlayerJoinAfterEventSignal;
    /**
     * @remarks
     * 当玩家离开世界时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerLeave: PlayerLeaveAfterEventSignal;
    /**
     * @remarks
     * 此事件针对玩家放置的方块触发。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerPlaceBlock: PlayerPlaceBlockAfterEventSignal;
    /**
     * @remarks
     * 当玩家生成或重生时触发此事件。请注意，
     * 此事件中的一个附加标志将告诉您玩家是在
     * 加入后立即生成还是重生。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerSpawn: PlayerSpawnAfterEventSignal;
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerSwingStart: PlayerSwingStartAfterEventSignal;
    /**
     * @remarks
     * 压力板已弹起（即压力板上
     * 没有实体）。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly pressurePlatePop: PressurePlatePopAfterEventSignal;
    /**
     * @remarks
     * 压力板已被按下（至少有一个实体
     * 移动到压力板上）。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly pressurePlatePush: PressurePlatePushAfterEventSignal;
    /**
     * @remarks
     * 当抛射物击中方块时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly projectileHitBlock: ProjectileHitBlockAfterEventSignal;
    /**
     * @remarks
     * 当抛射物击中实体时触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly projectileHitEntity: ProjectileHitEntityAfterEventSignal;
    /**
     * @remarks
     * 目标方块已被击中。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly targetBlockHit: TargetBlockHitAfterEventSignal;
    /**
     * @remarks
     * 绊线已被触发。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly tripWireTrip: TripWireTripAfterEventSignal;
    /**
     * @remarks
     * 当天气在
     * Minecraft 中发生变化时。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly weatherChange: WeatherChangeAfterEventSignal;
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly worldLoad: WorldLoadAfterEventSignal;
}

/**
 * 在一系列实际操作发生之前触发的事件集。在
 * 大多数情况下，您可以取消或修改
 * 即将发生的事件。请注意，在 before 事件中，任何
 * 修改游戏状态的 API 将不会生效并会抛出错误。
 * （例如 dimension.spawnEntity）。
 */
export class WorldBeforeEvents {
    private constructor();
    /**
     * @remarks
     * 当事件被添加到实体后
     * 时。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly effectAdd: EffectAddBeforeEventSignal;
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entityHeal: EntityHealBeforeEventSignal;
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entityHurt: EntityHurtBeforeEventSignal;
    /**
     * @remarks
     * 在实体拾取物品之前触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entityItemPickup: EntityItemPickupBeforeEventSignal;
    /**
     * @remarks
     * 在实体从世界中被移除之前触发（例如，
     * 卸载或被击杀后移除）。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly entityRemove: EntityRemoveBeforeEventSignal;
    /**
     * @remarks
     * 在爆炸发生后触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly explosion: ExplosionBeforeEventSignal;
    /**
     * @remarks
     * 当物品被玩家成功使用时
     * 玩家时。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly itemUse: ItemUseBeforeEventSignal;
    /**
     * @remarks
     * 在玩家破坏方块之前触发此事件。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerBreakBlock: PlayerBreakBlockBeforeEventSignal;
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerGameModeChange: PlayerGameModeChangeBeforeEventSignal;
    /**
     * @remarks
     * 在玩家与方块交互之前触发。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerInteractWithBlock: PlayerInteractWithBlockBeforeEventSignal;
    /**
     * @remarks
     * 在玩家与实体交互之前触发。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerInteractWithEntity: PlayerInteractWithEntityBeforeEventSignal;
    /**
     * @remarks
     * 当玩家离开游戏时触发。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly playerLeave: PlayerLeaveBeforeEventSignal;
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly weatherChange: WeatherChangeBeforeEventSignal;
}

export class WorldLoadAfterEvent {
    private constructor();
}

export class WorldLoadAfterEventSignal {
    private constructor();
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    subscribe(callback: (arg0: WorldLoadAfterEvent) => void): (arg0: WorldLoadAfterEvent) => void;
    /**
     * @remarks
     * 此函数不能在限制执行模式下调用。
     *
     * 此函数可以在早期执行模式下调用。
     *
     */
    unsubscribe(callback: (arg0: WorldLoadAfterEvent) => void): void;
}

/**
 * 轴对齐边界框。
 */
export interface AABB {
    /**
     * @remarks
     * 边界框的中心点。
     *
     */
    center: Vector3;
    /**
     * @remarks
     * 从中心点到边界框边界的绝对距离。
     * 相当于边界框长度、高度和宽度的一半。
     * 始终视为正值。
     *
     */
    extent: Vector3;
}

/**
 * 用于创建相机动画。
 */
export interface AnimationOptions {
    /**
     * @remarks
     * 相机动画的关键帧。
     *
     */
    animation: SplineAnimation;
    /**
     * @remarks
     * 相机动画的总时间（以秒计）。
     *
     */
    totalTimeSeconds: number;
}

export interface BiomeFilter {
    excludeBiomes?: string[];
    excludeTags?: string[];
    includeBiomes?: string[];
    includeTags?: string[];
}

/**
 * BlockBoundingBox 是一个表示 AABB 对齐矩形的
 * 对象接口。
 * BlockBoundingBox 假定其在有效状态
 * （min <= max）下创建，但无法保证（除非使用
 * 关联的 {@link
 * @minecraft/server.BlockBoundingBoxUtils} 工具函数。
 * min/max 坐标表示矩形对角线方向的
 * 相反角。
 * BlockBoundingBox 不是方块的表示——
 * 它与任何类型都没有关联，只是一个
 * 数学构造——因此一个从
 * (0,0,0) 到 (0,0,0) 的
 * 矩形大小为 (0,0,0)（与非常相似的 {@link
 * BlockVolume} 对象不同）。
 */
export interface BlockBoundingBox {
    /**
     * @remarks
     * 表示矩形最大角的
     * {@link Vector3}。
     *
     */
    max: Vector3;
    /**
     * @remarks
     * 表示矩形最小角的
     * {@link Vector3}。
     *
     */
    min: Vector3;
}

/**
 * 包含将为方块触发的一组事件。
 * 此对象必须使用 BlockRegistry 绑定。
 */
export interface BlockCustomComponent {
    /**
     * @remarks
     * 此函数将在玩家放置方块之前
     * 调用。
     *
     */
    beforeOnPlayerPlace?: (arg0: BlockComponentPlayerPlaceBeforeEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 当特定方块被破坏时将调用此函数。
     * 时。
     * 方块置换的变化不会触发此事件。
     * 填充命令和 SetBlock 命令仅在破坏模式下
     * 更改方块置换时才能触发此事件。
     * 具有 "minecraft:replaceable" 组件的自定义方块在被替换时不会触发此事件。
     * 具有 "minecraft:replaceable" 组件的自定义方块
     * 在被替换时不会触发此事件。
     *
     */
    onBreak?: (arg0: BlockComponentBlockBreakEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 当实体在世界中
     * 向此方块触发事件时将调用此函数。
     *
     */
    onEntity?: (arg0: BlockComponentEntityEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 当实体落到此自定义组件
     * 所绑定的方块时将调用此函数。
     *
     */
    onEntityFallOn?: (arg0: BlockComponentEntityFallOnEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 当此自定义组件所绑定的
     * 方块被放置时将调用此函数。
     *
     */
    onPlace?: (arg0: BlockComponentOnPlaceEvent, arg1: CustomComponentParameters) => void;
    onPlayerBreak?: (arg0: BlockComponentPlayerBreakEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 当玩家成功与此自定义组件
     * 所绑定的方块交互时将调用此函数。
     * 所绑定的。
     *
     */
    onPlayerInteract?: (arg0: BlockComponentPlayerInteractEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 当方块随机 tick 时将调用此函数。
     *
     */
    onRandomTick?: (arg0: BlockComponentRandomTickEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 如果方块具有 `minecraft:redstone_consumer`
     * 组件且红石信号强度 >= 组件的 `min_power`
     * 字段，则当 'onRedstoneUpdate' 引擎事件
     * 发生时将调用此函数。
     *
     */
    onRedstoneUpdate?: (arg0: BlockComponentRedstoneUpdateEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 当实体离开此自定义组件
     * 所绑定的方块时将调用此函数。
     *
     */
    onStepOff?: (arg0: BlockComponentStepOffEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 当实体踏上此自定义组件
     * 所绑定的方块时将调用此函数。
     *
     */
    onStepOn?: (arg0: BlockComponentStepOnEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 当方块 tick 时将调用此函数。
     *
     */
    onTick?: (arg0: BlockComponentTickEvent, arg1: CustomComponentParameters) => void;
}

/**
 * 包含注册方块事件的可选参数。
 */
export interface BlockEventOptions {
    /**
     * @remarks
     * 如果设置了此值，则仅当受影响的
     * 方块类型与此参数匹配时才会触发此事件。
     *
     */
    blockTypes?: string[];
    /**
     * @remarks
     * 如果设置了此值，则仅当受影响的
     * 方块置换与此参数匹配时才会触发此事件。
     *
     */
    permutations?: BlockPermutation[];
}

/**
 * 包含方块填充操作的附加选项。
 */
export interface BlockFillOptions {
    /**
     * @remarks
     * 指定时，填充操作将包含/排除添加到
     * 方块过滤器中的方块。
     *
     */
    blockFilter?: BlockFilter;
    /**
     * @remarks
     * 如果为 true，fillBlocks 在填充体积的一部分超出
     * 已加载区块边界时将不会报错。而是仅
     * 填充已加载区块边界内的方块
     * 并忽略边界外的方块。
     *
     */
     */
    blockFilter?: BlockFilter;
    /**
     * @remarks
     * 当为 true 时，如果填充体积的部分超出已加载区块边界，
     * fillBlocks 不会报错。
     * 它只会填充已加载区块边界内的方块，
     * 而忽略外部的方块。
     *
     */
    ignoreChunkBoundErrors?: boolean;
}

/**
 * 根据类型、标签或置换来包含或排除方块的选项。
 * 如果未添加任何包含选项，它将选择未被排除选项拒绝的所有方块。
 * 如果至少添加了一个包含选项，方块必须匹配其中一个包含选项才能不被拒绝。
 */
export interface BlockFilter {
    /**
     * @remarks
     * 过滤器应拒绝的方块置换数组，如有任何匹配则拒绝。
     *
     */
    excludePermutations?: BlockPermutation[];
    /**
     * @remarks
     * 过滤器应拒绝的方块标签数组，如有任何匹配则拒绝。
     *
     */
    excludeTags?: string[];
    /**
     * @remarks
     * 过滤器应拒绝的方块类型数组，如有任何匹配则拒绝。
     *
     */
    excludeTypes?: string[];
    /**
     * @remarks
     * 过滤器应选择的方块置换数组，如果至少有一个匹配则选择。
     *
     */
    includePermutations?: BlockPermutation[];
    /**
     * @remarks
     * 过滤器应选择的方块标签数组，如果至少有一个匹配则选择。
     *
     */
    includeTags?: string[];
    /**
     * @remarks
     * 过滤器应选择的方块类型数组，如果至少有一个匹配则选择。
     *
     */
    includeTypes?: string[];
}

/**
 * 包含关于方块被撞击事件的更多信息。
 */
export interface BlockHitInformation {
    /**
     * @remarks
     * 被撞击的方块。
     *
     */
    block: Block;
    /**
     * @remarks
     * 被撞击的方块面。
    *
     *
     */
    face: Direction;
    /**
     * @remarks
      * 相对于方块底部西北角的交互位置
      * 。
     *
     */
    faceLocation: Vector3;
}

/**
 * 包含方块射线投射命中结果的信息。
 */
export interface BlockRaycastHit {
    /**
     * @remarks
     * 被撞击的方块。
     *
     */
    block: Block;
    /**
     * @remarks
     * 被撞击的方块面。
    *
     *
     */
    face: Direction;
    /**
     * @remarks
     * 相对于方块面底部西北角的命中位置。
     *
     */
    faceLocation: Vector3;
}

/**
 * 包含配置方块射线投射查询的附加选项。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export interface BlockRaycastOptions extends BlockFilter {
    /**
     * @remarks
     * 如果为 true，液体方块将被视为会'阻止'射线投射的方块。
     *
     */
    includeLiquidBlocks?: boolean;
    /**
     * @remarks
     * 如果为 true，像藤蔓和花朵这样的可通行方块将被视为会'阻止'射线投射的方块。
     *
     */
    includePassableBlocks?: boolean;
    /**
     * @remarks
     * 处理射线投射的最大距离，以方块为单位。
     *
     */
    maxDistance?: number;
}

/**
 * 用于将相机附加到非玩家实体上。
 */
export interface CameraAttachOptions {
    /**
     * @remarks
     * 设置相机要瞄准的非玩家实体。
     *
     */
    entity: Entity;
    /**
     * @remarks
     * 您要瞄准的实体的位置（例如头部、脚部、眼睛）。
     *
     */
    locator: EntityAttachPoint;
}

/**
 * 用于启动全屏颜色淡入淡出。
 */
export interface CameraFadeOptions {
    /**
     * @remarks
     * 要使用的淡入淡出颜色。
     *
     */
    fadeColor?: RGB;
    /**
     * @remarks
     * 淡入、保持和淡出的时间（以秒为单位）。
     *
     */
    fadeTime?: CameraFadeTimeOptions;
}

/**
 * 包含淡入淡出过渡的时间设置。
 */
export interface CameraFadeTimeOptions {
    /**
     * @remarks
     * 淡入的时间（以秒为单位）。
     *
     */
    fadeInTime: number;
    /**
     * @remarks
     * 淡出的时间（以秒为单位）。
     *
     */
    fadeOutTime: number;
    /**
     * @remarks
     * 保持全屏颜色的时间（以秒为单位）。
     *
     */
    holdTime: number;
}

/**
 * 控制第三人称吊杆预设的枢轴点和偏移的选项。
 */
export interface CameraFixedBoomOptions {
    /**
     * @remarks
     * 将枢轴点更改为距离玩家 <x, y, z> 的位置。
     *
     */
    entityOffset?: Vector3;
    /**
     * @remarks
     * 将相机从中心偏移 <x, y>。
     *
     */
    viewOffset?: Vector2;
}

/**
 * 用于更改当前相机的视野。
 */
export interface CameraFovOptions {
    easeOptions?: EaseOptions;
    /**
     * @remarks
     * 设置视野的值。
     *
     */
    fov?: number;
}

export interface CameraSetFacingOptions {
    easeOptions?: EaseOptions;
    facingEntity: Entity;
    location?: Vector3;
}

export interface CameraSetLocationOptions {
    easeOptions?: EaseOptions;
    location: Vector3;
}

export interface CameraSetPosOptions {
    easeOptions?: EaseOptions;
    facingLocation: Vector3;
    location?: Vector3;
}

export interface CameraSetRotOptions {
    easeOptions?: EaseOptions;
    location?: Vector3;
    rotation: Vector2;
}

/**
 * 用于使用自由相机瞄准实体。
 */
export interface CameraTargetOptions {
    /**
     * @remarks
     * 设置距离目标实体中心的 <x, y, z> 偏移。
     *
     */
    offsetFromTargetCenter?: Vector3;
    /**
     * @remarks
     * 您要瞄准的单个实体。
     *
     */
    targetEntity: Entity;
}

/**
 * 如果在容器操作中违反将抛出错误的规则。
 */
export interface ContainerRules {
    /**
     * @remarks
     * 定义容器中唯一允许的物品。如果为空，则容器中允许所有物品。
     *
     */
    allowedItems: string[];
    /**
     * @remarks
     * 确定是否可以将其他存储物品放入容器中。
     *
     */
    allowNestedStorageItems: boolean;
    /**
     * @remarks
     * 定义容器中不允许的物品。
     *
     */
    bannedItems: string[];
    /**
     * @remarks
     * 定义存储物品容器中所有物品的最大允许总重量。如果未定义，容器没有重量限制。
     *
     */
    weightLimit?: number;
}

/**
 * 定义自定义命令，包括名称、权限和参数。
 */
export interface CustomCommand {
    /**
     * @remarks
     * 必须启用作弊才能运行此命令。默认为 true。
     *
     */
    cheatsRequired?: boolean;
    /**
     * @remarks
     * 在命令行上看到的命令描述。
     *
     */
    description: string;
    /**
     * @remarks
     * 必需的命令参数列表。
     *
     */
    mandatoryParameters?: CustomCommandParameter[];
    /**
     * @remarks
     * 命令的名称。需要命名空间。
     *
     */
    name: string;
    /**
     * @remarks
     * 可选的命令参数列表。
     *
     */
    optionalParameters?: CustomCommandParameter[];
    /**
     * @remarks
     * 执行命令所需的权限级别。
     *
     */
    permissionLevel: CommandPermissionLevel;
}

/**
 * 自定义命令期望的每个参数的定义。
 */
export interface CustomCommandParameter {
    /**
     * @remarks
     * 参数在命令行上显示的名称。
     *
     */
    name: string;
    /**
     * @remarks
     * 参数的数据类型。
     *
     */
    type: CustomCommandParamType;
}

/**
 * 从自定义命令回调函数返回的接口。
 */
export interface CustomCommandResult {
    /**
     * @remarks
     * 命令执行后显示到聊天的消息。
     *
     */
    message?: string;
    /**
     * @remarks
     * 命令执行成功或失败。确定状态消息的显示方式。
     *
     */
    status: CustomCommandStatus;
}

/**
 * 包含对实体组件定义状态的一组更新。
 */
export interface DefinitionModifier {
    /**
     * @remarks
     * 获取将通过此定义修改添加的组件组列表。
     *
     */
    addedComponentGroups: string[];
    /**
     * @remarks
     * 将通过此定义修改移除的组件组列表。
     *
     */
    removedComponentGroups: string[];
}

/**
 * 世界中的精确坐标，包括其维度和位置。
 */
export interface DimensionLocation {
    /**
     * @remarks
     * 此坐标关联的维度。
     *
     */
    dimension: Dimension;
    /**
     * @remarks
     * 此维度位置的 X 分量。
     *
     */
    x: number;
    /**
     * @remarks
     * 此维度位置的 Y 分量。
     *
     */
    y: number;
    /**
     * @remarks
     * 此维度位置的 Z 分量。
     *
     */
    z: number;
}

/**
 * 包含与位置和/或旋转之间的缓动相关的选项。
 */
export interface EaseOptions {
    /**
     * @remarks
     * 缓动操作的时间。
     *
     */
    easeTime?: number;
    /**
     * @remarks
     * 要使用的缓动操作类型。
     *
     */
    easeType?: EasingType;
}

/**
 * 此接口表示应用于物品的特定等级的附魔。
 */
export interface Enchantment {
    /**
     * @remarks
     * 此附魔实例的等级。
     *
     */
    level: number;
    /**
     * @remarks
     * 此实例的附魔类型。
     *
     */
    type: EnchantmentType;
}

/**
 * 通过射弹施加伤害时的附加选项。
 */
export interface EntityApplyDamageByProjectileOptions {
    /**
     * @remarks
     * 发射射弹的可选实体。
     *
     */
    damagingEntity?: Entity;
    /**
     * @remarks
     * 造成伤害的射弹。
     *
     */
    damagingProjectile: Entity;
}

/**
 * 伤害事件的附加描述和元数据。
 */
export interface EntityApplyDamageOptions {
    /**
     * @remarks
     * 伤害的根本原因。
     *
     */
    cause: EntityDamageCause;
    /**
     * @remarks
     * 造成伤害的可选实体。
     *
     */
    damagingEntity?: Entity;
}

/**
 * 提供关于伤害如何施加到实体的信息。
 */
export interface EntityDamageSource {
    /**
     * @remarks
     * 伤害的原因枚举。
     *
     */
    cause: EntityDamageCause;
    /**
     * @remarks
     * 造成伤害的可选实体。
     *
     */
    damagingEntity?: Entity;
    /**
     * @remarks
     * 可能造成伤害的可选射弹。
     *
     */
    damagingProjectile?: Entity;
}

/**
 * 指定用于为实体注册数据驱动触发事件的附加过滤器。
 */
export interface EntityDataDrivenTriggerEventOptions {
    /**
     * @remarks
     * 如果设置了此值，此事件将仅对与此集合中的实体匹配的实体触发。
     *
     */
    entities?: Entity[];
    /**
     * @remarks
     * 如果设置了此值，此事件将仅在受影响实体的类型与此参数匹配时触发。
     *
     */
    entityTypes?: string[];
    /**
     * @remarks
     * 如果设置了此值，此事件将仅在受影响的触发事件与此参数中列出的事件之一匹配时触发。
     *
     */
    eventTypes?: string[];
}

/**
 * 包含实体效果的附加选项。
 */
export interface EntityEffectOptions {
    /**
     * @remarks
     * 效果的强度。
     *
     */
    amplifier?: number;
    /**
     * @remarks
     * 如果为 true，当效果作用于实体时将显示粒子。
     *
     */
    showParticles?: boolean;
}

/**
 * 包含用于注册实体事件的可选参数。
 */
export interface EntityEventOptions {
    /**
     * @remarks
     * 如果设置了此值，此事件将仅对与此集合中的实体匹配的实体触发。
     *
     */
    entities?: Entity[];
    /**
     * @remarks
     * 如果设置了此值，此事件将仅在受影响实体的类型与此参数匹配时触发。
     *
     */
    entityTypes?: string[];
}

/**
 * 包含过滤实体的选项。
 */
export interface EntityFilter {
    /**
     * @remarks
     * 排除与一个或多个指定族匹配的实体。
     *
     */
    excludeFamilies?: string[];
    /**
     * @remarks
     * 如果实体具有与指定游戏模式匹配的游戏模式，则排除这些实体。
     *
     */
    excludeGameModes?: GameMode[];
    /**
     * @remarks
     * 排除名称与指定值之一匹配的实体。
     *
     */
    excludeNames?: string[];
    /**
     * @remarks
     * 排除标签与指定值之一匹配的实体。
     *
     */
    excludeTags?: string[];
    /**
     * @remarks
     * 如果实体是指定类型之一，则排除这些实体。
     *
     */
    excludeTypes?: string[];
    /**
     * @remarks
     * 如果指定，则包括匹配所有指定族的实体。
     *
     */
    families?: string[];
    /**
     * @remarks
     * 如果指定，则包括游戏模式与指定游戏模式匹配的实体。
     *
     */
    gameMode?: GameMode;
    /**
     * @remarks
     * 如果指定，将仅包括水平旋转不超过此值的实体。
     *
     */
    maxHorizontalRotation?: number;
    /**
     * @remarks
     * 如果定义，仅返回等级不超过此值的玩家。
     *
     */
    maxLevel?: number;
    /**
     * @remarks
     * 如果指定，仅返回垂直旋转不超过此值的实体。
     *
     */
    maxVerticalRotation?: number;
    /**
     * @remarks
     * 如果指定，将仅包括水平旋转至少为此值的实体。
     *
     */
    minHorizontalRotation?: number;
    /**
     * @remarks
     * 如果定义，仅返回等级至少为此值的玩家。
     *
     */
    minLevel?: number;
    /**
     * @remarks
     * 如果指定，将仅包括垂直旋转至少为此值的实体。
     *
     */
    minVerticalRotation?: number;
    /**
     * @remarks
     * 包括具有指定名称的实体。
     *
     */
    name?: string;
    propertyOptions?: EntityQueryPropertyOptions[];
    /**
     * @remarks
     * 获取/设置 EntityQueryScoreOptions 对象的集合，用于过滤特定的计分板目标。
     *
     */
    scoreOptions?: EntityQueryScoreOptions[];
    /**
     * @remarks
     * 包括匹配所有指定标签的实体。
     *
     */
    tags?: string[];
    /**
     * @remarks
     * 如果定义，则包括匹配此类型的实体。
     *
     */
    type?: string;
}

/**
 * 包含用于注册实体治疗事件的可选参数。
 */
export interface EntityHealEventOptions {
    /**
     * @remarks
     * 如果设置了此值，此事件将仅在匹配的治疗原因时触发。
     *
     */
    allowedHealCauses?: EntityHealCause[];
    /**
     * @remarks
     * 如果设置了此值，此事件将仅对匹配的实体触发。
     *
     */
    entityFilter?: EntityFilter;
}

/**
 * 包含关于被击中实体的附加信息。
 */
export interface EntityHitInformation {
    /**
     * @remarks
     * 被击中的实体。
     *
     */
    entity?: Entity;
}

/**
 * 包含用于注册实体受伤后事件的可选参数。
 */
export interface EntityHurtAfterEventOptions {
    /**
     * @remarks
     * 如果设置了此值，此事件将仅在匹配的伤害原因时触发。
     *
     */
    allowedDamageCauses?: EntityDamageCause[];
    /**
     * @remarks
     * 如果设置了此值，此事件将仅对与此集合中的实体匹配的实体触发。
     *
     */
    entities?: Entity[];
    /**
     * @remarks
     * 如果设置了此值，此事件将仅对匹配的实体触发。
     *
     */
    entityFilter?: EntityFilter;
    /**
     * @remarks
     * 如果设置了此值，此事件将仅在受影响实体的类型与此参数匹配时触发。
     *
     */
    entityTypes?: string[];
}

/**
 * 包含用于注册实体受伤前事件的可选参数。
 */
export interface EntityHurtBeforeEventOptions {
    /**
     * @remarks
     * 如果设置了此值，此事件将仅在匹配的伤害原因时触发。
     *
     */
    allowedDamageCauses?: EntityDamageCause[];
    /**
     * @remarks
     * 如果设置了此值，此事件将仅对匹配的实体触发。
     *
     */
    entityFilter?: EntityFilter;
}

/**
 * 传递给 {@link
 * @minecraft/Server.EntityItemDropAfterEventSignal.subscribe}
 * 的接口，用于过滤哪些事件传递给提供的回调函数。
 */
export interface EntityItemDropEventOptions {
    /**
     * @remarks
     * 如果设置了此值，此事件将仅对匹配的实体触发。
     *
     */
    entityFilter?: EntityFilter;
    /**
     * @remarks
     * 如果设置了此值，此事件将仅在事件中的物品匹配时触发。
     *
     */
    itemFilter?: ItemFilter;
}

/**
 * 传递给 {@link
 * @minecraft/Server.EntityItemPickupAfterEventSignal.subscribe}
 * 和 {@link
 * @minecraft/Server.EntityItemPickupBeforeEventSignal.subscribe}
 * 的接口，用于过滤哪些事件传递给提供的回调函数。
 */
export interface EntityItemPickupEventOptions {
    /**
     * @remarks
     * 如果设置了此值，此事件将仅对匹配的实体触发。
     *
     */
    entityFilter?: EntityFilter;
    /**
     * @remarks
     * 如果设置了此值，此事件将仅在事件中的物品匹配时触发。
     *
     */
    itemFilter?: ItemFilter;
}

/**
 * 包含在区域中选择实体的选项。
 * @example blockConditional.ts
 * ```typescript
 * import { DimensionLocation } from "@minecraft/server";
 *
 * function blockConditional(targetLocation: DimensionLocation) {
 *   targetLocation.dimension
 *     .getEntities({
 *       type: "fox",
 *     })
 *     .filter((entity) => {
 *       const block = targetLocation.dimension.getBlock({
 *         x: entity.x,
 *         y: entity.y - 1,
 *         z: entity.z,
 *       });
 *
 *       return block !== undefined && block.matches("minecraft:stone");
 *     })
 *     .forEach((entity) => {
 *       targetLocation.dimension.spawnEntity("salmon", entity.location);
 *     });
 * }
 * ```
 * @example findEntitiesHavingPropertyEqualsTo.ts
 * ```typescript
 * import { EntityQueryOptions, DimensionLocation } from "@minecraft/server";
 *
 * function findEntitiesHavingPropertyEqualsTo(
 *     targetLocation: DimensionLocation
 * ) {
 *   // Minecraft bees have a has_nectar boolean property
 *   const queryOption: EntityQueryOptions = {
 *     propertyOptions: [{ propertyId: "minecraft:has_nectar", value: { equals: true } }],
 *   };
 *
 *   const entities = targetLocation.dimension.getEntities(queryOption);
 * }
 * ```
 * @example playSoundChained.ts
 * ```typescript
 * import { DimensionLocation } from "@minecraft/server";
 *
 * function playSoundChained(targetLocation: DimensionLocation) {
 *   const targetPlayers = targetLocation.dimension.getPlayers();
 *   const originEntities = targetLocation.dimension.getEntities({
 *     type: "armor_stand",
 *     name: "myArmorStand",
 *     tags: ["dummyTag1"],
 *     excludeTags: ["dummyTag2"],
 *   });
 *
 *   originEntities.forEach((entity) => {
 *     targetPlayers.forEach((player) => {
 *       player.playSound("raid.horn");
 *     });
 *   });
 * }
 * ```
 * @example setScoreboardChained.ts
 * ```typescript
 * import { world, DimensionLocation } from "@minecraft/server";
 *
 * function setScoreboardChained(
 *     targetLocation: DimensionLocation
 * ) {
 *   const objective = world.scoreboard.addObjective("scoreObjective1", "dummy");
 *   targetLocation.dimension
 *     .getEntities({
 *       type: "armor_stand",
 *       name: "myArmorStand",
 *     })
 *     .forEach((entity) => {
 *       if (entity.scoreboardIdentity !== undefined) {
 *         objective.setScore(entity.scoreboardIdentity, -1);
 *       }
 *     });
 * }
 * ```
 * @example summonMobChained.ts
 * ```typescript
 * import { DimensionLocation } from "@minecraft/server";
 *
 * function summonMobChained(targetLocation: DimensionLocation) {
 *   const armorStandArray = targetLocation.dimension.getEntities({
 *     type: "armor_stand",
 *   });
 *   const playerArray = targetLocation.dimension.getPlayers({
 *     location: { x: 0, y: -60, z: 0 },
 *     closest: 4,
 *     maxDistance: 15,
 *   });
 *   armorStandArray.forEach((entity) => {
 *     playerArray.forEach((player) => {
 *       targetLocation.dimension.spawnEntity("pig", {
 *         x: player.x + 1,
 *         y: player.y,
 *         z: player.z,
 *       });
 *     });
 *   });
 * }
 * ```
 * @example bounceSkeletons.ts
 * ```typescript
 * import { EntityQueryOptions, DimensionLocation } from "@minecraft/server";
 *
 * function bounceSkeletons(targetLocation: DimensionLocation) {
 *   const mobs = ["creeper", "skeleton", "sheep"];
 *
 * // 创建一些示例生物数据 for (let i = 0;
 *
 * i < 10; i++) { targetLocation.dimension.spawnEntity(mobs[i %
 *
 * mobs.length], targetLocation); }
 *
 *
 *
 *
 *   const eqo: EntityQueryOptions = {
 *     type: "skeleton",
 *   };
 *
 *   for (const entity of targetLocation.dimension.getEntities(eqo)) {
 *     entity.applyKnockback(0, 0, 0, 1);
 *   }
 * }
 * ```
 * @example tagsQuery.ts
 * ```typescript
 * import { EntityQueryOptions, DimensionLocation } from "@minecraft/server";
 *
 * function tagsQuery(targetLocation: DimensionLocation) {
 *   const mobs = ["creeper", "skeleton", "sheep"];
 *
 * // 创建一些示例生物数据 for (let i = 0; i <
 *
 * 10; i++) { const mobTypeId = mobs[i % mobs.length]; const entity = ta
 *
 * rgetLocation.dimension.spawnEntity(mobTypeId, targetLocation); entity.addTag("mobparty." + mobTypeId);
 *
 * }
 *
 *
 *
 *
 *
 *
 *   const eqo: EntityQueryOptions = {
 *     tags: ["mobparty.skeleton"],
 *   };
 *
 *   for (const entity of targetLocation.dimension.getEntities(eqo)) {
 *     entity.kill();
 *   }
 * }
 * ```
 * @example testThatEntityIsFeatherItem.ts
 * ```typescript
 * import { EntityItemComponent, EntityComponentTypes, DimensionLocation } from "@minecraft/server";
 *
 * function testThatEntityIsFeatherItem(
 *   log: (message: string, status?: number) => void,
 *   targetLocation: DimensionLocation
 * ) {
 *   const items = targetLocation.dimension.getEntities({
 *     location: targetLocation,
 *     maxDistance: 20,
 *   });
 *
 *   for (const item of items) {
 *     const itemComp = item.getComponent(EntityComponentTypes.Item) as EntityItemComponent;
 *
 *     if (itemComp) {
 *       if (itemComp.itemStack.typeId.endsWith("feather")) {
 *         log("Success! Found a feather", 1);
 *       }
 *     }
 *   }
 * }
 * ```
 */
// @ts-ignore Class inheritance allowed for native defined classes
export interface EntityQueryOptions extends EntityFilter {
    /**
     * @remarks
     * 限制返回的实体数量，选择此属性指定的最近 N 个实体。
     * 还必须在查询选项对象上指定 location 值。
     *
     */
    closest?: number;
    /**
     * @remarks
     * 限制返回的实体数量，选择此属性指定的最远 N 个实体。
     * 还必须在查询选项对象上指定 location 值。
     *
     */
    farthest?: number;
    /**
     * @remarks
     * 向查询添加种子位置，与 closest、farthest、limit、volume 和 distance 属性配合使用。
     *
     */
    location?: Vector3;
    /**
     * @remarks
     * 如果指定，则包括距离 location 属性指定位置小于此距离的实体。
     *
     */
    maxDistance?: number;
    /**
     * @remarks
     * 如果指定，则包括距离 location 属性指定位置至少为此距离的实体。
     *
     */
    minDistance?: number;
    /**
     * @remarks
     * 与 location 结合使用，指定要包含的实体的长方体体积。
     *
     */
    volume?: Vector3;
}

export interface EntityQueryPropertyOptions {
    exclude?: boolean;
    propertyId: string;
    value?:
        | boolean
        | string
        | EqualsComparison
        | GreaterThanComparison
        | GreaterThanOrEqualsComparison
        | LessThanComparison
        | LessThanOrEqualsComparison
        | NotEqualsComparison
        | RangeComparison;
}

/**
 * 包含基于玩家对某个目标的分数进行过滤的附加选项。
 */
export interface EntityQueryScoreOptions {
    /**
     * @remarks
     * 如果设置为 true，则此分数范围内的实体和玩家将从查询结果中排除。
     *
     */
    exclude?: boolean;
    /**
     * @remarks
     * 如果定义，仅包括分数等于或低于 maxScore 的玩家。
     *
     */
    maxScore?: number;
    /**
     * @remarks
     * 如果定义，仅包括分数等于或高于 minScore 的玩家。
     *
     */
    minScore?: number;
    /**
     * @remarks
     * 要过滤的计分板目标的标识符。
     *
     */
    objective?: string;
}

/**
 * 包含实体射线投射命中结果的信息。
 */
export interface EntityRaycastHit {
    /**
     * @remarks
     * 从射线原点到实体边界的距离。
     *
     */
    distance: number;
    /**
     * @remarks
     * 被击中的实体。
     *
     */
    entity: Entity;
}

/**
 * 包含实体射线投射操作的附加选项。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export interface EntityRaycastOptions extends EntityFilter {
    /**
     * @remarks
     * 如果为 true，方块将不被视为会'阻止'射线投射的方块。
     *
     */
    ignoreBlockCollision?: boolean;
    /**
     * @remarks
     * 如果为 true，液体方块将被视为会'阻止'射线投射的方块。
     *
     */
    includeLiquidBlocks?: boolean;
    /**
     * @remarks
     * 如果为 true，像藤蔓和花朵这样的可通行方块将被视为会'阻止'射线投射的方块。
     *
     */
    includePassableBlocks?: boolean;
    /**
     * @remarks
     * 处理射线投射的最大距离，以方块为单位。
     *
     */
    maxDistance?: number;
}

/**
 * 等于运算符。
 */
export interface EqualsComparison {
    /**
     * @remarks
     * 进行比较的阈值。
     *
     */
    equals: boolean | number | string;
}

/**
 * {@link Dimension.createExplosion} 方法的附加配置选项。
 * @example createNoBlockExplosion.ts
 * ```typescript
 * import { DimensionLocation } from "@minecraft/server";
 * import { Vector3Utils } from "@minecraft/math";
 *
 * function createNoBlockExplosion(
 *   log: (message: string, status?: number) => void,
 *   targetLocation: DimensionLocation
 * ) {
 *   const explodeNoBlocksLoc = Vector3Utils.floor(Vector3Utils.add(targetLocation, { x: 1, y: 2, z: 1 }));
 *
 *   log("Creating an explosion of radius 15 that does not break blocks.");
 *   targetLocation.dimension.createExplosion(explodeNoBlocksLoc, 15, { breaksBlocks: false });
 * }
 * ```
 * @example createExplosions.ts
 * ```typescript
 * import { DimensionLocation } from "@minecraft/server";
 * import { Vector3Utils } from "@minecraft/math";
 *
 * function createExplosions(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const explosionLoc = Vector3Utils.add(targetLocation, { x: 0.5, y: 0.5, z: 0.5 });
 *
 *   log("Creating an explosion of radius 15 that causes fire.");
 *   targetLocation.dimension.createExplosion(explosionLoc, 15, { causesFire: true });
 *
 *   const belowWaterLoc = Vector3Utils.add(targetLocation, { x: 3, y: 1, z: 3 });
 *
 *   log("Creating an explosion of radius 10 that can go underwater.");
 *   targetLocation.dimension.createExplosion(belowWaterLoc, 10, { allowUnderwater: true });
 * }
 * ```
 */
export interface ExplosionOptions {
    /**
     * @remarks
     * 爆炸的部分是否也影响水下。
     *
     */
    allowUnderwater?: boolean;
    /**
     * @remarks
     * 爆炸是否会破坏爆炸半径内的方块。
     *
     */
    breaksBlocks?: boolean;
    /**
     * @remarks
     * 如果为 true，爆炸会在爆炸半径内或附近产生火焰。
     *
     */
    causesFire?: boolean;
    /**
     * @remarks
     * 爆炸的可选来源。
     *
     */
    source?: Entity;
}

/**
 * 包含 getBlockStandingOn 和 getAllBlocksStandingOn 的附加选项。
 */
export interface GetBlocksStandingOnOptions {
    /**
     * @remarks
     * 当指定时，函数将根据方块过滤器包含/排除返回的方块。
     *
     */
    blockFilter?: BlockFilter;
    /**
     * @remarks
     * 如果为 true，所有高度为 0.2 或更低的方块（如活板门和地毯）将被忽略，并返回下方的方块。
     *
     */
    ignoreThinBlocks?: boolean;
}

/**
 * 大于运算符。
 */
export interface GreaterThanComparison {
    /**
     * @remarks
     * 进行比较的阈值。
     *
     */
    greaterThan: number;
}

/**
 * 大于或等于运算符。
 */
export interface GreaterThanOrEqualsComparison {
    /**
     * @remarks
     * 进行比较的阈值。
     *
     */
    greaterThanOrEquals: number;
}

/**
 * 包含快捷栏事件的附加过滤选项。
 */
export interface HotbarEventOptions {
    /**
     * @remarks
     * 要考虑的槽位索引。值应在 0 到 8 之间（含）。
     * 如果未指定，则考虑所有槽位。
     *
     * Bounds: [0, 8]
     */
    allowedSlots?: number[];
}

/**
 * 传递给 {@link
 * @minecraft/Server.PlayerButtonInputAfterEventSignal.subscribe}
 * 的接口，用于过滤哪些事件传递给提供的回调函数。
 */
export interface InputEventOptions {
    /**
     * @remarks
     * 回调函数应处理的按钮。如果未定义，回调函数将处理所有按钮。
     *
     */
    buttons?: InputButton[];
    /**
     * @remarks
     * 回调函数应处理的状态。如果未定义，回调函数将处理所有按钮状态。
     *
     */
    state?: ButtonState;
}

/**
 * 包含库存物品事件的附加过滤选项。
 */
export interface InventoryItemEventOptions {
    /**
     * @remarks
     * 要考虑的槽位索引。值应为正数。
     * 如果未指定，则考虑所有槽位。
     *
     * Bounds: [0, 1000]
     */
    allowedSlots?: number[];
    /**
     * @remarks
     * 要排除的物品名称。
     *
     */
    excludeItems?: string[];
    /**
     * @remarks
     * 要排除的物品标签。
     *
     */
    excludeTags?: string[];
    /**
     * @remarks
     * 指定仅忽略数量变化的标志。为 true 时忽略数量变化，为 false 时不忽略数量变化。
     *
     */
    ignoreQuantityChange?: boolean;
    /**
     * @remarks
     * 要考虑的物品名称。
     *
     */
    includeItems?: string[];
    /**
     * @remarks
     * 要考虑的物品标签。
     *
     */
    includeTags?: string[];
    /**
     * @remarks
     * 要考虑的玩家库存类型。
     *
     */
    inventoryType?: PlayerInventoryType;
}

/**
 * 包含将为物品触发的一组事件。此对象必须使用 ItemComponentRegistry 绑定。
 */
export interface ItemCustomComponent {
    /**
     * @remarks
     * 当包含此组件的物品正在击打实体且即将受到耐久度伤害时，将调用此函数。
     *
     */
    onBeforeDurabilityDamage?: (
        arg0: ItemComponentBeforeDurabilityDamageEvent,
        arg1: CustomComponentParameters,
    ) => void;
    /**
     * @remarks
     * 当包含此组件的物品的使用持续时间完成时，将调用此函数。
     *
     */
    onCompleteUse?: (arg0: ItemComponentCompleteUseEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 当包含此组件的物品被实体食用时，将调用此函数。
     *
     */
    onConsume?: (arg0: ItemComponentConsumeEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 当包含此组件的物品用于击打另一个实体时，将调用此函数。
     *
     */
    onHitEntity?: (arg0: ItemComponentHitEntityEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 当包含此组件的物品用于挖掘方块时，将调用此函数。
     *
     */
    onMineBlock?: (arg0: ItemComponentMineBlockEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 当包含此组件的物品被玩家使用时，将调用此函数。
     *
     */
    onUse?: (arg0: ItemComponentUseEvent, arg1: CustomComponentParameters) => void;
    /**
     * @remarks
     * 当包含此组件的物品在方块上使用时，将调用此函数。
     *
     */
    onUseOn?: (arg0: ItemComponentUseOnEvent, arg1: CustomComponentParameters) => void;
}

/**
 * 包含过滤物品的选项。
 */
export interface ItemFilter {
    /**
     * @remarks
     * 如果定义，则包括匹配这些类型的物品。
     *
     */
    includeTypes?: (ItemType | string)[];
}

/**
 * 为 {@link StructureManager.placeJigsaw} 提供附加选项。
 */
export interface JigsawPlaceOptions {
    /**
     * @remarks
     * 结构中是否应包括实体。默认为 true。
     *
     */
    includeEntities?: boolean;
    /**
     * @remarks
     * 生成结构时是否保留拼图方块。默认为 false。
     *
     */
    keepJigsaws?: boolean;
    /**
     * @remarks
     * 指定如何处理与现有液体重叠的可含水方块。
     * 默认值为 `ApplyWaterlogging`。
     *
     */
    liquidSettings?: LiquidSettings;
}

/**
 * 为 {@link StructureManager.placeJigsawStructure} 提供附加选项。
 */
export interface JigsawStructurePlaceOptions {
    /**
     * @remarks
     * 是否应忽略拼图结构定义中定义的起始高度，并使用指定的 y 坐标覆盖。默认为 false。
     *
     */
    ignoreStartHeight?: boolean;
    /**
     * @remarks
     * 结构中是否应包括实体。默认为 true。
     *
     */
    includeEntities?: boolean;
    /**
     * @remarks
     * 生成结构时是否保留拼图方块。默认为 false。
     *
     */
    keepJigsaws?: boolean;
    /**
     * @remarks
     * 指定如何处理与现有液体重叠的可含水方块。
     * 默认值为 `ApplyWaterlogging`。
     *
     */
    liquidSettings?: LiquidSettings;
}

/**
 * 小于运算符。
 */
export interface LessThanComparison {
    /**
     * @remarks
     * 进行比较的阈值。
     *
     */
    lessThan: number;
}

/**
 * 小于或等于运算符。
 */
export interface LessThanOrEqualsComparison {
    /**
     * @remarks
     * 进行比较的阈值。
     *
     */
    lessThanOrEquals: number;
}

/**
 * {@link World.playMusic}/{@link World.queueMusic} 方法的附加配置选项。
 */
export interface MusicOptions {
    /**
     * @remarks
     * 指定播放结束时的音乐淡出重叠。
     *
     */
    fade?: number;
    /**
     * @remarks
     * 如果设置为 true，此音乐曲目将重复播放。
     *
     */
    loop?: boolean;
    /**
     * @remarks
     * 音乐的相对音量级别。
     *
     */
    volume?: number;
}

/**
 * 不等于运算符。
 */
export interface NotEqualsComparison {
    /**
     * @remarks
     * 进行比较的阈值。
     *
     */
    notEquals: boolean | number | string;
}

/**
 * 包含动画播放方式的附加选项。
 */
export interface PlayAnimationOptions {
    /**
     * @remarks
     * 动画停止后的淡出时间量。
     *
     */
    blendOutTime?: number;
    /**
     * @remarks
     * 指定在实体上定义的要使用的控制器。
     *
     */
    controller?: string;
    /**
     * @remarks
     * 指定要过渡到的状态。
     *
     */
    nextState?: string;
    /**
     * @remarks
     * 动画对其可见的玩家列表。
     *
     */
    players?: Player[];
    /**
     * @remarks
     * 指定此动画何时完成的 Molang 表达式。
     *
     */
    stopExpression?: string;
}

/**
 * 玩家声音播放方式的附加选项。
 */
export interface PlayerSoundOptions {
    /**
     * @remarks
     * 声音的位置；如果未指定，则在玩家附近播放声音。
     *
     */
    location?: Vector3;
    /**
     * @remarks
     * 可选的音调。
     *
     */
    pitch?: number;
    /**
     * @remarks
     * 可选的音量。
     *
     */
    volume?: number;
}

/**
 * 传递给 {@link
 * @minecraft/Server.PlayerSwingStartAfterEvent.subscribe} 的接口，
 * 用于过滤哪些事件传递给提供的回调函数。
 */
export interface PlayerSwingEventOptions {
    /**
     * @remarks
     * 回调函数应处理的手持物品选项。如果未定义，无论玩家手中是否持有物品，回调函数都将被调用。
     *
     */
    heldItemOption?: HeldItemOption;
    /**
     * @remarks
     * 回调函数应处理的 {@link EntitySwingSource}。如果未定义，回调函数将处理所有挥动源。
     *
     */
    swingSource?: EntitySwingSource;
}

/**
 * 保存相机动画进度的关键帧。
 */
export interface ProgressKeyFrame {
    /**
     * @remarks
     * 表示相机沿曲线前进程度的值。值为 [0.0, 1.0]（含）。
     *
     */
    alpha: number;
    /**
     * @remarks
     * 帧用于位置的缓动类型（可选）。
     *
     */
    easingFunc?: EasingType;
    /**
     * @remarks
     * 相机处于给定 alpha 值的时间。
     *
     */
    timeSeconds: number;
}

/**
 * @minecraft/server.EntityProjectileComponent.shoot 的可选参数。
 */
export interface ProjectileShootOptions {
    /**
     * @remarks
     * 控制射击的精度。值为 0 表示完美精度。
     *
     */
    uncertainty?: number;
}

/**
 * 运算符表示用于表达可能数字范围的上下界结构。
 */
export interface RangeComparison {
    /**
     * @remarks
     * 范围内的下界。
     *
     */
    lowerBound: number;
    /**
     * @remarks
     * 范围内的上界。
     *
     */
    upperBound: number;
}

/**
 * 定义用于更灵活的 JSON 结构。
 * @example addTranslatedSign.ts
 * ```typescript
 * import { DimensionLocation, world, BlockPermutation, BlockComponentTypes } from '@minecraft/server';
 *
 * function placeTranslatedSign(location: DimensionLocation, text: string) {
 *     const signBlock = dimension.getBlock(location);
 *
 *     if (!signBlock) {
 *         console.warn('Could not find a block at specified ');
 *         return;
 *     }
 *     const signPerm = BlockPermutation.resolve('minecraft:standing_sign', { ground_sign_direction: 8 });
 *     signBlock.setPermutation(signPerm);
 *
 *     const signComponent = signBlock.getComponent(BlockComponentTypes.Sign);
 *     if (signComponent) {
 *         signComponent.setText({ translate: 'item.skull.player.name', with: [text] });
 *     } else {
 *         console.error('Could not find a sign component on the block.');
 *     }
 * }
 *
 * placeTranslatedSign(
 *     {
 *         dimension: world.getDimension('overworld'),
 *         x: 0,
 *         y: 0,
 *         z: 0,
 *     },
 *     'Steve',
 * );
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
 *       // player canceled the form, or another dialog was up and open.
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
 * @example addTranslatedSign.ts
 * ```typescript
 * import { world, BlockPermutation, BlockSignComponent, BlockComponentTypes, DimensionLocation } from "@minecraft/server";
 * import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
 *
 * function addTranslatedSign(log: (message: string, status?: number) => void, targetLocation: DimensionLocation) {
 *   const players = world.getPlayers();
 *
 *   const dim = players[0].dimension;
 *
 *   const signBlock = dim.getBlock(targetLocation);
 *
 *   if (!signBlock) {
 *     log("Could not find a block at specified ");
 *     return -1;
 *   }
 *   const signPerm = BlockPermutation.resolve(MinecraftBlockTypes.StandingSign, { ground_sign_direction: 8 });
 *
 *   signBlock.setPermutation(signPerm);
 *
 *   const signComponent = signBlock.getComponent(BlockComponentTypes.Sign) as BlockSignComponent;
 *
 *   signComponent?.setText({ translate: "item.skull.player.name", with: [players[0].name] });
 * }
 * ```
 */
export interface RawMessage {
    /**
     * @remarks
     * 提供当前消息的原始文本等效项。
     *
     */
    rawtext?: RawMessage[];
    /**
     * @remarks
     * 提供一个标记，将替换为分数的值。
     *
     */
    score?: RawMessageScore;
    /**
     * @remarks
     * 提供要使用的字符串字面量值。
     *
     */
    text?: string;
    /**
     * @remarks
     * 提供一个翻译标记，如果客户端有与标记匹配的玩家语言可用资源，将在客户端进行翻译。
     *
     */
    translate?: string;
    /**
     * @remarks
     * 翻译标记的参数。可以是字符串数组或包含原始文本对象数组的 RawMessage。
     *
     */
    with?: string[] | RawMessage;
}

/**
 * 提供在原始消息中使用的分数标记的描述。
 */
export interface RawMessageScore {
    /**
     * @remarks
     * 要匹配的分数值的名称。
     *
     */
    name?: string;
    /**
     * @remarks
     * 要匹配的分数值的名称。
     *
     */
    objective?: string;
}

/**
 * 仅包含 `rawtext` 属性的 `RawMessage`。当序列化 `RawMessage` 时，
 * 内容会被放入 rawtext 属性中，因此在读取已保存的 RawMessage 时很有用。
 * 参见 `BlockSignComponent.setText` 和 `BlockSignComponent.getRawText` 示例。
 */
export interface RawText {
    /**
     * @remarks
     * 关联告示牌当前值的序列化。
     *
     */
    rawtext?: RawMessage[];
}

/**
 * 表示 Minecraft 中完全可自定义的颜色。
 */
export interface RGB {
    /**
     * @remarks
     * 确定颜色的蓝色分量。有效值在 0 到 1.0 之间。
     *
     */
    blue: number;
    /**
     * @remarks
     * 确定颜色的绿色分量。有效值在 0 到 1.0 之间。
     *
     */
    green: number;
    /**
     * @remarks
     * 确定颜色的红色分量。有效值在 0 到 1.0 之间。
     *
     */
    red: number;
}

/**
 * 表示 Minecraft 中完全可自定义的颜色。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export interface RGBA extends RGB {
    /**
     * @remarks
     * 确定颜色的 alpha（不透明度）分量。有效值在 0（透明）到 1.0（不透明）之间。
     *
     */
    alpha: number;
}

/**
 * 保存相机动画旋转的关键帧。
 */
export interface RotationKeyFrame {
    /**
     * @remarks
     * 帧用于旋转的缓动类型（可选）。
     *
     */
    easingFunc?: EasingType;
    /**
     * @remarks
     * 相机旋转的值。
     *
     */
    rotation: Vector3;
    /**
     * @remarks
     * 相机处于给定旋转值的时间。
     *
     */
    timeSeconds: number;
}

/**
 * 包含计分板在其显示槽中显示方式的附加选项。
 */
export interface ScoreboardObjectiveDisplayOptions {
    /**
     * @remarks
     * 要显示的目标。
     *
     */
    objective: ScoreboardObjective;
    /**
     * @remarks
     * 显示目标项时的排序顺序。
     *
     */
    sortOrder?: ObjectiveSortOrder;
}

/**
 * 包含注册脚本事件回调的附加选项。
 */
export interface ScriptEventMessageFilterOptions {
    /**
     * @remarks
     * 用于过滤入站脚本事件消息的可选命名空间列表。
     *
     */
    namespaces: string[];
}

/**
 * 包含生成实体的附加选项。
 */
export interface SpawnEntityOptions {
    /**
     * @remarks
     * 可选的布尔值，确定此实体是否应在游戏世界中持久存在。持久化可防止实体自动消失。
     *
     */
    initialPersistence?: boolean;
    /**
     * @remarks
     * 可选的初始旋转角度（以度为单位），在实体生成时设置。
     *
     */
    initialRotation?: number;
    /**
     * @remarks
     * 可选的生成事件，在实体生成后发送给它。
     *
     */
    spawnEvent?: string;
}

/**
 * 相机动画的关键帧集合。
 */
export interface SplineAnimation {
    /**
     * @remarks
     * 相机沿给定曲线前进的关键帧。
     *
     */
    progressKeyFrames: ProgressKeyFrame[];
    /**
     * @remarks
     * 相机旋转的关键帧。
     *
     */
    rotationKeyFrames: RotationKeyFrame[];
}

/**
 * 为 {@link StructureManager.createFromWorld} 提供附加选项。
 */
export interface StructureCreateOptions {
    /**
     * @remarks
     * 结构中是否应包括方块。默认为 true。
     *
     */
    includeBlocks?: boolean;
    /**
     * @remarks
     * 结构中是否应包括实体。默认为 true。
     *
     */
    includeEntities?: boolean;
    /**
     * @remarks
     * 结构的保存方式。默认为 StructureSaveMode.World。
     *
     */
    saveMode?: StructureSaveMode;
}

/**
 * 为 {@link StructureManager.place} 提供附加选项。
 */
export interface StructurePlaceOptions {
    /**
     * @remarks
     * 放置结构时的动画方式。
     *
     */
    animationMode?: StructureAnimationMode;
    /**
     * @remarks
     * 动画所需的秒数。
     *
     */
    animationSeconds?: number;
    /**
     * @remarks
     * 结构中是否应包括方块。默认为 true。
     *
     */
    includeBlocks?: boolean;
    /**
     * @remarks
     * 结构中是否应包括实体。默认为 true。
     *
     */
    includeEntities?: boolean;
    /**
     * @remarks
     * 应放置的方块百分比。值为 1 将放置 100% 的方块，而值为 0 则不放置任何方块。
     * 方块根据 {@link StructurePlaceOptions.integritySeed} 随机选择。
     *
     */
    integrity?: number;
    /**
     * @remarks
     * 确定随机选择哪些方块进行放置的种子。默认为随机种子。
     *
     */
    integritySeed?: string;
    /**
     * @remarks
     * 放置结构时应镜像的轴。默认为 StructureMirrorAxis.None。
     *
     */
    mirror?: StructureMirrorAxis;
    /**
     * @remarks
     * 放置结构时的旋转方式。默认为 AxisAlignedRotation.None。
     *
     */
    rotation?: StructureRotation;
    /**
     * @remarks
     * 放置结构时是否应含水。默认为 false。如果为 true，放入水中时方块将变为含水状态。
     *
     */
    waterlogged?: boolean;
}

/**
 * 包含传送实体的附加选项。
 * @example teleport.ts
 * ```typescript
 * import { system, DimensionLocation } from "@minecraft/server";
 * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
 *
 * function teleport(targetLocation: DimensionLocation) {
 *   const cow = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Cow, targetLocation);
 *
 *   system.runTimeout(() => {
 *     cow.teleport(
 *       { x: targetLocation.x + 2, y: targetLocation.y + 2, z: targetLocation.z + 2 },
 *       {
 *         facingLocation: targetLocation,
 *       }
 *     );
 *   }, 20);
 * }
 * ```
 * @example teleportMovement.ts
 * ```typescript
 * import { system, DimensionLocation } from "@minecraft/server";
 * import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
 *
 * function teleportMovement(targetLocation: DimensionLocation) {
 *   const pig = targetLocation.dimension.spawnEntity(MinecraftEntityTypes.Pig, targetLocation);
 *
 *   let inc = 1;
 *   const runId = system.runInterval(() => {
 *     pig.teleport(
 *       { x: targetLocation.x + inc / 4, y: targetLocation.y + inc / 4, z: targetLocation.z + inc / 4 },
 *       {
 *         facingLocation: targetLocation,
 *       }
 *     );
 *
 *     if (inc > 100) {
 *       system.clearRun(runId);
 *     }
 *     inc++;
 *   }, 4);
 * }
 * ```
 */
export interface TeleportOptions {
    /**
     * @remarks
     * 是否检查传送后方块是否会阻挡实体。
     *
     */
    checkForBlocks?: boolean;
    /**
     * @remarks
     * 可能将实体移动到的维度。如果未指定，实体将在其所在维度内传送。
     *
     */
    dimension?: Dimension;
    /**
     * @remarks
     * 传送后实体应面对的位置。
     *
     */
    facingLocation?: Vector3;
    /**
     * @remarks
     * 传送后是否保留实体的速度。
     *
     */
    keepVelocity?: boolean;
    /**
     * @remarks
     * 传送后实体的旋转。
     *
     */
    rotation?: Vector2;
}

/**
 * 提供关于特定常加载区域信息的上下文。
 */
export interface TickingArea {
    /**
     * @remarks
     * 包含常加载区域中所有常加载方块的边界框。
     *
     */
    boundingBox: BlockBoundingBox;
    /**
     * @remarks
     * 常加载区域包含的区块数量。
     *
     */
    chunkCount: number;
    /**
     * @remarks
     * 常加载区域所在的维度。
     *
     */
    dimension: Dimension;
    /**
     * @remarks
     * 常加载区域的唯一标识符。
     *
     */
    identifier: string;
    /**
     * @remarks
     * 如果常加载区域的所有区块都已加载用于常加载，则为 true，否则为 false。
     *
     */
    isFullyLoaded: boolean;
}

/**
 * 使用 {@link TickingAreaManager} 创建常加载区域的选项。
 */
export interface TickingAreaOptions {
    /**
     * @remarks
     * 常加载区域将所在的维度。
     *
     */
    dimension: Dimension;
    /**
     * @remarks
     * 边界框的角落方块位置。
     *
     */
    from: Vector3;
    /**
     * @remarks
     * 边界框的相对角落方块位置。
     *
     */
    to: Vector3;
}

/**
 * 包含显示标题和可选副标题的附加选项。
 */
export interface TitleDisplayOptions {
    /**
     * @remarks
     * 标题和副标题的淡入持续时间，以刻为单位。每秒 20 刻。
     * 使用 {@link TicksPerSecond} 常量在刻和秒之间转换。
     *
     */
    fadeInDuration: number;
    /**
     * @remarks
     * 标题和副标题的淡出时间，以刻为单位。每秒 20 刻。
     * 使用 {@link TicksPerSecond} 常量在刻和秒之间转换。
     *
     */
    fadeOutDuration: number;
    /**
     * @remarks
     * 标题和副标题的停留时间，以刻为单位。每秒 20 刻。
     * 使用 {@link TicksPerSecond} 常量在刻和秒之间转换。
     *
     */
    stayDuration: number;
    /**
     * @remarks
     * 可选的副标题文本。
     *
     */
    subtitle?: (RawMessage | string)[] | RawMessage | string;
}

/**
 * 表示二维向量。
 */
export interface Vector2 {
    /**
     * @remarks
     * 二维向量的 X 分量。
     *
     */
    x: number;
    /**
     * @remarks
     * 二维向量的 Y 分量。
     *
     */
    y: number;
}

/**
 * 包含向量的描述。
 */
export interface Vector3 {
    /**
     * @remarks
     * 此向量的 X 分量。
     *
     */
    x: number;
    /**
     * @remarks
     * 此向量的 Y 分量。
     *
     */
    y: number;
    /**
     * @remarks
     * 此向量的 Z 分量。
     *
     */
    z: number;
}

export interface VectorXZ {
    x: number;
    z: number;
}

/**
 * 包含 playSound 事件的附加选项。
 */
export interface WorldSoundOptions {
    /**
     * @remarks
     * 播放声音的音调。
     *
     */
    pitch?: number;
    /**
     * @remarks
     * 听到此声音的相对音量和空间。
     *
     */
    volume?: number;
}

// @ts-ignore Class inheritance allowed for native defined classes
export class BlockCustomComponentAlreadyRegisteredError extends Error {
    private constructor();
}

// @ts-ignore Class inheritance allowed for native defined classes
export class BlockCustomComponentReloadNewComponentError extends Error {
    private constructor();
}

// @ts-ignore Class inheritance allowed for native defined classes
export class BlockCustomComponentReloadNewEventError extends Error {
    private constructor();
}

// @ts-ignore Class inheritance allowed for native defined classes
export class BlockCustomComponentReloadVersionError extends Error {
    private constructor();
}

/**
 * 使用 {@link ItemBookComponent} 时可能抛出的错误原因枚举。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BookError extends Error {
    private constructor();
    /**
     * @remarks
     * 错误的原因。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly reason: BookErrorReason;
}

/**
 * 如果在 {@link ItemBookComponent} 上设置的页面内容无效
 * （即超过最大页面长度）时调用的错误。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class BookPageContentError extends Error {
    private constructor();
    /**
     * @remarks
     * 请求修改的页面的索引。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly pageIndex: number;
    /**
     * @remarks
     * 错误的原因。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly reason: BookErrorReason;
}

// @ts-ignore Class inheritance allowed for native defined classes
export class CommandError extends Error {
    private constructor();
}

/**
 * 如果容器操作违反 {@link ContainerRules} 时抛出的错误。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class ContainerRulesError extends Error {
    private constructor();
    /**
     * @remarks
     * 抛出错误的具体原因。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly reason: ContainerRulesErrorReason;
}

/**
 * 当 CustomCommandRegistry 发生错误时抛出的错误对象。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class CustomCommandError extends Error {
    private constructor();
    /**
     * @remarks
     * 错误的原因。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly reason: CustomCommandErrorReason;
}

// @ts-ignore Class inheritance allowed for native defined classes
export class CustomComponentInvalidRegistryError extends Error {
    private constructor();
}

// @ts-ignore Class inheritance allowed for native defined classes
export class CustomComponentNameError extends Error {
    private constructor();
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly reason: CustomComponentNameErrorReason;
}

// @ts-ignore Class inheritance allowed for native defined classes
export class EnchantmentLevelOutOfBoundsError extends Error {
    private constructor();
}

// @ts-ignore Class inheritance allowed for native defined classes
export class EnchantmentTypeNotCompatibleError extends Error {
    private constructor();
}

// @ts-ignore Class inheritance allowed for native defined classes
export class EnchantmentTypeUnknownIdError extends Error {
    private constructor();
}

// @ts-ignore Class inheritance allowed for native defined classes
export class EntitySpawnError extends Error {
    private constructor();
}

/**
 * 方块无效时可能发生的错误。
 * 在访问方块上不存在的组件时也可能发生。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class InvalidBlockComponentError extends Error {
    private constructor();
}

/**
 * 容器无效。如果容器缺失或已被删除，则可能发生此情况。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class InvalidContainerError extends Error {
    private constructor();
}

/**
 * 容器槽无效。当所属容器被销毁或卸载时可能发生。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class InvalidContainerSlotError extends Error {
    private constructor();
}

/**
 * 实体无效时触发的错误。当访问已移除实体上的组件时可能发生。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class InvalidEntityError extends Error {
    private constructor();
    /**
     * @remarks
     * 现已无效的实体的 ID。
     *
     * 此属性可在早期执行模式下读取。
     *
     */
    readonly id: string;
    /**
     * @remarks
     * 现已无效的实体的类型。
     *
     * 此属性可在早期执行模式下读取。
     *
     */
    readonly type: string;
}

/**
 * 物品无效时触发的错误。当访问已移除物品上的组件时可能发生。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class InvalidItemStackError extends Error {
    private constructor();
    /**
     * @remarks
     * 现已无效的物品的类型。
     *
     * 此属性可在早期执行模式下读取。
     *
     */
    readonly itemType: ItemType;
}

// @ts-ignore Class inheritance allowed for native defined classes
export class InvalidIteratorError extends Error {
    private constructor();
}

// @ts-ignore Class inheritance allowed for native defined classes
export class InvalidPotionDeliveryTypeError extends Error {
    private constructor();
}

// @ts-ignore Class inheritance allowed for native defined classes
export class InvalidPotionEffectTypeError extends Error {
    private constructor();
}

/**
 * 当结构无效时抛出。结构在被删除后变为无效。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class InvalidStructureError extends Error {
    private constructor();
}

/**
 * 尝试注册已存在名称的自定义物品组件时抛出。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class ItemCustomComponentAlreadyRegisteredError extends Error {
    private constructor();
}

/**
 * 使用 /reload 命令后尝试注册之前未注册的自定义物品组件时抛出。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class ItemCustomComponentReloadNewComponentError extends Error {
    private constructor();
}

/**
 * 使用 /reload 命令后尝试注册之前已注册但处理新事件的自定义物品组件时抛出。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class ItemCustomComponentReloadNewEventError extends Error {
    private constructor();
}

/**
 * 使用 /reload 命令后尝试注册 API 版本更新的之前已注册的自定义物品组件时抛出。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class ItemCustomComponentReloadVersionError extends Error {
    private constructor();
}

/**
 * 当指定位置或边界区域的区块未加载时抛出。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class LocationInUnloadedChunkError extends Error {
    private constructor();
}

/**
 * 当指定位置或边界区域超出维度的最小或最大高度时抛出。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class LocationOutOfWorldBoundariesError extends Error {
    private constructor();
}

/**
 * 当名称需要命名空间且在验证该命名空间时发生错误时抛出。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class NamespaceNameError extends Error {
    private constructor();
    /**
     * @remarks
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly reason: NamespaceNameErrorReason;
}

// @ts-ignore Class inheritance allowed for native defined classes
export class PlaceJigsawError extends Error {
    private constructor();
}

// @ts-ignore Class inheritance allowed for native defined classes
export class RawMessageError extends Error {
    private constructor();
}

/**
 * 无效的 {@link TickingAreaManager} 方法调用返回的错误。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class TickingAreaError extends Error {
    private constructor();
    /**
     * @remarks
     * 抛出该错误的具体原因。
     *
     * 此属性可以在早期执行模式下读取。
     *
     */
    readonly reason: TickingAreaErrorReason;
}

/**
 * 当指定区域包含一个或多个未加载的区块时抛出的错误。
 */
// @ts-ignore Class inheritance allowed for native defined classes
export class UnloadedChunksError extends Error {
    private constructor();
}

export const HudElementsCount = 13;
export const HudVisibilityCount = 2;
/**
 * @remarks
 * 表示月相的数量
 *
 */
export const MoonPhaseCount = 8;
/**
 * @remarks
 * 服务器在游戏内一天中的刻数。
 *
 */
export const TicksPerDay = 24000;
/**
 * @remarks
 * 服务器每现实秒的刻数。
 *
 */
export const TicksPerSecond = 20;
/**
 * @remarks
 * 提供系统级事件和函数的类。
 *
 */
export const system: System;
/**
 * @remarks
 * 封装世界状态的类——包含一组维度
 * 及 Minecraft 环境。
 *
 */
export const world: World;



