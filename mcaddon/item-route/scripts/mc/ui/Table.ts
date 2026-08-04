/**
 * ============================================================================
 * Table —— 纯文本表格渲染器（兼容 § 颜色码）
 * ============================================================================
 *
 * 用法：
 *   new Table()
 *     .header("<>", "TYPES", Cell.right("ITEMS"), "STORAGE")
 *     .row("Container(8)", "52", "4250223", "135/384(0.35) ⚠")
 *     .render()
 *
 *   // 默认左对齐；Cell.left() / Cell.center() / Cell.right() 指定对齐
 *   // § 颜色码不计入视觉宽度，自动处理对齐
 * ============================================================================
 */

/** 对齐方式 */
type Align = "left" | "center" | "right";

/** 单元格，携带内容和对齐方式。 */
export class Cell {
  constructor(
    readonly content: string,
    readonly align: Align = "left"
  ) {}

  /** 视觉长度：§ 颜色码不占位（MC 中不可见），只计可见字符 */
  static visualLen(s: string): number {
    return s.replace(/§[0-9a-fklmnor]/g, "").length;
  }

  static left(c: string | number): Cell {
    return new Cell(String(c), "left");
  }
  static center(c: string | number): Cell {
    return new Cell(String(c), "center");
  }
  static right(c: string | number): Cell {
    return new Cell(String(c), "right");
  }
}

/** 表格构建器。列宽由每列最长视觉内容决定。 */
export class Table {
  private rows: Cell[][] = [];
  private cols = 0;

  /** 添加表头行（显示为第一行） */
  header(...cells: (Cell | string | number)[]): this {
    this.rows = [cells.map(toCell)];
    this.cols = this.rows[0]!.length;
    return this;
  }

  /** 添加数据行 */
  row(...cells: (Cell | string | number)[]): this {
    const r = cells.map(toCell);
    if (this.cols === 0) this.cols = r.length;
    while (r.length < this.cols) r.push(new Cell(""));
    this.rows.push(r);
    return this;
  }

  /**
   * 渲染为多行文本。
   * @param margin 每列左右边距
   * @param gaps   列间额外间隙（长度 = cols - 1）
   */
  render(margin = 2, gaps?: number[]): string {
    if (this.rows.length === 0) return "";

    const colW = new Array<number>(this.cols).fill(0);
    for (const row of this.rows) {
      for (let c = 0; c < this.cols; c++) {
        colW[c] = Math.max(colW[c]!, Cell.visualLen(row[c]!.content) + margin);
      }
    }

    const defaultGap = 1;

    return this.rows
      .map((row) =>
        row
          .map((cell, c) => {
            const w = colW[c]!;
            const v = Cell.visualLen(cell.content);
            const pad = w - v;
            const padded =
              cell.align === "left"
                ? cell.content + " ".repeat(pad)
                : cell.align === "right"
                  ? " ".repeat(pad) + cell.content
                  : (() => {
                      const l = Math.floor(pad / 2);
                      const r = Math.ceil(pad / 2);
                      return " ".repeat(l) + cell.content + " ".repeat(r);
                    })();
            const gap = c < this.cols - 1 ? (gaps?.[c] ?? defaultGap) : 0;
            return padded + " ".repeat(gap);
          })
          .join("")
      )
      .join("\n");
  }
}

function toCell(x: Cell | string | number): Cell {
  if (x instanceof Cell) return x;
  return new Cell(String(x));
}