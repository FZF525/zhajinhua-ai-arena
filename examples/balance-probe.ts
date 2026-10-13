// 平衡性探测:在给定阈值/破产线/局数上限下,统计整场如何结束、需要多少局
// 运行:node examples/balance-probe.ts
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { randomBot } from "../src/bot.ts";
import { createRng } from "../src/rng.ts";

const MATCHES = Number(process.argv[2] ?? 200);
const HAND_CAP = Number(process.argv[3] ?? 400);
const START = Number(process.argv[4] ?? 20000);
const THRESHOLD = Number(process.argv[5] ?? 40000);

for (const n of [2, 3, 4, 6]) {
  const cfg = makeConfig({
    players: { min: 2, max: 6, handSize: 5, startPoints: START },
    endGame: { bustAtOrBelow: 0, winAtOrAbove: THRESHOLD, winTakesPriorityOverBust: true, maxHands: HAND_CAP }
  });
  let byThreshold = 0, byBust = 0, byCap = 0, potSum = 0, potHands = 0;
  const hands: number[] = [];
  const maxPts: number[] = [];
  for (let g = 0; g < MATCHES; g++) {
    const names = Array.from({ length: n }, (_, i) => "P" + (i + 1));
    const st = createGame(cfg, names, g + 1);
    const rng = createRng((g + 1) * 7919);
    advance(st);
    let steps = 0;
    while (!st.gameOver && steps++ < 200000) {
      const a = randomBot(st, rng);
      if (!a) break;
      if (!apply(st, a).ok) break;
    }
    hands.push(st.handNo);
    maxPts.push(Math.max(...st.players.map((p) => p.points)));
    for (const e of st.events) if (e.kind === "HAND_SETTLED") { potSum += e.pot; potHands++; }
    const reason = st.settlement?.gameOverReason;
    if (reason === "WIN_THRESHOLD" || reason === "BOTH") byThreshold++;
    else if (reason === "BUST") byBust++;
    else byCap++;
  }
  const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  const pct = (x: number) => ((x / MATCHES) * 100).toFixed(0) + "%";
  console.log("[初始 " + START + " / 阈值 " + THRESHOLD + "] " + n + " 人局:阈值 " + pct(byThreshold) + " | 破产 " + pct(byBust) + " | 打满 " + pct(byCap) +
    " | 平均 " + avg(hands) + " 局 | 结束最高积分 " + avg(maxPts) + " | 每局平均底池 " + avg([potSum / Math.max(1, potHands)]) + " 分");
}
