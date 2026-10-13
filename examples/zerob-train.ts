// ZeroB 自对弈训练:每代一定手数,训练后与 Sam 单挑评估,打印学习曲线并保存
// 运行:node examples/zerob-train.ts [代数=6] [每代手数=200] [评估场次=4] [评估局数=5]
import { trainZeroB, saveZeroB, loadZeroB, zeroBPath, emptyTable, makeZeroB } from "../src/ai/learning.ts";
import { makeAgent } from "../src/ai/index.ts";
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import type { Policy } from "../src/env.ts";

const GENS = Number(process.argv[2] ?? 6);
const PER = Number(process.argv[3] ?? 200);
const MATCHES = Number(process.argv[4] ?? 4);
const HANDS = Number(process.argv[5] ?? 5);
const TRAIN_PLAYERS = Number(process.argv[6] ?? 2);   // 训练人数(与评估口径一致更公平)
const KEY_MODE = (process.argv[7] ?? "tier") as "tier" | "equity";   // 强度特征:牌力档 or 精确胜率
const OUT = process.argv[8] ?? zeroBPath();
const KEY_OPTS = KEY_MODE === "equity" ? { equitySamples: 30 } : {};

function duel(a: Policy, b: Policy, seed: number, swap: boolean): number {
  const st = createGame(makeConfig({
    players: { startPoints: 20000 },
    endGame: { maxHands: HANDS, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }
  }), ["A", "B"], seed);
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
  const me = swap ? 1 : 0;
  return st.players[me].points - start[me];
}

function evaluate(table: ReturnType<typeof emptyTable>): number {
  const zb = makeZeroB(table, 0, KEY_OPTS);
  const sam = makeAgent("Sam");
  let sum = 0;
  for (let m = 0; m < MATCHES; m++) sum += duel(zb, sam, 500 + m, m % 2 === 1);
  return sum / MATCHES;
}

let table = loadZeroB(OUT) ?? emptyTable();
console.log("ZeroB 自对弈训练 — 起始:" + table.trainedHands + " 手 / " + Object.keys(table.q).length + " 状态  训练人数=" + TRAIN_PLAYERS + "  强度特征=" + KEY_MODE);
console.log("评估方式:与 Sam(标准规则型)单挑 " + MATCHES + " 场 × " + HANDS + " 局,数值 = ZeroB 平均净胜分");
console.log("\n代数  累计手数  状态数   探索率   vs Sam    用时");
for (let g = 1; g <= GENS; g++) {
  const t0 = Date.now();
  table = trainZeroB({
    hands: PER, seed: 9000 + g, table, players: TRAIN_PLAYERS, keyOpts: KEY_OPTS,
    epsFrom: Math.max(0.08, 0.45 - (g - 1) * 0.06),
    epsTo: 0.03
  });
  const score = evaluate(table);
  const eps = Math.max(0.08, 0.45 - (g - 1) * 0.06);
  console.log("  " + String(g).padStart(2) + "   " + String(table.trainedHands).padStart(7) + "  " +
    String(Object.keys(table.q).length).padStart(6) + "  " + eps.toFixed(2).padStart(6) + "  " +
    (score >= 0 ? "+" : "") + score.toFixed(0).padStart(6) + "   " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
  saveZeroB(table, OUT);
}
console.log("\n已保存到 " + OUT);
console.log("参考:Sam 基准 = 0 分;同规模测试里 Baozi(保守规则型)≈ +654,Brian(激进 MC)≈ +304(样本不同,仅看量级)");
