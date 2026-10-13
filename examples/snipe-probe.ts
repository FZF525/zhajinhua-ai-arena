// 量"M=1 早期比牌狙击"有多严重,以及把比牌费调贵后是否缓解
// 运行:node examples/snipe-probe.ts [每人局数=100]
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { makeAgent } from "../src/ai/index.ts";
import { describeEvent } from "../src/format.ts";

const HANDS = Number(process.argv[2] ?? 100);
const NAMES = ["EQB", "ZeroB", "Yeon", "Sam"];

function run(label: string, compareMul: number) {
  const cfg = makeConfig({
    players: { startPoints: 20000 },
    compare: { costMultiplier: compareMul },
    endGame: { maxHands: 1e9, winAtOrAbove: 1e18, bustAtOrBelow: -1e18, winTakesPriorityOverBust: true }
  });
  const st = createGame(cfg, NAMES, 20260102);
  advance(st);
  const agents = NAMES.map(makeAgent);
  const rng = createRng(555);

  let played = 0, endRoundSum = 0, m1 = 0, compares = 0, sniped = 0, potSum = 0, neverActedHands = 0;
  const winnerSeat = [0, 0, 0, 0];
  let acted = [false, false, false, false];
  let evMark = st.events.length;
  let prevHand = st.handNo;
  let lastRound = 0;
  let guard = 0;

  while (played < HANDS && !st.gameOver && guard++ < 200000) {
    if (st.phase !== "BETTING") { advance(st); continue; }
    const seat = st.turn.seat;
    if (seat === null) { advance(st); continue; }
    lastRound = st.betting.roundIndex;
    const a = agents[seat](st, rng);
    if (!a) break;
    acted[seat] = true;
    if (!apply(st, a).ok) break;                       // 默认 auto-advance,跨局自动发牌
    if (st.handNo !== prevHand) {                      // ── 一局结束 ──
      const evs = st.events.slice(evMark).map(describeEvent);
      compares += evs.filter((e) => e.startsWith("比牌")).length;
      endRoundSum += lastRound;
      if (lastRound <= 1) m1++;
      potSum += st.settlement?.pot ?? 0;
      const w = st.settlement?.winnerSeat;
      if (w !== undefined) winnerSeat[w]++;
      const na = acted.filter((x) => !x).length;
      if (na > 0) { neverActedHands++; if (evs.some((e) => e.startsWith("比牌"))) sniped += na; }
      played++;
      acted = [false, false, false, false];
      evMark = st.events.length;
      prevHand = st.handNo;
    }
  }
  const pct = (x: number) => ((x / Math.max(1, played)) * 100).toFixed(0).padStart(3) + "%";
  console.log(label + "(比牌费 ×" + compareMul + ")");
  console.log("   " + played + " 局 | 平均结束轮次 " + (endRoundSum / played).toFixed(2) + " | M=1 就结束 " + pct(m1) + " | 平均底池 " + (potSum / played).toFixed(1));
  console.log("   平均每局比牌 " + (compares / played).toFixed(2) + " 次 | 有人「整局没轮到」的局 " + pct(neverActedHands) + " | 其中因比牌出局 " + (sniped / played).toFixed(2) + " 人/局");
  console.log("   赢家座位分布  " + winnerSeat.map((v, i) => "座" + i + " " + pct(v)).join("  "));
}

console.log("=== 四人局(EQB/ZeroB/Yeon/Sam):早期比牌是不是太便宜?===");
console.log("");
run("默认配置", 2);
console.log("");
run("比牌费翻倍", 4);
