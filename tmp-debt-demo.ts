import { makeBalancedConfig, mergeConfig } from "./src/config.ts";
import { createGame, checkInvariants, isAlive } from "./src/state.ts";
import { apply, advance } from "./src/engine.ts";
import { legalActions } from "./src/validate.ts";
import { makeAgent } from "./src/ai/index.ts";
import { createRng } from "./src/rng.ts";

function run(debt: boolean) {
  const cfg = mergeConfig(makeBalancedConfig(3), {
    players: { startPoints: 200, allowDebt: debt },
    ante: { amount: 40 },
    endGame: { bustAtOrBelow: -5000, winAtOrAbove: 100000, maxHands: 4 },
  });
  const st = createGame(cfg, ["A", "B", "C"], 5);
  advance(st);
  const normal = ["EQB", "ZeroB", "Yeon"].map(makeAgent);
  const rng = createRng(77);
  let minPoints = Infinity, sawNegative = false, g = 0;
  while (!st.gameOver && g++ < 3000) {
    const seat = st.turn.seat;
    if (seat === null) break;
    // 座位 0 是"被迫跟注机器":只要能 CALL 就 CALL(这才可能把分打到负数)
    let a = null as ReturnType<(typeof normal)[number]> | null;
    if (seat === 0) {
      const legal = legalActions(st, 0).filter((x) => x.type === "CALL");
      a = legal.length ? legal[0] : { type: "FOLD", seat: 0 } as never;
      if (!legal.length) a = null;
    }
    if (!a) a = normal[seat](st, rng);
    if (!a) break;
    if (!apply(st, a).ok) break;
    for (const p of st.players) { minPoints = Math.min(minPoints, p.points); if (p.points < 0) sawNegative = true; }
  }
  return { debt, minPoints, sawNegative, points: st.players.map((p) => p.points), inv: checkInvariants(st), reason: st.settlement?.gameOverReason ?? "-", alive: st.players.filter(isAlive).length };
}

for (const debt of [false, true]) {
  const r = run(debt);
  console.log("allowDebt=" + debt + "  最终积分 " + r.points.join(" / ") + "   最低分 " + r.minPoints +
    "   出现负数: " + (r.sawNegative ? "是 ✓" : "否") + "   结束 " + r.reason + "   不变量 " + (r.inv.length ? "✗ " + r.inv.join(";") : "OK"));
}
