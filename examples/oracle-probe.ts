// 参照物:把 MC 的采样数拉大、去掉风险偏好(纯期望值),看现有 AI 离"同策略更高算力"有多远
// 这测的是"算力瓶颈",不是"策略上限" —— 用来估计还有多少空间
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { makeAgent } from "../src/ai/index.ts";
import { makeMonteCarlo } from "../src/ai/montecarlo.ts";
import { PROFILES } from "../src/ai/heuristic.ts";
import { randomBot } from "../src/bot.ts";
import type { Policy } from "../src/env.ts";

const MATCHES = Number(process.argv[2] ?? 8);
const HANDS = Number(process.argv[3] ?? 6);

function duel(a: Policy, b: Policy, seed: number, swap: boolean): number {
  const names = ["A", "B"];
  const st = createGame(makeConfig({
    players: { startPoints: 20000 },
    endGame: { maxHands: HANDS, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }
  }), names, seed);
  const start = st.players.map((p) => p.points);
  advance(st);
  const agents: Policy[] = swap ? [b, a] : [a, b];
  const rng = createRng(seed * 31 + 7);
  let steps = 0;
  while (!st.gameOver && steps++ < 20000) {
    const seat = st.turn.seat;
    if (seat === null) break;
    const act = agents[seat](st, rng);
    if (!act || !apply(st, act).ok) break;
  }
  return st.players[swap ? 1 : 0].points - start[swap ? 1 : 0];
}

// 参照物 1:同策略但采样 150 次、风险中性
const PROF = { name: "OracleLite", label: "高算力", rollouts: 120, rolloutWith: "Sam", base: "Sam", riskBonus: 0, maxSteps: 160 };
const oracle = makeMonteCarlo("Yeon");   // 只是借壳;下面直接构造
import { mcDecide } from "../src/ai/montecarlo.ts";
import { auxDecision } from "../src/ai/heuristic.ts";
const oraclePolicy: Policy = (st, rng) => auxDecision(st, rng, PROFILES.Sam) ?? mcDecide(st, rng, PROF).action;

const refs: Array<[string, Policy]> = [
  ["Sam(标准)", makeAgent("Sam")],
  ["Brian(激进MC)", makeAgent("Brian")],
  ["random(随机)", (st, rng) => randomBot(st, rng)]
];
void oracle;
console.log("参照物 = 同策略 + 采样 150 次 + 风险中性(纯期望值);每格 " + MATCHES + " 场 × " + HANDS + " 局");
for (const [name, ref] of refs) {
  let sum = 0;
  const t0 = Date.now();
  for (let m = 0; m < MATCHES; m++) sum += duel(oraclePolicy, ref, 700 + m, m % 2 === 1);
  console.log("  vs " + name.padEnd(14) + (sum / MATCHES >= 0 ? "+" : "") + (sum / MATCHES).toFixed(0).padStart(6) + " 分/场   (" + ((Date.now() - t0) / 1000).toFixed(1) + "s)");
}
