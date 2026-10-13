// AI 注册表:CLI / Web / 测试都从这里取
import type { Policy } from "../env.ts";
import { makeHeuristic, PROFILES, HEURISTIC_NAMES } from "./heuristic.ts";
import { makeMonteCarlo, MC_PROFILES, MC_NAMES } from "./montecarlo.ts";
import { makeEquityBot, EQ_PROFILES, EQ_NAMES } from "./equity.ts";
import { loadZeroB, makeZeroB, zeroBPath } from "./learning.ts";

export { PROFILES, HEURISTIC_NAMES, MC_PROFILES, MC_NAMES, EQ_PROFILES, EQ_NAMES };
export type { Profile } from "./heuristic.ts";
export type { McProfile } from "./montecarlo.ts";
export type { EqProfile } from "./equity.ts";

export const ZEROB_NAME = "ZeroB";
export const AI_NAMES = [...HEURISTIC_NAMES, ...MC_NAMES, ...EQ_NAMES, ZEROB_NAME];

/** ZeroB 是学习型:从 data/zerob.json 读训练结果,没有就退化为 EQBfast */
export function zeroBStatus(): { trainedHands: number; states: number } {
  const t = loadZeroB(zeroBPath());
  return { trainedHands: t?.trainedHands ?? 0, states: t ? Object.keys(t.q).length : 0 };
}

export interface AgentInfo { name: string; label: string; kind: "heuristic" | "montecarlo" | "equity" | "learning"; note: string }

export const AGENTS: AgentInfo[] = [
  ...HEURISTIC_NAMES.map((n) => ({ name: n, label: PROFILES[n].label, kind: "heuristic" as const, note: "规则型" })),
  ...MC_NAMES.map((n) => ({ name: n, label: MC_PROFILES[n].label, kind: "montecarlo" as const, note: MC_PROFILES[n].rollouts + " 次采样" })),
  ...EQ_NAMES.map((n) => ({ name: n, label: EQ_PROFILES[n].label, kind: "equity" as const, note: EQ_PROFILES[n].samples + " 次胜率采样" })),
  { name: ZEROB_NAME, label: "学习型", kind: "learning" as const, note: zeroBStatus().trainedHands > 0
      ? "已自对弈 " + zeroBStatus().trainedHands + " 手 / " + zeroBStatus().states + " 状态"
      : "未训练(暂用 EQBfast 顶班,跑 examples/zerob-train.ts 训练)" }
];

export function makeAgent(name: string): Policy {
  if (PROFILES[name]) return makeHeuristic(name);
  if (MC_PROFILES[name]) return makeMonteCarlo(name);
  if (EQ_PROFILES[name]) return makeEquityBot(name);
  if (name === ZEROB_NAME) return makeZeroB(loadZeroB(zeroBPath()));
  throw new Error("未知 AI: " + name + "(可用:" + AI_NAMES.join("/") + ")");
}

export function isAgentName(name: string): boolean {
  return AI_NAMES.includes(name);
}
