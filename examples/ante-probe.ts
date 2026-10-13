// 底注扫描:ante ∈ {1,2,5,10} × 人数 {2,3,4,6},在 20000/40000 下各跑 N 场
// 运行:node examples/ante-probe.ts [场数=30] [局数上限=400] [底注...](默认 1 2 5 10)
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { randomBot } from "../src/bot.ts";
import { createRng } from "../src/rng.ts";

const MATCHES = Number(process.argv[2] ?? 30);
const HAND_CAP = Number(process.argv[3] ?? 400);
const ANTES = process.argv.slice(4).map(Number).filter((x) => Number.isFinite(x) && x > 0);
const LIST = ANTES.length ? ANTES : [1, 2, 5, 10];
const NS = [2, 3, 4, 6];

type Row = { n: number; threshold: number; bust: number; cap: number; hands: number[]; maxPts: number[]; pots: number[] };

for (const ante of LIST) {
  const rows: Row[] = [];
  for (const n of NS) {
    const cfg = makeConfig({
      ante: { amount: ante, scaledByMultiplier: false },
      players: { min: 2, max: 6, handSize: 5, startPoints: 20000 },
      endGame: { bustAtOrBelow: 0, winAtOrAbove: 40000, winTakesPriorityOverBust: true, maxHands: HAND_CAP }
    });
    const row: Row = { n, threshold: 0, bust: 0, cap: 0, hands: [], maxPts: [], pots: [] };
    for (let g = 0; g < MATCHES; g++) {
      const names = Array.from({ length: n }, (_, i) => "P" + (i + 1));
      const st = createGame(cfg, names, g + 1);
      const rng = createRng((g + 1) * 7919);
      advance(st);
      let steps = 0;
      while (!st.gameOver && steps++ < 300000) {
        const a = randomBot(st, rng);
        if (!a) break;
        if (!apply(st, a).ok) break;
      }
      row.hands.push(st.handNo);
      row.maxPts.push(Math.max(...st.players.map((p) => p.points)));
      for (const e of st.events) if (e.kind === "HAND_SETTLED") row.pots.push(e.pot);
      const reason = st.settlement?.gameOverReason;
      if (reason === "WIN_THRESHOLD" || reason === "BOTH") row.threshold++;
      else if (reason === "BUST") row.bust++;
      else row.cap++;
    }
    rows.push(row);
  }
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (x: number) => Math.round((x / MATCHES) * 100) + "%";
  console.log("=== 底注 " + ante + " 分(" + MATCHES + " 场/格,上限 " + HAND_CAP + " 局)===");
  for (const r of rows) {
    console.log("  " + r.n + " 人局: 阈值 " + pct(r.threshold).padEnd(4) + " | 破产 " + pct(r.bust).padEnd(4) +
      " | 打满 " + pct(r.cap).padEnd(4) +
      " | 平均 " + avg(r.hands).toFixed(0).padStart(5) + " 局" +
      " | 最高积分 " + avg(r.maxPts).toFixed(0).padStart(6) +
      " | 每局底池 " + avg(r.pots).toFixed(0).padStart(4) + " 分");
  }
}
