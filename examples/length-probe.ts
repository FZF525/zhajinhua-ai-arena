// 阈值差 → 场次长度 的实测对照(6 人自适应分场,全 AI 对局)
// 回答:想让一场打 N 手,阈值差该设多少?
// 运行:node examples/length-probe.ts [每个差值跑几场=20]
import { makeBalancedConfig, mergeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { makeAgent } from "../src/ai/index.ts";

const MATCHES = Number(process.argv[2] ?? 20);
const PLAYERS = Number(process.argv[3] ?? 6);
const NAMES = ["EQB", "ZeroB", "Yeon", "Brian", "Sam", "Lucas"].slice(0, PLAYERS);

function oneMatch(gap: number, seed: number): { hands: number; maxPot: number; reason: string } {
  const base = makeBalancedConfig(PLAYERS);
  const cfg = mergeConfig(base, { endGame: { winAtOrAbove: base.players.startPoints + gap, maxHands: 999 } });
  const st = createGame(cfg, NAMES, seed);
  advance(st);
  const agents = NAMES.map(makeAgent);
  const rng = createRng(seed * 7 + 3);
  let maxPot = 0, guard = 0;
  let lastSettled = -1;
  while (!st.gameOver && guard++ < 20000) {
    const seat = st.turn.seat;
    if (seat === null) break;
    const a = agents[seat](st, rng);
    if (!a) break;
    if (!apply(st, a).ok) break;
    // 只要出现"新结算"(局号变了 或 整场结束),就记这一局的池子(含最后一局)
    const settledHand = st.settlement ? st.handNo : -1;
    if (st.settlement && settledHand !== lastSettled && (st.handNo !== 0)) {
      maxPot = Math.max(maxPot, st.settlement.pot);
      lastSettled = settledHand;
    }
  }
  return { hands: st.handNo, maxPot, reason: st.settlement?.gameOverReason ?? "-" };
}

const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
console.log("=== " + PLAYERS + " 人自适应分场(k=" + makeBalancedConfig(PLAYERS).ante.amount + " 底注),每档 " + MATCHES + " 场 ===");
console.log("阈值差(胜利阈值 − 初始积分) → 场次长度 / 单局最大池");
const rows: string[] = [];
for (const gap of [500, 1000, 2000, 5000, 10000, 20000]) {
  const hands: number[] = [], pots: number[] = [];
  const reasons: Record<string, number> = {};
  for (let m = 0; m < MATCHES; m++) {
    const r = oneMatch(gap, 3000 + m);
    hands.push(r.hands); pots.push(r.maxPot);
    reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  }
  const mh = median(hands), mp = median(pots);
  rows.push("  差 " + String(gap).padStart(6) + " → 中位 " + String(mh).padStart(3) + " 手 (范围 " + Math.min(...hands) + "~" + Math.max(...hands) + ")" +
    "   单局最大池中位 " + Math.round(mp) + "  = 差值的 " + ((mp / gap) * 100).toFixed(0) + "%   结束原因 " + JSON.stringify(reasons));
}
for (const r of rows) console.log(r);
console.log("\n读法:阈值差与场次长度**强依赖注码刻度**(人数/分场),不要脱离刻度引用;上面的表就是 6 人自适应下的对照。");
console.log("机制:一局能赢到的钱 ≈ 该桌单局池子的量级,所以『单局典型池 ÷ 阈值差』越大,一场越短。");
