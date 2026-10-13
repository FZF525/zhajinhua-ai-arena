// 验证:不同人数要达到"约 40 局/场"所需的缩放系数 k
// 运行:node examples/k-by-players-probe.ts [场数=15] [局数上限=400]
import { makeConfig, scaleEconomy } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { randomBot } from "../src/bot.ts";
import { createRng } from "../src/rng.ts";

const MATCHES = Number(process.argv[2] ?? 15);
const HAND_CAP = Number(process.argv[3] ?? 400);
const CELLS: Array<[number, number]> = [[2, 40], [2, 50], [2, 70], [3, 25], [3, 40], [4, 25], [5, 16], [6, 10]];

for (const [n, k] of CELLS) {
  const cfg = scaleEconomy(makeConfig({
    players: { min: 2, max: 6, handSize: 5, startPoints: 20000 },
    endGame: { bustAtOrBelow: 0, winAtOrAbove: 40000, winTakesPriorityOverBust: true, maxHands: HAND_CAP }
  }), k);
  let done = 0, handsSum = 0;
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
    handsSum += st.handNo;
    if (st.handNo < HAND_CAP) done++;
  }
  console.log("  " + n + " 人 × k=" + String(k).padStart(2) + " (底注 " + String(cfg.ante.amount).padStart(2) + "): 收场率 " +
    String(Math.round((done / MATCHES) * 100)).padStart(3) + "% | 平均 " + (handsSum / MATCHES).toFixed(0).padStart(3) + " 局");
}
