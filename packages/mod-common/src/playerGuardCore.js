"use strict";
// ─── 玩家对象守卫纯核（不依赖游戏运行时，可单测） ─────────────────────
//
// 背景：模拟玩家（假人，含本仓 mockplayer3 与任意第三方假人模组）在 `world.getPlayers()`
// 里与真人同池返回，但**大量成员属性/方法不实现**——已知表现：
//   · `getGameMode()` 直接抛错（跨任意假人模组成立的可靠特征，不依赖 tag）；
//   · `getComponent()` 在实体半初始化/刚召唤的若干 tick 内可能抛错或返回 undefined 宿主；
//   · 数组项本身可能是 `undefined` 或字段不全的半初始化对象（裸读 `.location` 即 TypeError）。
//
// 因此**任何**读取玩家属性/组件的 API 都不能假设对象完整。本文件是唯一的判别与
// 安全访问实现；`playerGuard.ts` 只负责把官方 `Player` 类与 `world` 绑进来。
// 拆成纯核是为了能在 Node 下直接单测（`@minecraft/server` 在测试进程里不可加载）。
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPlayerGuard = createPlayerGuard;
exports.createWorldPlayerGuard = createWorldPlayerGuard;
/**
 * 构造守卫工具集。
 *
 * @param isInstance - 实例判定谓词（生产环境绑官方 `instanceof Player`）
 */
function createPlayerGuard(isInstance) {
    /**
     * 对象本身是否可安全使用（不判真假人）。
     *
     * 仅验证对象自身可读：实例判定通过 + `id`/`dimension`/`location` 均可读。
     * 半初始化实体、已移除句柄、`undefined` 数组项一律返回 false。
     */
    function isUsablePlayer(p) {
        if (p === undefined || p === null)
            return false;
        if (!isInstance(p))
            return false;
        try {
            const candidate = p;
            if (typeof candidate.id !== "string" || candidate.id.length === 0)
                return false;
            if (candidate.dimension === undefined || candidate.location === undefined)
                return false;
            return true;
        }
        catch {
            return false; // 访问即抛错 → 失效对象
        }
    }
    /**
     * 是否为模拟玩家（假人）。
     *
     * 判据：`getGameMode()` 抛错、缺失或返回 undefined。这是跨任意假人模组都成立的
     * 可靠特征（假人不实现游戏模式），不依赖 tag，因此第三方假人模组同样能被识别。
     */
    function isSimulatedPlayer(p) {
        if (!isUsablePlayer(p))
            return false;
        try {
            if (typeof p.getGameMode !== "function")
                return true; // 方法缺失 → 假人
            return p.getGameMode() === undefined;
        }
        catch {
            return true; // getGameMode 抛错 → 假人
        }
    }
    /** 是否为**真人**玩家（可用对象 + 非假人） */
    function isRealPlayer(p) {
        if (!isUsablePlayer(p))
            return false;
        return !isSimulatedPlayer(p);
    }
    /**
     * 玩家名三级兜底读取：`name` → `playerName` → `nameTag`。
     *
     * 假人的 `name`/`nameTag` 可能走实体层，且半初始化实体属性访问可能抛错，
     * 故逐键 try 并回退。绝不向外抛。
     */
    function playerNameOf(p) {
        if (p === undefined || p === null)
            return undefined;
        const candidate = p;
        for (const key of ["name", "playerName", "nameTag"]) {
            try {
                const value = candidate[key];
                if (typeof value === "string" && value.length > 0)
                    return value;
            }
            catch {
                continue; // 该键访问抛错（半初始化实体）→ 试下一级兜底
            }
        }
        return undefined;
    }
    /**
     * 安全枚举在线玩家（真人 + 假人，不做真假区分）。
     *
     * 丢弃不可用对象与取不到名字的项，返回 `{ player, name }`。`name` 是**已解析**结果，
     * 调用方不要再裸读 `p.name`（兜底到 nameTag 的实体会读到 undefined）。
     */
    function safePlayers(players, options) {
        const realOnly = options?.realOnly === true;
        const out = [];
        let source;
        try {
            source = players;
            // 触发迭代器的首次求值，把"集合本身坏掉"也纳入 try
            void source[Symbol.iterator]();
        }
        catch {
            return [];
        }
        for (const p of source) {
            try {
                if (!isUsablePlayer(p))
                    continue;
                if (realOnly && isSimulatedPlayer(p))
                    continue;
                const name = playerNameOf(p);
                if (name === undefined)
                    continue;
                out.push({ player: p, name });
            }
            catch {
                continue; // 单项瞬态失效不影响其余玩家
            }
        }
        return out;
    }
    /**
     * 对单个玩家执行读取/操作，任何异常都吞掉并返回 undefined。
     *
     * 用于"这个玩家可能随时失效（假人下线、维度切换、半初始化）"的场景：
     * 单玩家失败绝不影响其他玩家，也不让异常穿到事件回调外层。
     */
    function safePlayerCall(p, fn, options) {
        try {
            if (!isUsablePlayer(p))
                return undefined;
            if (options?.requireReal === true && isSimulatedPlayer(p))
                return undefined;
            return fn(p);
        }
        catch {
            return undefined;
        }
    }
    return { isUsablePlayer, isSimulatedPlayer, isRealPlayer, playerNameOf, safePlayers, safePlayerCall };
}
/**
 * 构造带世界枚举默认值的守卫工具集（`safePlayers()` 省略集合时取 `getPlayers()`）。
 *
 * 调用方自行提供实例判定与枚举函数，从而把**自己的** `Player` 类绑进来——
 * 避免共享库与模组各自的 `@minecraft/server` 副本产生类型冲突。
 *
 * @param isInstance - 实例判定谓词（`p => p instanceof Player`）
 * @param getPlayers - 在线玩家枚举（`() => world.getPlayers()`）
 */
function createWorldPlayerGuard(isInstance, getPlayers) {
    const guard = createPlayerGuard(isInstance);
    const coreSafePlayers = guard.safePlayers;
    function safePlayers(players, options) {
        if (players !== undefined)
            return coreSafePlayers(players, options);
        let all;
        try {
            all = getPlayers();
        }
        catch {
            return [];
        }
        return coreSafePlayers(all, options);
    }
    return { ...guard, safePlayers };
}
