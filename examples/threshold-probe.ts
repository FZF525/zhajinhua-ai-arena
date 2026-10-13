// 阈值扫描:在初始 20000 下测不同阈值,看多少局能自然收场
// 运行:node examples/threshold-probe.ts [场数=20] [局数上限=400]
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { randomBot } from "../src/bot.ts";
import { createRng } from "../src/rng.ts";

const MATCHES = Number(process.argv[2] ?? 20);
const HAND_CAP = Number(process.argv[3] ?? 400);
const THRESHOLDS = [21000, 22000, 25000, 30000, 40000];
const NS = [3, 4, 6];

for (const th of THRESHOLDS) {
  const parts: string[] = [];
  for (const n of NS) {
    const cfg = makeConfig({
      players: { min: 2, max: 6, handSize: 5, startPoints: 20000 },
      endGame: { bustAtOrBelow: 0, winAtOrAbove: th, winTakesPriorityOverBust: true, maxHands: HAND_CAP }
    });
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
      if (st.handNo < HAND_CAP) { done++; handsSum += st.handNo; }
    }
    parts.push(n + "人 " + Math.round((done / MATCHES) * 100) + "%" + (done ? "(均 " + (handsSum / done).toFixed(0) + " 局)" : ""));
  }
  console.log("阈值 " + th + " (差 " + (th - 20000) + "): " + parts.join("  |  "));
}
