// 比牌平衡探针:量化"狙击"(尤其"没看牌就被比掉")并对比几组规则
// 运行:node examples/compare-balance-probe.ts [每档场次=30] [人数=6] [每场局数=6]
import { makeBalancedConfig, mergeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { makeAgent } from "../src/ai/index.ts";

const MATCHES = Number(process.argv[2] ?? 30);
const PLAYERS = Number(process.argv[3] ?? 6);
const HANDS = Number(process.argv[4] ?? 6);
const NAMES = ["EQB", "ZeroB", "Yeon", "Brian", "Baozi", "Lucas"].slice(0, PLAYERS);

interface Variant { label: string; compare: Record<string, number> }
const VARIANTS: Variant[] = [
  { label: "基准(minRound 1 / 无保护 / 费×2)", compare: {} },
  { label: "保护未看牌者(1 轮)", compare: { blindTargetProtectRounds: 1 } },
  { label: "第 2 轮起才可比牌", compare: { minRound: 2 } },
  { label: "比牌费 ×3(6)", compare: { costMultiplier: 6 } },
  { label: "保护 + 费 ×3", compare: { blindTargetProtectRounds: 1, costMultiplier: 6 } },
];

function run(v: Variant) {
  let compares = 0, round1Compares = 0, snipes = 0, hands = 0, steps = 0;
  for (let m = 0; m < MATCHES; m++) {
    const cfg = mergeConfig(makeBalancedConfig(PLAYERS), {
      players: { startPoints: 20000 },
      endGame: { maxHands: HANDS, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true },
      ...(Object.keys(v.compare).length ? { compare: v.compare } : {}),
    });
    const st = createGame(cfg, NAMES, 4000 + m);
    const startHand = st.handNo;
    advance(st);
    const agents = NAMES.map(makeAgent);
    const rng = createRng(m * 31 + 11);
    const viewedSeen = NAMES.map(() => false);   // 按事件流重建"这个人看过牌没有"
    let g = 0;
    while (!st.gameOver && g++ < 40000) {
      const seat = st.turn.seat;
      if (seat === null) break;
      const a = agents[seat](st, rng);
      if (!a) break;
      const r = apply(st, a);
      if (!r.ok) break;
      steps++;
      for (const e of r.events) {
        if (e.kind === "HAND_VIEWED") viewedSeen[e.seat] = true;
        if (e.kind === "HAND_STARTED") viewedSeen.fill(false);
        if (e.kind === "COMPARED") {
          compares++;
          if (st.betting.roundIndex <= 1) round1Compares++;
          if (e.tie) continue;
          const loser = e.winnerSeat === e.aSeat ? e.bSeat : e.aSeat;
          if (!viewedSeen[loser]) snipes++;      // 输者整局没看过牌
        }
      }
    }
    hands += st.handNo - startHand;
  }
  return { compares, round1Compares, snipes, hands, steps };
}

console.log("=== 比牌平衡:" + MATCHES + " 场 × " + PLAYERS + " 人 × " + HANDS + " 局(全 AI,同一批种子)===");
console.log("每手平均: 比牌次数 / 其中第 1 轮 / **没看牌就被比掉** / 步数");
for (const v of VARIANTS) {
  const r = run(v);
  const per = (x: number) => (x / Math.max(1, r.hands)).toFixed(2).padStart(5);
  console.log("  " + v.label.padEnd(28) + "  " + per(r.compares) + " / " + per(r.round1Compares) + " / " +
    per(r.snipes) + " / " + per(r.steps) + "   (共 " + r.hands + " 手)");
}
console.log("");
console.log("读法:最后一列是'每手步数' —— 狙击越少,大家越会继续打,步数越多。");
