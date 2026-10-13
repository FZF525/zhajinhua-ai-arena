// 混合扫描:底注 × 阈值 的二维网格(默认 6 人局),找出"下注仍占大头 + 整场不太长"的配置
// 运行:node examples/mix-probe.ts [场数=20] [局数上限=400]
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { randomBot } from "../src/bot.ts";
import { createRng } from "../src/rng.ts";

const MATCHES = Number(process.argv[2] ?? 20);
const HAND_CAP = Number(process.argv[3] ?? 400);
const ANTES = [25, 50];
const THS = [22000, 25000];

for (const N of [2, 3, 4]) {
console.log(N + " 人局 / 初始 20000 / 上限 " + HAND_CAP + " 局 / 每格 " + MATCHES + " 场");
for (const ante of ANTES) {
  for (const th of THS) {
    const cfg = makeConfig({
      ante: { amount: ante, scaledByMultiplier: false },
      players: { min: 2, max: 6, handSize: 5, startPoints: 20000 },
      endGame: { bustAtOrBelow: 0, winAtOrAbove: th, winTakesPriorityOverBust: true, maxHands: HAND_CAP }
    });
    let done = 0, handsSum = 0, potSum = 0, potHands = 0;
    for (let g = 0; g < MATCHES; g++) {
      const names = Array.from({ length: N }, (_, i) => "P" + (i + 1));
      const st = createGame(cfg, names, g + 1);
      const rng = createRng((g + 1) * 7919);
      advance(st);
      let steps = 0;
      while (!st.gameOver && steps++ < 300000) {
        const a = randomBot(st, rng);
        if (!a) break;
        if (!apply(st, a).ok) break;
      }
      for (const e of st.events) if (e.kind === "HAND_SETTLED") { potSum += e.pot; potHands++; }
      if (st.handNo < HAND_CAP) { done++; handsSum += st.handNo; }
    }
    const pot = potSum / Math.max(1, potHands);
    const share = ((pot - N * ante) / pot) * 100;
    console.log("  底注 " + String(ante).padStart(3) + " + 阈值 " + th + " (差 " + (th - 20000) + "): 阈值收场 " +
      String(Math.round((done / MATCHES) * 100)).padStart(3) + "%" +
      (done ? "(均 " + (handsSum / done).toFixed(0) + " 局)" : "(未收场)      ") +
      " | 每局底池 " + pot.toFixed(0).padStart(4) + " | 下注占比 " + share.toFixed(0) + "%");
  }
}
}
