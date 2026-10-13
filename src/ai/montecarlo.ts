// 阶段二:蒙特卡洛 AI。
// 核心思路:对手手牌未知 → 对"世界"采样(determinize)+ 用规则型策略把本局 rollout 到底,
// 比较每个候选动作的期望收益,而不是只看自己牌力。
//  May(稳健) / Yeon(均衡) / Brian(激进)
import { PROFILES, auxDecision } from "./heuristic.ts";
import type { Profile } from "./heuristic.ts";
import { simulateAction, enumerateActions } from "../env.ts";
import type { Policy } from "../env.ts";
import { makeHeuristic } from "./heuristic.ts";
import type { Action, GameState } from "../state.ts";
import type { Rng } from "../rng.ts";

export interface McProfile {
  name: string;
  label: string;
  /** 每个候选动作采样多少个"世界" */
  rollouts: number;
  /** rollout 里所有人用什么策略打(也决定了它的世界观) */
  rolloutWith: string;
  /** 自己做辅助动作时的性格 */
  base: string;
  /** 风险偏好:越高越愿意为"更高的胜率"付出期望值 */
  riskBonus: number;
  /** 单个 rollout 最多几步 */
  maxSteps: number;
}

export const MC_PROFILES: Record<string, McProfile> = {
  May: { name: "May", label: "稳健", rollouts: 24, rolloutWith: "Sam", base: "Baozi", riskBonus: 0.2, maxSteps: 140 },
  Yeon: { name: "Yeon", label: "均衡", rollouts: 16, rolloutWith: "Sam", base: "Sam", riskBonus: 0.8, maxSteps: 120 },
  Brian: { name: "Brian", label: "激进", rollouts: 10, rolloutWith: "Sam", base: "Lucas", riskBonus: 2.0, maxSteps: 100 }
};

function hashAction(a: Action): number {
  const s = JSON.stringify(a);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const MAIN = new Set(["FOLD", "CALL", "RAISE", "COMPARE"]);

export interface McTrace { action: Action; mean: number; winRate: number; samples: number }

/** 用 MC 选主决策;附带每个候选的评估结果(trace)便于调试/展示 */
export function mcDecide(st: GameState, rng: Rng, prof: McProfile): { action: Action; trace: McTrace[] } {
  const seat = st.turn.seat!;
  const rollPolicy: Policy = makeHeuristic(prof.rolloutWith);
  const candidates = enumerateActions(st).filter((a) => MAIN.has(a.type));
  if (candidates.length <= 1) return { action: candidates[0] ?? { type: "FOLD", seat }, trace: [] };
  const seedBase = (rng.next() * 2147483647) >>> 0;
  const scale = Math.max(1, st.pot);
  const trace: McTrace[] = [];
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const a of candidates) {
    const sim = simulateAction(st, a, seat, rollPolicy, prof.rollouts, (seedBase ^ hashAction(a)) >>> 0, prof.maxSteps);
    const score = sim.mean + prof.riskBonus * (sim.winRate - 0.5) * scale;
    trace.push({ action: a, mean: sim.mean, winRate: sim.winRate, samples: sim.samples });
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return { action: best, trace };
}

export function makeMonteCarlo(name: string): Policy {
  const prof = MC_PROFILES[name];
  if (!prof) throw new Error("未知的 MC AI: " + name);
  const base: Profile = PROFILES[prof.base];
  return (st, rng) => {
    const aux = auxDecision(st, rng, base);
    if (aux) return aux;
    return mcDecide(st, rng, prof).action;
  };
}

export const MC_NAMES = Object.keys(MC_PROFILES);
