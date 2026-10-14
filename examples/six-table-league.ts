// 6 人桌联赛:按"循环设计"组桌 —— 每人出场次数严格相等,不用打满 C(n,6)
// 运行:node examples/six-table-league.ts [轮数=3] [每桌局数=6] [参赛者,逗号分隔]
//   设计:固定一个随机排列 P,第 k 桌 = P[k..k+5](下标取模)。
//   一轮 = 10 张桌(n=10 时),每人恰好出现 6 次 —— 比打满 210 张省 20 倍。
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { makeAgent, AI_NAMES } from "../src/ai/index.ts";
import type { Policy } from "../src/env.ts";

const ROUNDS = Number(process.argv[2] ?? 3);
const HANDS = Number(process.argv[3] ?? 6);
const ROSTER = (process.argv[4] ? process.argv[4].split(",").map((x) => x.trim()).filter(Boolean) : AI_NAMES);
const N = ROSTER.length;
const SEAT = Math.min(6, N);
const DETAIL = process.env.LEAGUE_DETAIL === "1";   // LEAGUE_DETAIL=1 打印每桌明细

interface Row { name: string; net: number; rankSum: number; games: number; wins: number; best: number; worst: number; up: number; down: number }
const rows = new Map<string, Row>(ROSTER.map((n) => [n, { name: n, net: 0, rankSum: 0, games: 0, wins: 0, best: -Infinity, worst: Infinity, up: 0, down: 0 }]));
const policies = new Map<string, Policy>(ROSTER.map((n) => [n, makeAgent(n) as unknown as Policy]));

function playTable(lineup: string[], seed: number) {
  const st = createGame(makeConfig({
    players: { startPoints: 20000 },
    endGame: { maxHands: HANDS, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }
  }), lineup, seed);
  const start = st.players.map((p) => p.points);
  advance(st);
  const rng = createRng(seed * 31 + 7);
  let steps = 0;
  while (!st.gameOver && steps++ < 40000) {
    const seat = st.turn.seat;
    if (seat === null) break;
    const act = policies.get(lineup[seat])!(st, rng);
    if (!act || !apply(st, act).ok) break;
  }
  const order = st.players.map((p, i) => [i, p.points] as const).sort((x, y) => y[1] - x[1]);
  if (DETAIL) {
    const cells = order.map(([i], rank) => lineup[i] + (st.players[i].points - start[i] >= 0 ? "+" : "") + (st.players[i].points - start[i]) + (rank === 0 ? "★" : ""));
    console.log("  桌 " + String(seed - 70000).padStart(4) + "  " + cells.join("  "));
  }
  lineup.forEach((nm, i) => {
    const r = rows.get(nm)!;
    const d = st.players[i].points - start[i];
    r.net += d;
    r.rankSum += order.findIndex(([k]) => k === i) + 1;
    r.games++;
    r.best = Math.max(r.best, d);
    r.worst = Math.min(r.worst, d);
    if (d > 0) r.up++; else if (d < 0) r.down++;
    if (order[0][0] === i) r.wins++;
  });
}

// 循环设计:每轮用一个新的随机排列,取连续的 6 人
let s = 20260202;
const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const t0 = Date.now();
console.log("=== 6 人桌联赛:" + N + " 位选手," + ROUNDS + " 轮 × " + N + " 桌 × " + HANDS + " 局 ===");
console.log("设计:循环取座 —— 每人出场 " + (ROUNDS * SEAT) + " 次(严格相等),总桌数 " + (ROUNDS * N) + "(打满 C(" + N + ",6) 需 210 桌)");
for (let r = 0; r < ROUNDS; r++) {
  const perm = ROSTER.slice();
  for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let k = 0; k < N; k++) {
    const lineup = Array.from({ length: SEAT }, (_, i) => perm[(k + i) % N]);
    playTable(lineup, 70000 + r * 1000 + k);
  }
  process.stdout.write("  第 " + (r + 1) + " 轮完成(" + ((Date.now() - t0) / 1000).toFixed(0) + "s)\n");
}
const sorted = [...rows.values()].sort((a, b) => b.net - a.net || a.rankSum / a.games - b.rankSum / b.games);
console.log("");
console.log("名次 选手        净分     场均净分   平均名次   冠军   盈利桌/亏损桌   最大赢   最大输");
sorted.forEach((r, i) => {
  console.log("  " + String(i + 1).padStart(2) + ". " + r.name.padEnd(10) +
    String(r.net).padStart(7) + "   " + (r.net / r.games).toFixed(1).padStart(7) +
    "   " + (r.rankSum / r.games).toFixed(2).padStart(6) +
    "   " + (r.wins + "/" + r.games).padStart(6) +
    "   " + (r.up + "/" + r.down).padStart(6) + "/" + r.games +
    "   " + String(r.best >= 0 ? "+" + r.best : r.best).padStart(7) +
    "   " + String(r.worst).padStart(7));
});
console.log("");
console.log("总用时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s   注:净分为零和,场均净分可比;平均名次越低越好");
