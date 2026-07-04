/**
 * ============================================================================
 * Table —— 纯文本表格渲染器（兼容 § 颜色码）
 * ============================================================================
 *
 * 用法：
 *   new Table()
 *     .header("<>", "TYPES", Cell.right("ITEMS"), "STORAGE")
 *     .row("Container(8)", "52", "4250223", "135/384(0.35) ⚠")
 *     .row("Bulk(1)",      "1",  "3000",   "10/54(0.19)")
 *     .render()
 *
 *   // 默认居中对齐；Cell.left() / Cell.right() 指定对齐
 *   // § 颜色码不计入视觉宽度，自动处理对齐
 * ============================================================================
 */

/** 对齐方式 */
type Align = "left" | "center" | "right";

/**
 * 单元格，携带内容和对齐方式。
 * 直接用字符串（String / number）等同于 Cell.center()。
 */
export class Cell {
  constructor(
    readonly content: string,
    readonly align: Align = "left"
  ) {}

  /** § 颜色码在 MC ModalForm 中占用 2 个字符位置 */
  static visualLen(s: string): number {
    let len = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "§" && i + 1 < s.length) {
        len += 2; // § + 字母
        i++; // 跳过颜色字母
      } else {
        len += 1;
      }
    }
    return len;
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

/**
 * 表格构建器。
 *
 * 列宽由每列最长的视觉内容决定（每列等宽）。
 * 列数由第一行决定（header 或第一个 row）。
 */
export class Table {
  private rows: Cell[][] = [];
  private cols = 0;

  /** 添加表头行（显示为第一行） */
  header(...cells: (Cell | string | number)[]): this {
    this.rows = [cells.map(toCell)];
    this.cols = this.rows[0].length;
    return this;
  }

  /** 添加数据行 */
  row(...cells: (Cell | string | number)[]): this {
    const r = cells.map(toCell);
    if (this.cols === 0) this.cols = r.length;
    // 补齐到列数（防止长度不一致）
    while (r.length < this.cols) r.push(new Cell(""));
    this.rows.push(r);
    return this;
  }

  /** 渲染为多行文本 */
  render(margin = 2): string {
    if (this.rows.length === 0) return "";

    // 计算每列最大视觉宽度 + 边距
    const colW = new Array<number>(this.cols).fill(0);
    for (const row of this.rows) {
      for (let c = 0; c < this.cols; c++) {
        colW[c] = Math.max(colW[c], Cell.visualLen(row[c].content) + margin);
      }
    }

    return this.rows
      .map((row) =>
        row
          .map((cell, c) => {
            const w = colW[c];
            const v = Cell.visualLen(cell.content);
            const pad = w - v;
            if (cell.align === "left") {
              return cell.content + " ".repeat(pad);
            } else if (cell.align === "right") {
              return " ".repeat(pad) + cell.content;
            } else {
              const l = Math.floor(pad / 2);
              const r = Math.ceil(pad / 2);
              return " ".repeat(l) + cell.content + " ".repeat(r);
            }
          })
          .join(" ")
      )
      .join("\n");
  }
}

function toCell(x: Cell | string | number): Cell {
  if (x instanceof Cell) return x;
  return new Cell(String(x));
}
