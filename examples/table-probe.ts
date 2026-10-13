// 两个"分场"档位实测:×10(小分场) / ×25(大分场),各人数分别看收场方式与局数
// 运行:node examples/table-probe.ts [场数=20] [局数上限=400]
import { makeConfig, scaleEconomy } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { randomBot } from "../src/bot.ts";
import { createRng } from "../src/rng.ts";

const MATCHES = Number(process.argv[2] ?? 20);
const HAND_CAP = Number(process.argv[3] ?? 400);
const base = makeConfig({
  players: { min: 2, max: 6, handSize: 5, startPoints: 20000 },
  endGame: { bustAtOrBelow: 0, winAtOrAbove: 40000, winTakesPriorityOverBust: true, maxHands: HAND_CAP }
});

for (const k of [10, 25]) {
  const cfg = scaleEconomy(base, k);
  console.log("=== ×" + k + " 分场(底注 " + cfg.ante.amount + " / 跟注 " + cfg.betting.seenRate + "·" + cfg.betting.blindRate +
    " / 换牌 " + cfg.exchange.fees.join("-") + " / 踢牌 " + cfg.kick.fee + ")===");
  for (const n of [2, 3, 4, 5, 6]) {
    let th = 0, bust = 0, cap = 0, handsSum = 0, potSum = 0, potHands = 0, maxPtsSum = 0;
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
      maxPtsSum += Math.max(...st.players.map((p) => p.points));
      const reason = st.settlement?.gameOverReason;
      if (st.handNo >= HAND_CAP) cap++;
      else if (reason === "BUST") bust++;
      else th++;
      handsSum += st.handNo;
    }
    const pct = (x: number) => String(Math.round((x / MATCHES) * 100)).padStart(3) + "%";
    const pot = potSum / Math.max(1, potHands);
    console.log("  " + n + " 人: 阈值 " + pct(th) + " | 破产 " + pct(bust) + " | 打满 " + pct(cap) +
      " | 均 " + (handsSum / MATCHES).toFixed(0).padStart(3) + " 局 | 底池 " + pot.toFixed(0).padStart(5) +
      " | 下注占 " + (((pot - n * cfg.ante.amount) / pot) * 100).toFixed(0).padStart(3) + "%" +
      " | 结束最高分 " + (maxPtsSum / MATCHES).toFixed(0));
  }
}
