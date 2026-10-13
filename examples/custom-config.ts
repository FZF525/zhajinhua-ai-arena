// 配置化 + 批量模拟:换一套数值跑 200 局,统计事件分布
// 运行:node examples/custom-config.ts
import { makeConfig } from "../src/config.ts";
import { createGame, checkInvariants } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { randomBot } from "../src/bot.ts";
import { createRng } from "../src/rng.ts";

// 旧稿预设:初始 8000 / 阈值 16000;阶梯只到 M=8;封顶后再打 3 轮
const cfg = makeConfig({
  players: { min: 2, max: 6, handSize: 5, startPoints: 8000 },
  endGame: { bustAtOrBelow: 0, winAtOrAbove: 16000, winTakesPriorityOverBust: true },
  betting: { ladder: [2, 4, 8], postCapRoundsToShowdown: 3 },
  compare: { blindMinBettingRounds: 2 },
  kick: { maxPerHand: 1, fee: 8, requireNeverSelected: true }
});

const stat = { matches: 0, hands: 0, actions: 0, intercept: 0, kick: 0, compare: 0, tie: 0, showdown: 0, gameOver: 0 };
for (let g = 0; g < 200; g++) {
  const n = 2 + (g % 5);
  const names = Array.from({ length: n }, (_, i) => "P" + (i + 1));
  const st = createGame(cfg, names, g + 1);
  const total0 = st.players.reduce((s, p) => s + p.points, 0);
  const rng = createRng((g + 1) * 7919);
  advance(st);
  stat.matches++;
  let steps = 0;
  while (!st.gameOver && steps++ < 20000) {
    const a = randomBot(st, rng);
    if (!a) break;
    const r = apply(st, a);
    if (!r.ok) throw new Error("非法动作 " + a.type + " " + r.error!.code);
    const bad = checkInvariants(st);
    if (bad.length) throw new Error("不变量违规: " + bad.join("; "));
    const total = st.players.reduce((s, p) => s + p.points, 0) + st.pot + st.carryPot;
    if (total !== total0) throw new Error("积分不守恒");
    stat.actions++;
  }
  if (st.gameOver) stat.gameOver++;
  stat.hands += st.handNo;
  stat.intercept += st.events.filter((e) => e.kind === "INTERCEPTED").length;
  stat.kick += st.events.filter((e) => e.kind === "KICKED").length;
  stat.compare += st.events.filter((e) => e.kind === "COMPARED").length;
  stat.tie += st.events.filter((e) => e.kind === "TIE_RECORDED").length;
  stat.showdown += st.events.filter((e) => e.kind === "SHOWDOWN").length;
}

console.log("配置:", "初始", cfg.players.startPoints, "阈值", cfg.endGame.winAtOrAbove, "阶梯", cfg.betting.ladder.join("/"), "封顶后轮数", cfg.betting.postCapRoundsToShowdown);
console.log("跑了", stat.matches, "场、", stat.hands, "局牌、", stat.actions, "次动作;整场结束", stat.gameOver, "场");
console.log("截胡", stat.intercept, "| 踢牌", stat.kick, "| 比牌", stat.compare, "(平局", stat.tie + ")", "| 摊牌", stat.showdown);
console.log("积分守恒与不变量全程通过。");
if (stat.gameOver === 0) {
  console.log("\n提示:这 200 场里没有一场走到终局 —— 相对筹码总量,阈值/破产条件非常苛刻(详见 README「平衡性提示」)。");
}
