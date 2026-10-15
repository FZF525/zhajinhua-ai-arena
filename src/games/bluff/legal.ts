// 唬牌的动作类型(与 rules.ts 分离,避免循环依赖)
export type BluffAction =
  | { type: "PLAY"; seat: number; cardIds: string[] }
  | { type: "CHALLENGE"; seat: number };