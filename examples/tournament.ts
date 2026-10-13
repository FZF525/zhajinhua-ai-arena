// AI 擂台(斗蛐蛐):两两循环赛,输出积分榜
// 运行:node examples/tournament.ts [每人场次=4] [每场局数=5] [参赛者,逗号分隔,默认全部]
// 只要你的 AI 实现 (state, rng) => Action 并注册进 src/ai/index.ts,就能直接扔进来打。
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { makeAgent, AI_NAMES } from "../src/ai/index.ts";
import type { Policy } from "../src/env.ts";

const MATCHES = Number(process.argv[2] ?? 4);
const HANDS = Number(process.argv[3] ?? 5);
const ROSTER = (process.argv[4] ? process.argv[4].split(",").map((x) => x.trim()).filter(Boolean) : AI_NAMES);

function duel(a: Policy, b: Policy, seed: number, swap: boolean): number {
  const st = createGame(makeConfig({
    players: { startPoints: 20000 },
    endGame: { maxHands: HANDS, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }
  }), swap ? ["B", "A"] : ["A", "B"], seed);
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

interface Row { name: string; net: number; w: number; l: number; d: number; games: number }
const table = new Map<string, Row>(ROSTER.map((n) => [n, { name: n, net: 0, w: 0, l: 0, d: 0, games: 0 }]));
const policies = new Map<string, Policy>(ROSTER.map((n) => [n, makeAgent(n)]));
console.log("循环赛:" + ROSTER.length + " 位选手,每对 " + MATCHES + " 场 × " + HANDS + " 局(轮换座位)");
const t0 = Date.now();
for (let i = 0; i < ROSTER.length; i++) {
  for (let j = i + 1; j < ROSTER.length; j++) {
    const A = ROSTER[i], B = ROSTER[j];
    let net = 0;
    for (let m = 0; m < MATCHES; m++) net += duel(policies.get(A)!, policies.get(B)!, 4000 + i * 97 + j * 13 + m, m % 2 === 1);
    net /= MATCHES;
    const ra = table.get(A)!, rb = table.get(B)!;
    ra.net += net; rb.net -= net;
    ra.games++; rb.games++;
    if (net > 0) { ra.w++; rb.l++; } else if (net < 0) { ra.l++; rb.w++; } else { ra.d++; rb.d++; }
  }
}
const rows = [...table.values()].sort((x, y) => y.net - x.net);
console.log("\n排名  角色         净胜分   胜-负-平");
rows.forEach((r, i) => {
  console.log("  " + String(i + 1).padStart(2) + "   " + r.name.padEnd(12) + (r.net >= 0 ? "+" : "") + r.net.toFixed(0).padStart(6) +
    "   " + r.w + "-" + r.l + "-" + r.d);
});
console.log("\n总耗时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s   注:每对 " + MATCHES + " 场,样本小,名次看量级");
