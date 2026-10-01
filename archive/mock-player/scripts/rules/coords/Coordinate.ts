// ─── 坐标解析（core 层） ────────────────────────────────
// 纯逻辑：容错坐标输入解析（支持相对坐标 ~、中文分隔符、括号包裹）。

import type { Vec3 } from "../Types";

export type CoordinateParseResult =
  | { ok: true; pos: Vec3 }
  | { ok: false; reason: "empty" | "invalid"; message: string };

/**
 * 容错解析坐标输入
 * - 分隔符：空格 / 全角空格 / 中英文逗号 / 混合
 * - 支持括号包裹：(100, 20, 30) / [100 20 30] / 【100,20,30】
 * - 支持 ~ 相对坐标（~ / ~5 / ~-3），基于 origin 偏移
 * - 空输入返回 { ok: false, reason: "empty" }，调用方据此原地创建
 */
export function parseCoordinateInput(input: string, origin?: Vec3): CoordinateParseResult {
  if (!input || input.trim() === "") {
    return { ok: false, reason: "empty", message: "坐标为空" };
  }

  // 去掉首尾括号，统一分隔符（中英文逗号、全角空格 → 半角空格）
  let s = input.trim().replace(/^[([【]/, "").replace(/[)\]】]$/, "");
  s = s.replace(/[，,]/g, " ").replace(/\u3000/g, " ");

  const parts = s.trim().split(/\s+/);
  if (parts.length !== 3) {
    return { ok: false, reason: "invalid", message: `需要 3 个数字（x y z），实际收到 ${parts.length} 个` };
  }

  const axis = ["x", "y", "z"] as const;
  const nums: number[] = [];
  for (let i = 0; i < 3; i++) {
    const token = parts[i];
    if (token === undefined) {
      return { ok: false, reason: "invalid", message: `第 ${i + 1} 个坐标为空白` };
    }
    if (token.startsWith("~")) {
      // 相对坐标：~ 或 ~N，基于 origin 偏移
      if (!origin) {
        return { ok: false, reason: "invalid", message: `第 ${i + 1} 个坐标 "${token}" 是相对坐标，但缺少基准位置` };
      }
      const offset = token.length > 1 ? parseFloat(token.slice(1)) : 0;
      if (isNaN(offset)) {
        return { ok: false, reason: "invalid", message: `第 ${i + 1} 个坐标 "${token}" 不是有效数字` };
      }
      nums.push(origin[axis[i] ?? "x"] + offset);
    } else {
      const n = parseFloat(token);
      if (isNaN(n)) {
        return { ok: false, reason: "invalid", message: `第 ${i + 1} 个坐标 "${token}" 不是有效数字` };
      }
      nums.push(n);
    }
  }

  return { ok: true, pos: { x: nums[0] ?? 0, y: nums[1] ?? 0, z: nums[2] ?? 0 } };
}
