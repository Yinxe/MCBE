// ─── 表单字段与取值解析(纯逻辑,不接触 @minecraft) ─────────────
//
// 本模块刻意不 import 任何 @minecraft 模块,以便被 node --test 直接覆盖。
//
// 背景:非输入类元素(header / label / divider)在部分 Bedrock 版本中占用
// formValues 的下标、在另一些版本中不占用。上游用「取值个数是否等于字段个数」
// 作为启发式判据,本模块保留该判据,并把两种排布都写成可测分支。

/** 表单元素类型。前三种不产生值,后四种产生值。 */
export type FieldKind = "header" | "label" | "divider" | "textField" | "dropdown" | "toggle" | "slider";

/** 单个表单元素的声明:类型 + 调用方指定的字段名。 */
export interface FieldSpec {
  kind: FieldKind;
  name: string;
}

/** 表单取值。取消时调用方拿到 null,而不是这里。 */
export type FormValues = Record<string, string | number | boolean | undefined>;

/** 产生值的元素类型。 */
const VALUE_KINDS: readonly FieldKind[] = ["textField", "dropdown", "toggle", "slider"];

/** 判断某个元素类型是否产生值。 */
export function isValueField(kind: FieldKind): boolean {
  return VALUE_KINDS.indexOf(kind) !== -1;
}

/**
 * 把 formValues 数组解析为「字段名 → 值」。
 *
 * @param fields 按添加顺序排列的元素声明(含不产生值的元素)
 * @param values 游戏返回的 formValues
 */
export function parseModalValues(fields: readonly FieldSpec[], values: readonly (string | number | boolean | undefined)[]): FormValues {
  const result: FormValues = {};

  // 判据:取值个数等于字段总数 ⇒ 非输入元素占用了下标
  const valuesOccupyAll = values.length === fields.length;

  if (valuesOccupyAll) {
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field) continue;
      if (!isValueField(field.kind)) continue;
      result[field.name] = values[i];
    }
    return result;
  }

  // 非输入元素不占下标:只在值字段之间按顺序取
  let valueIndex = 0;
  for (const field of fields) {
    if (!isValueField(field.kind)) continue;
    result[field.name] = values[valueIndex];
    valueIndex++;
  }
  return result;
}
