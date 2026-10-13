// 统计牌局自然结束的轮次分布,判断 maxRounds 是否在打断真实牌局
// 运行:node examples/round-cap-probe.ts [局数=120] [maxRounds=16]
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { makeAgent } from "../src/ai/index.ts";

const HANDS = Number(process.argv[2] ?? 120);
const CAP = Number(process.argv[3] ?? 16);
const NAMES = ["EQB", "ZeroB", "Yeon", "Sam"];

const cfg = makeConfig({
  players: { startPoints: 20000 },
  betting: { maxRounds: CAP },
  endGame: { maxHands: 1e9, winAtOrAbove: 1e18, bustAtOrBelow: -1e18, winTakesPriorityOverBust: true }
});
const st = createGame(cfg, NAMES, 20260103);
advance(st);
const agents = NAMES.map(makeAgent);
const rng = createRng(31337);

const hist: Record<number, number> = {};
const reasons: Record<string, number> = {};
let played = 0, lastRound = 0, guard = 0;
let prevHand = st.handNo;
while (played < HANDS && !st.gameOver && guard++ < 200000) {
  if (st.phase !== "BETTING") { advance(st); continue; }
  const seat = st.turn.seat;
  if (seat === null) { advance(st); continue; }
  lastRound = st.betting.roundIndex;
  const a = agents[seat](st, rng);
  if (!a || !apply(st, a).ok) break;
  if (st.handNo !== prevHand) {
    const r = st.settlement?.reason ?? "?";
    hist[lastRound] = (hist[lastRound] ?? 0) + 1;
    reasons[r] = (reasons[r] ?? 0) + 1;
    played++; prevHand = st.handNo;
  }
}
const rounds = Object.keys(hist).map(Number).sort((a, b) => a - b);
const total = played;
console.log("=== 牌局自然结束的轮次分布(4 人局 " + NAMES.join("/") + ",上限 " + CAP + ")===");
console.log("局数 " + total + "  结束原因 " + JSON.stringify(reasons));
for (const r of rounds) {
  const bar = "#".repeat(Math.max(1, Math.round((hist[r] / total) * 50)));
  console.log("  第 " + String(r).padStart(2) + " 轮结束: " + String(hist[r]).padStart(4) + " 局 (" + ((hist[r] / total) * 100).toFixed(0).padStart(3) + "%) " + bar);
}
const cut8 = rounds.filter((r) => r >= 8).reduce((a, r) => a + hist[r], 0);
const cut16 = rounds.filter((r) => r >= 16).reduce((a, r) => a + hist[r], 0);
console.log("\n如果上限=8 :会被提前打断 " + cut8 + "/" + total + " 局 (" + ((cut8 / total) * 100).toFixed(1) + "%)");
console.log("如果上限=16:会被提前打断 " + cut16 + "/" + total + " 局 (" + ((cut16 / total) * 100).toFixed(1) + "%)");
