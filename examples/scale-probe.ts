// 整体等比缩放费用表:验证"等比放大费用 ≡ 等比缩小筹码",且机制权重不变
// 运行:node examples/scale-probe.ts [场数=20] [局数上限=400]
import { makeConfig, scaleEconomy } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { randomBot } from "../src/bot.ts";
import { createRng } from "../src/rng.ts";
import type { GameConfig } from "../src/config.ts";

const MATCHES = Number(process.argv[2] ?? 20);
const HAND_CAP = Number(process.argv[3] ?? 400);

function run(cfg: GameConfig, n: number): { done: number; avgHands: number; pot: number; anteShare: number; bettingShare: number } {
  let done = 0, handsSum = 0, potSum = 0, potHands = 0;
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
    for (const e of st.events) if (e.kind === "HAND_SETTLED") { potSum += e.pot; potHands++; }
    if (st.handNo < HAND_CAP) { done++; handsSum += st.handNo; }
  }
  const pot = potSum / Math.max(1, potHands);
  const antePart = n * cfg.ante.amount;
  return {
    done: Math.round((done / MATCHES) * 100),
    avgHands: done ? handsSum / done : 0,
    pot,
    anteShare: (antePart / pot) * 100,
    bettingShare: ((pot - antePart) / pot) * 100
  };
}

const base = makeConfig({
  players: { min: 2, max: 6, handSize: 5, startPoints: 20000 },
  endGame: { bustAtOrBelow: 0, winAtOrAbove: 40000, winTakesPriorityOverBust: true, maxHands: HAND_CAP }
});

console.log("A. 整体等比缩放费用表(初始 20000 / 阈值 40000 / 上限 " + HAND_CAP + " 局 / 每格 " + MATCHES + " 场)");
for (const k of [1, 2, 5, 10, 25]) {
  const cfg = scaleEconomy(base, k);
  let line = "  ×" + String(k).padStart(2) + " (底注 " + String(cfg.ante.amount).padStart(4) +
    " / 跟注 " + cfg.betting.seenRate + "·" + cfg.betting.blindRate +
    " / 换牌 " + cfg.exchange.fees.join("-") +
    " / 踢牌 " + String(cfg.kick.fee).padStart(4) + "):";
  for (const n of [3, 6]) {
    const r = run(cfg, n);
    line += "  " + n + "人 " + String(r.done).padStart(3) + "%" +
      (r.done ? "(均 " + r.avgHands.toFixed(0).padStart(3) + "局)" : "(打满)   ") +
      " 底池 " + r.pot.toFixed(0).padStart(5) + " 下注占 " + r.bettingShare.toFixed(0).padStart(3) + "%";
  }
  console.log(line);
}

console.log("\nB. 对照组:原始费用表 + 缩小筹码(应与 ×10 等价)");
for (const [sp, th] of [[20000, 40000], [2000, 4000], [800, 1600]] as Array<[number, number]>) {
  const cfg = makeConfig({
    players: { min: 2, max: 6, handSize: 5, startPoints: sp },
    endGame: { bustAtOrBelow: 0, winAtOrAbove: th, winTakesPriorityOverBust: true, maxHands: HAND_CAP }
  });
  let line = "  初始 " + String(sp).padStart(5) + " / 阈值 " + String(th).padStart(5) + ":";
  for (const n of [3, 6]) {
    const r = run(cfg, n);
    line += "  " + n + "人 " + String(r.done).padStart(3) + "%" +
      (r.done ? "(均 " + r.avgHands.toFixed(0).padStart(3) + "局)" : "(打满)   ") +
      " 底池 " + r.pot.toFixed(0).padStart(5) + " 下注占 " + r.bettingShare.toFixed(0).padStart(3) + "%";
  }
  console.log(line);
}
