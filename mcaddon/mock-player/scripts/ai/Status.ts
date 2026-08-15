// ─── 行为树节点状态（字符串枚举） ────────────────────────
// 三态语义（规范化契约，所有节点统一返回）：
//   Success  条件满足 / 动作已完成 —— 父节点"这条路走通了"
//   Failure  条件不满足 / 动作失败 —— 父节点"降级试试别的分支"
//   Running  动作正在进行中 —— 父节点"挂住等待，别重复启动"
// 字符串枚举：值即运行时字符串（日志可读、可序列化，满足 core 层
//   "负载只用 string/number"约束），类型上杜绝拼写错误。

export enum Status {
  Success = "success",
  Failure = "failure",
  Running = "running",
}
