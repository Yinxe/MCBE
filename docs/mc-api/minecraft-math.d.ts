import type { Vector2 } from '@minecraft/server';
import type { Vector3 } from '@minecraft/server';

/**
 * 将传入的数字限制在传入的最小值和最大值之间。
 *
 * @public
 */
export declare function clampNumber(val: number, min: number, max: number): number;

/**
 * 零
 *
 * 一个表示在所有方向上值为 0 的向量 (0,0)
 *
 * @public
 */
export declare const VECTOR2_ZERO: Vector2;

/**
 * Vector2 包装器类，可作为 \@minecraft/server 中需要 Vector2 的 API 的 Vector2 使用。
 * @public
 */
export declare class Vector2Builder implements Vector2 {
    x: number;
    y: number;
    constructor(vecStr: string, delim?: string);
    constructor(vec: Vector2, arg?: never);
    constructor(x: number, y: number);
    toString(options?: {
        decimals?: number;
        delimiter?: string;
    }): string;
}

/**
 * 操作 Vector2 对象的工具函数。所有方法均为静态方法，不会修改输入对象。
 *
 * @public
 */
export declare class Vector2Utils {
    /**
     * toString
     *
     * 创建 vector2 的字符串表示形式
     */
    static toString(v: Vector2, options?: {
        decimals?: number;
        delimiter?: string;
    }): string;
    /**
     * fromString
     *
     * 从 {@link Vector3Utils.toString} 产生的字符串表示形式中获取 Vector2。如果任何数值不是数字
     * 或格式无效，则返回 undefined。
     * @param str - 要解析的字符串
     * @param delimiter - 用于分隔各组件的分隔符。默认为 {@link Vector3Utils.toString} 的默认分隔符
     */
    static fromString(str: string, delimiter?: string): Vector2 | undefined;
}

/**
 * 后
 *
 * 一个表示世界 BACK 方向 (0,0,-1) 的单位向量
 *
 * @public
 */
export declare const VECTOR3_BACK: Vector3;

/**
 * 下
 *
 * 一个表示世界 DOWN 方向 (0,-1,0) 的单位向量
 *
 * @public
 */
export declare const VECTOR3_DOWN: Vector3;

/**
 * 东
 *
 * 一个表示世界 EAST 方向 (-1,0,0) 的单位向量
 *   （同 RIGHT）
 *
 * @public
 */
export declare const VECTOR3_EAST: Vector3;

/**
 * 前
 *
 * 一个表示世界 FORWARD 方向 (0,0,1) 的单位向量
 *
 * @public
 */
export declare const VECTOR3_FORWARD: Vector3;

/**
 * 半
 *
 * 一个表示在所有方向上值为 0.5 的向量 (0.5,0.5,0.5)
 *
 * @public
 */
export declare const VECTOR3_HALF: Vector3;

/**
 * 左
 *
 * 一个表示世界 LEFT 方向 (-1,0,0) 的单位向量
 *
 * @public
 */
export declare const VECTOR3_LEFT: Vector3;

/**
 * 负一
 *
 * 一个表示在所有方向上值为 -1 的向量 (-1,-1,-1)
 *
 * @public
 */
export declare const VECTOR3_NEGATIVE_ONE: Vector3;

/**
 * 北
 *
 * 一个表示世界 NORTH 方向 (-1,0,0) 的单位向量
 *   （同 FORWARD）
 *
 * @public
 */
export declare const VECTOR3_NORTH: Vector3;

/**
 * 一
 *
 * 一个表示在所有方向上值为 1 的向量 (1,1,1)
 *
 * @public
 */
export declare const VECTOR3_ONE: Vector3;

/**
 * 右
 *
 * 一个表示世界 RIGHT 方向 (1,0,0) 的单位向量
 *
 * @public
 */
export declare const VECTOR3_RIGHT: Vector3;

/**
 * 南
 *
 * 一个表示世界 SOUTH 方向 (-1,0,0) 的单位向量
 *   （同 BACK）
 *
 * @public
 */
export declare const VECTOR3_SOUTH: Vector3;

/**
 * 上
 *
 * 一个表示世界 UP 方向 (0,1,0) 的单位向量
 *
 * @public
 */
export declare const VECTOR3_UP: Vector3;

/**
 * 西
 *
 * 一个表示世界 WEST 方向 (-1,0,0) 的单位向量
 *   （同 LEFT）
 *
 * @public
 */
export declare const VECTOR3_WEST: Vector3;

/**
 * 零
 *
 * 一个表示在所有方向上值为 0 的向量 (0,0,0)
 *
 * @public
 */
export declare const VECTOR3_ZERO: Vector3;

/**
 * Vector3 包装器类，可作为 \@minecraft/server 中需要 Vector3 的 API 的 Vector3 使用，
 * 同时包含额外的辅助方法。这是直接使用核心 Vector3 工具方法的替代方案，
 * 适合偏好面向对象方式的用户。此版本是可变的，会就地更改状态。
 *
 * 如需不可变版本，请使用 ImmutableVector3Builder。
 *
 * @public
 */
export declare class Vector3Builder implements Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(vecStr: string, delim?: string, arg2?: never);
    constructor(vec: Vector3, arg?: never, arg2?: never);
    constructor(x: number, y: number, z: number);
    /**
     * 将传入向量的值分配给此向量。返回自身。
     */
    assign(vec: Vector3): this;
    /**
     * equals
     *
     * 检查两个向量是否相等
     */
    equals(v: Vector3): boolean;
    /**
     * add
     *
     * 将向量 v 加到此向量，返回自身。
     */
    add(v: Partial<Vector3>): this;
    /**
     * subtract
     *
     * 从此向量减去向量 v，返回自身。
     */
    subtract(v: Partial<Vector3>): this;
    /** scale
     *
     * 将当前向量乘以传入的值，返回自身。
     */
    scale(val: number): this;
    /**
     * dot
     *
     * 计算当前向量与传入向量的点积。
     */
    dot(vec: Vector3): number;
    /**
     * cross
     *
     * 计算当前向量与传入向量的叉积，返回自身。
     */
    cross(vec: Vector3): this;
    /**
     * magnitude
     *
     * 向量的模
     */
    magnitude(): number;
    /**
     * distance
     *
     * 计算两个向量之间的距离
     */
    distance(vec: Vector3): number;
    /**
     * normalize
     *
     * 归一化当前向量，返回自身。
     */
    normalize(): this;
    /**
     * floor
     *
     * 对向量的各分量向下取整，产生新向量
     */
    floor(): this;
    /**
     * toString
     *
     * 创建向量的字符串表示形式
     */
    toString(options?: {
        decimals?: number;
        delimiter?: string;
    }): string;
    /**
     * clamp
     *
     * 将向量的各分量限制在指定范围内，产生新向量
     */
    clamp(limits: {
        min?: Partial<Vector3>;
        max?: Partial<Vector3>;
    }): this;
    /**
     * lerp
     *
     * 使用线性插值在两个向量的各分量之间构造新向量。
     */
    lerp(vec: Vector3, t: number): this;
    /**
     * slerp
     *
     * 使用球面线性插值在两个向量的各分量之间构造新向量。
     */
    slerp(vec: Vector3, t: number): this;
    /**
     * multiply
     *
     * 两个向量逐分量相乘。
     * 不要与 {@link Vector3Builder.dot} 点积或 {@link Vector3Builder.cross} 叉积混淆
     */
    multiply(vec: Vector3): this;
    /**
     * rotateX
     *
     * 绕 X 轴逆时针旋转向量（左手定则）
     * @param a - 弧度角度
     */
    rotateX(a: number): this;
    /**
     * rotateY
     *
     * 绕 Y 轴逆时针旋转向量（左手定则）
     * @param a - 弧度角度
     */
    rotateY(a: number): this;
    /**
     * rotateZ
     *
     * 绕 Z 轴逆时针旋转向量（左手定则）
     * @param a - 弧度角度
     */
    rotateZ(a: number): this;
}

/**
 * 操作 Vector3 对象的工具函数。所有方法均为静态方法，不会修改输入对象。
 *
 * @public
 */
export declare class Vector3Utils {
    /**
     * equals
     *
     * 检查两个向量是否相等
     */
    static equals(v1: Vector3, v2: Vector3): boolean;
    /**
     * add
     *
     * 将两个向量相加，产生新向量
     */
    static add(v1: Vector3, v2: Partial<Vector3>): Vector3;
    /**
     * subtract
     *
     * 将两个向量相减，产生新向量 (v1-v2)
     */
    static subtract(v1: Vector3, v2: Partial<Vector3>): Vector3;
    /** scale
     *
     * 将向量中的所有分量乘以单一标量值，产生新向量
     */
    static scale(v1: Vector3, scale: number): Vector3;
    /**
     * dot
     *
     * 计算两个向量的点积
     */
    static dot(a: Vector3, b: Vector3): number;
    /**
     * cross
     *
     * 计算两个向量的叉积。返回新向量。
     */
    static cross(a: Vector3, b: Vector3): Vector3;
    /**
     * magnitude
     *
     * 向量的模
     */
    static magnitude(v: Vector3): number;
    /**
     * distance
     *
     * 计算两个向量之间的距离
     */
    static distance(a: Vector3, b: Vector3): number;
    /**
     * normalize
     *
     * 获取 Vector3 并将其归一化为单位向量
     */
    static normalize(v: Vector3): Vector3;
    /**
     * floor
     *
     * 对向量的各分量向下取整，产生新向量
     */
    static floor(v: Vector3): Vector3;
    /**
     * toString
     *
     * 创建 vector3 的字符串表示形式
     */
    static toString(v: Vector3, options?: {
        decimals?: number;
        delimiter?: string;
    }): string;
    /**
     * fromString
     *
     * 从 {@link Vector3Utils.toString} 产生的字符串表示形式中获取 Vector3。如果任何数值不是数字
     * 或格式无效，则返回 undefined。
     * @param str - 要解析的字符串
     * @param delimiter - 用于分隔各组件的分隔符。默认为 {@link Vector3Utils.toString} 的默认分隔符
     */
    static fromString(str: string, delimiter?: string): Vector3 | undefined;
    /**
     * clamp
     *
     * 将向量的各分量限制在指定范围内，产生新向量
     */
    static clamp(v: Vector3, limits?: {
        min?: Partial<Vector3>;
        max?: Partial<Vector3>;
    }): Vector3;
    /**
     * lerp
     *
     * 使用线性插值在两个向量的各分量之间构造新向量。
     */
    static lerp(a: Vector3, b: Vector3, t: number): Vector3;
    /**
     * slerp
     *
     * 使用球面线性插值在两个向量的各分量之间构造新向量。
     */
    static slerp(a: Vector3, b: Vector3, t: number): Vector3;
    /**
     * multiply
     *
     * 两个向量逐分量相乘。
     * 不要与 {@link Vector3Utils.dot} 点积或 {@link Vector3Utils.cross} 叉积混淆
     */
    static multiply(a: Vector3, b: Vector3): Vector3;
    /**
     * rotateX
     *
     * 绕 X 轴逆时针旋转向量（左手定则）
     * @param a - 弧度角度
     */
    static rotateX(v: Vector3, a: number): Vector3;
    /**
     * rotateY
     *
     * 绕 Y 轴逆时针旋转向量（左手定则）
     * @param a - 弧度角度
     */
    static rotateY(v: Vector3, a: number): Vector3;
    /**
     * rotateZ
     *
     * 绕 Z 轴逆时针旋转向量（左手定则）
     * @param a - 弧度角度
     */
    static rotateZ(v: Vector3, a: number): Vector3;
}

export { }
