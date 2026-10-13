// 最小用法:建局 → 手动逐步推进 → 读取状态
// 运行:node examples/quickstart.ts
import { makeConfig } from "../src/config.ts";
import { createGame, player, aliveSeats } from "../src/state.ts";
import type { Action, GameEvent } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { legalActions } from "../src/validate.ts";
import { cardText, handText } from "../src/cards.ts";
import { evaluate, describe } from "../src/evaluator.ts";

const game = createGame(makeConfig({ players: { startPoints: 20000 } }), ["甲", "乙"], 2024);

// 统一入口:apply(state, action) 返回 { ok, events, error };非法动作不改变状态
const run = (a: Action): GameEvent[] => {
  const r = apply(game, a);
  if (!r.ok) throw new Error(a.type + " 被拒绝: " + r.error!.code + " " + r.error!.message);
  return r.events;
};
const betOf = (evs: GameEvent[]): number => {
  const e = evs.find((x) => x.kind === "BET");
  return e && e.kind === "BET" ? e.amount : 0;
};

// 1) 底注 / 发牌 / 翻公共池由 advance() 自动推进
advance(game);
console.log("公共池 :", game.pool.map(cardText).join(" "));
console.log("甲的手牌:", handText(player(game, 0).hand), "(乙是闷牌,引擎不向他泄露)");

// 2) 谁先行动由庄家位决定,不要写死座位号
const first = game.turn.seat!;
const second = aliveSeats(game).find((s) => s !== first)!;
console.log("\n首家 = 座位", first, "| 可用动作:", legalActions(game).join("/"));

// 3) 看牌 → 跟注(看牌免费、不可逆;跟注 2×M)
const view = run({ type: "VIEW_HAND", seat: first });
const c1 = run({ type: "CALL", seat: first });
console.log("甲" + (view.length ? "看牌" : "") + "后跟注 " + betOf(c1) + " 分,底池 " + game.pot);

// 4) 闷牌者跟注:费率减半(1×M),且不能换牌/截胡
const c2 = run({ type: "CALL", seat: second });
console.log("乙闷牌跟注 " + betOf(c2) + " 分,底池 " + game.pot);

// 5) 一轮结束 → 回到首家;此刻可以换牌(换入公共池 1 张,放回手牌 1 张)
console.log("\n第 " + game.betting.roundIndex + " 个下注轮,轮到座位 " + game.turn.seat + " 可用: " + legalActions(game).join("/"));
const me = player(game, first);
const ex = run({ type: "EXCHANGE", seat: first, takeCardId: game.pool[0].id, giveCardId: me.hand[0].id });
console.log("换牌事件: " + ex.map((e) => e.kind).join(",") + " → " + handText(me.hand) + " = " + describe(evaluate(me.hand)));
console.log("公共池仍为 " + game.pool.length + " 张(进一张出一张)");

// 6) 比牌:输者弃牌退场;只剩 1 人时本局立即结算
const cmp = run({ type: "COMPARE", seat: first, targetSeat: second });
const ev = cmp.find((e) => e.kind === "COMPARED");
console.log("\n比牌: " + (ev && ev.kind === "COMPARED" ? (ev.tie ? "平局,双方继续" : "座位 " + ev.winnerSeat + " 胜") : "-"));
console.log("阶段:", game.phase, "| 甲", player(game, 0).points, "| 乙", player(game, 1).points);
if (game.settlement) console.log("上一局结算: " + game.settlement.reason + " 底池 " + game.settlement.pot + " → 赢家 " + game.settlement.winners.join(","));
