#!/usr/bin/env python3
"""把给到的 5x5 UI 图标总表切分成独立小图标，并输出到 mock-player RP。

用法：
    python mcaddon/mock-player/tools/slice_ui_icons.py [源图路径]

默认源图为：
    /home/yinxin/downloads/ChatGPT Image 2026年8月27日 17_06_07.png
输出目录：
    mcaddon/mock-player/RP/MockPlayer/textures/ui/mockplayer/
"""

from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SOURCE = Path("/home/yinxin/downloads/ChatGPT Image 2026年8月27日 17_06_07.png")
OUTPUT_DIR = REPO_ROOT / "mcaddon/mock-player/RP/MockPlayer/textures/ui/mockplayer"

# 5x5 网格，最后一行只有 4 个图标（右下角为空）。
# 坐标来自对原图非背景像素的连通检测 (0-based inclusive bbox)。
ROWS = [
    (17, 250),
    (266, 499),
    (515, 749),
    (767, 994),
    (1011, 1231),
]
COLS = [
    (17, 247),
    (265, 494),
    (511, 741),
    (759, 987),
    (1005, 1236),
]

# 输出文件名 -> 用途说明
ICON_NAMES: list[list[str | None]] = [
    ["create_bot", "bot_list", "delete_bot", "online_management", "help"],
    ["admin_settings", "toggle_online", "teleport", "sync_pose", "select_mainhand"],
    ["swap_items", "reclaim", "discard", "inventory", "use_item"],
    ["set_spawn", "rename", "throw_trident", "recall", "view_data"],
    ["kill_bot", "clear_equipment", "cancel", "back", None],
]


def make_transparent_outside_tile(arr: np.ndarray, background: tuple[int, int, int]) -> np.ndarray:
    """把圆角方块外侧的深色背景置为透明（只从边界泛洪，避免误伤图标内部深色描边）。"""
    h, w = arr.shape[:2]
    bg = np.array(background, dtype=int)
    near_bg = np.abs(arr[:, :, :3].astype(int) - bg).sum(axis=2) < 70
    visited = np.zeros((h, w), dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    # 从图像四边的背景色像素开始泛洪
    for y in range(h):
        for x in (0, w - 1):
            if near_bg[y, x] and not visited[y, x]:
                visited[y, x] = True
                queue.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if near_bg[y, x] and not visited[y, x]:
                visited[y, x] = True
                queue.append((y, x))

    while queue:
        y, x = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and near_bg[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True
                queue.append((ny, nx))

    out = arr.copy()
    out[visited, 3] = 0
    return out


def pad_to_square(img: Image.Image, size: int = 256) -> Image.Image:
    """居中放到透明方形画布，避免 ActionForm 按钮图标被拉伸。"""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - img.width) // 2
    y = (size - img.height) // 2
    canvas.alpha_composite(img, (x, y))
    return canvas


def main() -> int:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not source.exists():
        print(f"找不到源图: {source}", file=sys.stderr)
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    sheet = Image.open(source).convert("RGBA")
    background = sheet.getpixel((0, 0))[:3]

    saved: list[str] = []
    for row, (y0, y1) in enumerate(ROWS):
        for col, (x0, x1) in enumerate(COLS):
            name = ICON_NAMES[row][col]
            if name is None:
                continue
            # inclusive -> exclusive
            crop = sheet.crop((x0, y0, x1 + 1, y1 + 1))
            arr = np.array(crop)
            arr = make_transparent_outside_tile(arr, background)
            icon = pad_to_square(Image.fromarray(arr), 256)
            out_path = OUTPUT_DIR / f"{name}.png"
            icon.save(out_path)
            saved.append(out_path.name)

    print(f"已生成 {len(saved)} 个图标 -> {OUTPUT_DIR}")
    for name in sorted(saved):
        print(f"  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
