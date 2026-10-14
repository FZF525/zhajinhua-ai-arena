// 引擎端到端用例:换牌 / 截胡链 / 踢牌封锁轮 / 下注 / 比牌平局 / 结算终局 / 不变量与守恒
import test from "node:test";
import assert from "node:assert/strict";
import { makeConfig, makeBalancedConfig, mergeConfig } from "../src/config.ts";
import { createGame, aliveSeats, isAlive, player, blockadeRipe, checkInvariants, nextAliveSeat } from "../src/state.ts";
import type { Action, GameState } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { legalActions } from "../src/validate.ts";
import { makeAgent } from "../src/ai/index.ts";
import { createRng } from "../src/rng.ts";
import { cardsFromIds } from "../src/cards.ts";

const NO_END = { endGame: { bustAtOrBelow: -1, winAtOrAbove: 10 ** 12, winTakesPriorityOverBust: true, maxHands: null } };

function setup(names = ["A", "B", "C"], patch?: unknown, seed = 1): GameState {
  const st = createGame(makeConfig({ ...NO_END, ...(patch as object ?? {}) }), names, seed);
  advance(st);
  return st;
}
function ok(st: GameState, a: Action) {
  const r = apply(st, a);
  assert.equal(r.ok, true, "动作应成功 " + a.type + " → " + (r.error ? r.error.code + " " + r.error.message : ""));
  return r;
}
function bad(st: GameState, a: Action, code: string) {
  const r = apply(st, a);
  assert.equal(r.ok, false, "动作应失败 " + a.type);
  assert.equal(r.error!.code, code, a.type + " 期望 " + code + " 实得 " + r.error!.code);
}
function faceUpPool(st: GameState) {
  return st.pool.filter((c) => st.poolMeta[c.id].faceUp).map((c) => c.id);
}
function inv(st: GameState) {
  const v = checkInvariants(st);
  assert.deepEqual(v, [], "不变量违规:" + v.join("; "));
}
const TIE_HAND_A = ["HEART-A", "SPADE-K", "DIAMOND-9", "CLUB-5", "HEART-2"];
const TIE_HAND_B = ["STAR-A", "MOON-K", "SNOW-9", "DROPLET-5", "CLUB-2"];
/** 让所有存活玩家各看牌 + 跟注一次,推进到下一个下注轮(期间不会弃牌) */
function passRound(st: GameState) {
  const round = st.betting.roundIndex;
  let guard = 0;
  while (st.phase === "BETTING" && st.betting.roundIndex === round && guard++ < 20) {
    const s = st.turn.seat!;
    if (player(st, s).blind) ok(st, { type: "VIEW_HAND", seat: s });
    if (st.betting.roundIndex !== round || st.phase !== "BETTING") break;
    ok(st, { type: "CALL", seat: s });
  }
}

function forceTie(st: GameState, a: number, b: number) {
  player(st, a).hand = cardsFromIds(TIE_HAND_A);
  player(st, b).hand = cardsFromIds(TIE_HAND_B);
}

test("E2E-01 发牌:公共池 7 张、每人 5 张、底注进底池", () => {
  const st = setup();
  assert.equal(st.pool.length, 7);
  assert.equal(st.deck.length, 104 - 5 * 3 - 7);
  for (const p of st.players) assert.equal(p.hand.length, 5);
  assert.equal(st.pot, 3);
  assert.equal(st.betting.roundIndex, 1);
  inv(st);
});

test("E2E-02 闷牌下注 1×M,看牌后 2×M(并校验 BET 事件金额)", () => {
  const st = setup(["A", "B"]);
  const s1 = st.turn.seat!;
  assert.equal(player(st, s1).blind, true);
  const e1 = ok(st, { type: "CALL", seat: s1 }).events.find((x) => x.kind === "BET");
  assert.ok(e1 && e1.kind === "BET", "必须发出 BET 事件");
  assert.equal(e1!.kind === "BET" ? e1!.amount : -1, 1, "闷牌跟注 1×M");
  assert.equal(st.pot, 3);
  const s2 = st.turn.seat!;
  ok(st, { type: "VIEW_HAND", seat: s2 });
  assert.equal(player(st, s2).blind, false);
  const e2 = ok(st, { type: "CALL", seat: s2 }).events.find((x) => x.kind === "BET");
  assert.equal(e2 && e2.kind === "BET" ? e2.amount : -1, 2, "看牌跟注 2×M");
  const raiser = st.turn.seat!;
  const expectedRaise = (player(st, raiser).blind ? st.config.betting.blindRate : st.config.betting.seenRate) * 2;
  const e3 = ok(st, { type: "RAISE", seat: raiser, toMultiplier: 2 }).events.find((x) => x.kind === "BET");
  assert.equal(e3 && e3.kind === "BET" ? e3.betKind : "", "RAISE");
  assert.equal(e3 && e3.kind === "BET" ? e3.amount : -1, expectedRaise, "加注按新档 M=2 计费");
  assert.equal(st.multiplier, 2);
  assert.equal(st.pot, 3 + 2 + expectedRaise);
  inv(st);
});

test("E2E-03 换牌:1×M、池恒 7、手牌恒 5、开出截胡窗口", () => {
  const st = setup();
  const seat = st.turn.seat!;
  ok(st, { type: "VIEW_HAND", seat });
  const take = st.pool[0].id, give = player(st, seat).hand[0].id;
  ok(st, { type: "EXCHANGE", seat, takeCardId: take, giveCardId: give });
  assert.equal(st.pot, 4);
  assert.equal(st.pool.length, 7);
  assert.equal(player(st, seat).hand.length, 5);
  // v1.6:换牌只挂起"待截胡",不再打断回合;紧邻下家仍可在自己回合先看牌再截
  assert.equal(st.pendingIntercept?.cardId, take);
  assert.equal(st.pendingIntercept?.candidateSeat, nextAliveSeat(st, seat));
  assert.equal(st.turn.seat, seat, "换牌是辅助动作,回合不转移");
  assert.ok(st.events.some((e) => e.kind === "INTERCEPT_OFFERED"));
  assert.ok(player(st, seat).hand.some((c) => c.id === take));
  inv(st);
});

test("E2E-04 截胡:换牌后挂起,到下家的回合内执行,付 原换牌费+2M", () => {
  const st = setup();
  passRound(st);                       // 三人均已看牌
  const a = st.turn.seat!;
  const b = nextAliveSeat(st, a);
  const take = st.pool[0].id;
  ok(st, { type: "EXCHANGE", seat: a, takeCardId: take, giveCardId: player(st, a).hand[0].id });
  assert.equal(st.pendingIntercept?.cardId, take, "换牌后挂起待截胡");
  assert.equal(st.pendingIntercept?.candidateSeat, b);
  assert.equal(st.pendingIntercept?.n, 1);
  // 换牌者回合还没结束:别人不能插队
  bad(st, { type: "INTERCEPT", seat: b, giveCardId: player(st, b).hand[0].id }, "ERR_NOT_YOUR_TURN");
  ok(st, { type: "CALL", seat: a });                  // 换牌者继续主决策 → 轮到下家
  assert.equal(st.turn.seat, b);
  assert.ok(legalActions(st).includes("INTERCEPT"), "下家回合内应可截胡");
  const before = st.pot;
  const fee = st.poolMeta[take].swapFeePaid;
  ok(st, { type: "INTERCEPT", seat: b, giveCardId: player(st, b).hand[0].id });
  assert.equal(st.pot, before + fee + 1 * (1 + 1) * st.multiplier, "截胡费 = 原换牌费 + n(n+1)M");
  assert.equal(st.interceptTotalThisHand, 1);
  assert.equal(st.poolMeta[take].interceptCount, 1);
  assert.ok(player(st, b).hand.some((c) => c.id === take), "目标牌归截胡者");
  // 被截者立即收下对方放回的牌:手牌 5、池 7 当场恢复
  assert.equal(player(st, a).hand.length, 5);
  assert.equal(st.pool.length, 7);
  inv(st);
});

test("E2E-05 截胡限制:只能紧邻下家;放弃或过回合后作废", () => {
  const st = setup();
  passRound(st);
  const a = st.turn.seat!;
  const b = nextAliveSeat(st, a);
  const c = aliveSeats(st).find((s) => s !== a && s !== b)!;
  ok(st, { type: "EXCHANGE", seat: a, takeCardId: st.pool[0].id, giveCardId: player(st, a).hand[0].id });
  ok(st, { type: "CALL", seat: a });
  assert.equal(st.turn.seat, b);
  bad(st, { type: "INTERCEPT", seat: c, giveCardId: player(st, c).hand[0].id }, "ERR_NOT_YOUR_TURN");
  // 候选者明确放弃 → 记录清除,之后谁也截不了
  ok(st, { type: "DECLINE_INTERCEPT", seat: b });
  assert.equal(st.pendingIntercept, null);
  bad(st, { type: "INTERCEPT", seat: b, giveCardId: player(st, b).hand[0].id }, "ERR_NO_INTERCEPT_WINDOW");
  inv(st);
});

test("E2E-05c 待截胡会随候选者回合结束而作废(不截即过期)", () => {
  const st = setup();
  passRound(st);
  const a = st.turn.seat!;
  const b = nextAliveSeat(st, a);
  ok(st, { type: "EXCHANGE", seat: a, takeCardId: st.pool[0].id, giveCardId: player(st, a).hand[0].id });
  assert.ok(st.pendingIntercept);
  ok(st, { type: "CALL", seat: a });                   // 轮到 b
  ok(st, { type: "CALL", seat: b });                   // b 没截,回合结束
  assert.equal(st.pendingIntercept, null, "过回合即作废");
  assert.ok(st.events.some((e) => e.kind === "INTERCEPT_EXPIRED"));
  inv(st);
});

test("E2E-05b 第 1 轮也能截胡:闷牌下家先看牌,再截(旧版这里是死路)", () => {
  const st = setup();
  const a = st.turn.seat!;
  const b = nextAliveSeat(st, a);
  ok(st, { type: "VIEW_HAND", seat: a });
  ok(st, { type: "EXCHANGE", seat: a, takeCardId: st.pool[0].id, giveCardId: player(st, a).hand[0].id });
  assert.ok(st.pendingIntercept, "第 1 轮也挂起待截胡(不再因下家闷牌而关闭)");
  ok(st, { type: "CALL", seat: a });
  assert.equal(st.turn.seat, b);
  assert.equal(player(st, b).blind, true);
  assert.ok(!legalActions(st).includes("INTERCEPT"), "闷牌时截胡不可选");
  ok(st, { type: "VIEW_HAND", seat: b });              // 先看牌
  assert.ok(legalActions(st).includes("INTERCEPT"), "看牌后即可截");
  ok(st, { type: "INTERCEPT", seat: b, giveCardId: player(st, b).hand[0].id });
  assert.equal(st.interceptTotalThisHand, 1, "截胡计数 +1");
  inv(st);
});

test("E2E-06 闷牌禁止换牌 / 积分不足不能下注", () => {
  const st = setup(["A", "B"]);
  const seat = st.turn.seat!;
  bad(st, { type: "EXCHANGE", seat, takeCardId: st.pool[0].id, giveCardId: player(st, seat).hand[0].id }, "ERR_BLIND_CANNOT_EXCHANGE");
  const poor = setup(["A", "B"], { players: { min: 2, max: 6, handSize: 5, startPoints: 1 } });
  assert.ok(!legalActions(poor).includes("CALL"), "1 分玩家付不起跟注时不应出现 CALL");
  assert.ok(legalActions(poor).includes("FOLD"), "付不起跟注时唯一主决策是弃牌");
  inv(st);
});

test("E2E-07 踢牌:8×M、目标出局、补入暗牌、他人不可选取", () => {
  const st = setup();
  const seat = st.turn.seat!;
  const target = st.pool[0].id;
  ok(st, { type: "KICK", seat, targetCardId: target });
  assert.equal(st.pot, 11);
  assert.equal(player(st, seat).kickUsed, true);
  const blocked = st.blockades[0];
  assert.equal(st.poolMeta[blocked.cardId].faceUp, false);
  assert.equal(blockadeRipe(st, blocked), false);
  assert.ok(st.kicked.some((c) => c.id === target));
  ok(st, { type: "CALL", seat });
  const other = st.turn.seat!;
  assert.notEqual(other, seat);
  ok(st, { type: "VIEW_HAND", seat: other });
  bad(st, { type: "EXCHANGE", seat: other, takeCardId: blocked.cardId, giveCardId: player(st, other).hand[0].id }, "ERR_CARD_BLOCKADED");
  bad(st, { type: "TAKE_BLOCKED", seat, giveCardId: player(st, seat).hand[0].id }, "ERR_NOT_YOUR_TURN");
  inv(st);
});

test("E2E-08 封锁轮收束:踢牌者下一次行动可换走暗牌(付费 / 失闷 / 不可截)", () => {
  const st = setup(["A", "B"]);
  const seat = st.turn.seat!;
  ok(st, { type: "KICK", seat, targetCardId: st.pool[0].id });
  const blocked = st.blockades[0];
  ok(st, { type: "CALL", seat });
  ok(st, { type: "CALL", seat: st.turn.seat! });      // 下家行动一次 → 封锁轮收束
  assert.equal(st.turn.seat, seat, "2 人局下家行动后应回到踢牌者");
  assert.equal(blockadeRipe(st, blocked), true, "踢牌者再次行动即封锁轮结束");
  assert.ok(legalActions(st).includes("TAKE_BLOCKED"));
  const potBefore = st.pot;
  ok(st, { type: "TAKE_BLOCKED", seat, giveCardId: player(st, seat).hand[0].id });
  assert.equal(st.pot, potBefore + 1 * st.multiplier);
  assert.ok(player(st, seat).hand.some((c) => c.id === blocked.cardId));
  assert.equal(st.poolMeta[blocked.cardId].uninterceptable, true);
  assert.equal(player(st, seat).blind, false);
  assert.equal(st.blockades[0].resolvedByKicker, true);
  assert.equal(player(st, seat).hand.length, 5);
  assert.equal(st.pool.length, 7);
  inv(st);
});

test("E2E-09 比牌:费用 2×rate×M、输者弃牌退场", () => {
  const st = setup(["A", "B", "C"]);
  const seat = st.turn.seat!;
  const target = aliveSeats(st).find((s) => s !== seat)!;
  ok(st, { type: "VIEW_HAND", seat });
  const potBefore = st.pot;
  ok(st, { type: "COMPARE", seat, targetSeat: target });
  assert.equal(st.pot, potBefore + 4);
  if (st.compareTies.length === 0) {
    const loser = isAlive(player(st, seat)) ? target : seat;
    assert.equal(player(st, loser).folded, true);
  }
});

test("E2E-10 盲比门槛:前 3 轮禁止,第 4 轮起允许且不解除闷牌", () => {
  const st = setup(["A", "B"]);
  const seat = st.turn.seat!;
  const target = aliveSeats(st).find((s) => s !== seat)!;
  bad(st, { type: "COMPARE", seat, targetSeat: target }, "ERR_BLIND_COMPARE_TOO_EARLY");
  st.betting.roundIndex = 4;
  ok(st, { type: "COMPARE", seat, targetSeat: target });
  assert.equal(player(st, seat).blind, true);
});

test("E2E-11 两人平局 → 双方都不出局 → 只剩平局者 → 本局结束并均分底池", () => {
  const st = setup(["A", "B"]);
  const seat = st.turn.seat!;
  const target = aliveSeats(st).find((s) => s !== seat)!;
  void target;
  forceTie(st, seat, target);
  player(st, seat).blind = false;
  st.betting.roundIndex = 4;
  const totalBefore = st.players.reduce((a, p) => a + p.points, 0) + st.pot;
  const potBefore = st.pot;
  ok(st, { type: "COMPARE", seat, targetSeat: target });
  assert.equal(st.settlement?.reason, "TIE_COMPONENT", "平局后只剩平局者 → 结束均分");
  assert.deepEqual(st.settlement!.winners, [0, 1]);
  assert.equal(st.settlement!.pot, potBefore + 4);
  const totalAfter = st.players.reduce((a, p) => a + p.points, 0) + st.pot + st.carryPot;
  assert.equal(totalAfter, totalBefore);
});

test("E2E-12 三人局:A-B 平局后 C 弃牌 → 只剩平局者 → 结束均分", () => {
  const st = setup(["A", "B", "C"]);
  const seat = st.turn.seat!;
  const others = aliveSeats(st).filter((s) => s !== seat);
  const target = others[0];
  const third = others[1];
  forceTie(st, seat, target);
  player(st, seat).blind = false;
  st.betting.roundIndex = 4;
  ok(st, { type: "COMPARE", seat, targetSeat: target });   // 平局,双方都在局中
  assert.equal(st.compareTies.length, 1);
  while (st.phase === "BETTING" && aliveSeats(st).length > 2) {
    const cur = st.turn.seat!;
    apply(st, { type: "FOLD", seat: cur });
  }
  if (st.settlement) {
    assert.ok(["TIE_COMPONENT", "LAST_STANDING"].includes(st.settlement.reason));
    if (st.settlement.reason === "TIE_COMPONENT") assert.deepEqual(st.settlement.winners.slice().sort(), [seat, target].sort());
  }
  inv(st);
});

test("E2E-13 M 封顶后再打满 2 个下注轮 → 强制摊牌(封顶当轮不计入)", () => {
  const st = setup(["A", "B"], { players: { min: 2, max: 6, handSize: 5, startPoints: 100000 } });
  ok(st, { type: "VIEW_HAND", seat: st.turn.seat! });
  for (const m of [2, 4, 8, 16, 32]) {
    const cur = st.turn.seat!;
    if (player(st, cur).blind) ok(st, { type: "VIEW_HAND", seat: cur });
    ok(st, { type: "RAISE", seat: cur, toMultiplier: m });
  }
  assert.equal(st.multiplier, 32);
  assert.equal(st.betting.capReached, true);
  bad(st, { type: "RAISE", seat: st.turn.seat!, toMultiplier: 64 }, "ERR_RAISE_OVER_CAP");
  const callsPerRound = aliveSeats(st).length;
  // 封顶当轮收尾
  ok(st, { type: "CALL", seat: st.turn.seat! });
  assert.equal(st.betting.postCapRoundsPlayed, 0, "封顶当轮不计入");
  for (let r = 0; r < callsPerRound * 2; r++) {
    if (st.phase !== "BETTING") break;
    ok(st, { type: "CALL", seat: st.turn.seat! });
  }
  assert.ok(st.settlement, "应有结算结果");
  assert.equal(st.settlement!.reason, "SHOWDOWN");
  assert.equal(st.settlement!.showdown, true);
});

test("E2E-14 守恒 + 不变量 fuzz:随机合法动作直到终局", () => {
  for (let seed = 1; seed <= 15; seed++) {
    const names = ["A", "B", "C", "D"].slice(0, 2 + (seed % 3));
    const st = setup(names, undefined, seed);
    const startPoints = names.length * st.config.players.startPoints;
    const rng = createRng(seed * 7919);
    let steps = 0;
    while (!st.gameOver && steps++ < 3000) {
      const res = stepRandom(st, rng);
      assert.ok(res.ok, "seed " + seed + " step " + steps + " 动作被拒: " + res.tried + " → " + res.error);
      if (st.phase === "GAME_OVER" && !st.gameOver) break;
      const total = st.players.reduce((a, p) => a + p.points, 0) + st.pot + st.carryPot;
      assert.equal(total, startPoints, "seed " + seed + " 积分不守恒 @" + steps);
      const v = checkInvariants(st);
      assert.deepEqual(v, [], "seed " + seed + " 不变量 @" + steps + ": " + v.join("; "));
    }
    assert.ok(steps > 20, "seed " + seed + " 步数过少,随机策略退化");
  }
});

test("E2E-14b 随机对战里截胡真的会发生(v1.6 延迟窗口后第 1 轮也能截)", () => {
  let intercepted = 0;
  let hands = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const st = setup(["A", "B", "C", "D"].slice(0, 3 + (seed % 3)), undefined, seed);
    const rng = createRng(seed * 104729);
    let steps = 0;
    while (!st.gameOver && steps++ < 4000) {
      const res = stepRandom(st, rng);
      if (!res.ok) break;
    }
    hands += st.handNo;
    intercepted += st.events.filter((e) => e.kind === "INTERCEPTED").length;
  }
  assert.ok(intercepted >= 30, "20 组随机对战里截胡次数过少,延迟窗口可能没生效: " + intercepted + " 次 / " + hands + " 局");
});

test("E2E-21 弃牌亮牌:默认对所有人公开,便于算牌;可配置关闭", () => {
  const st = setup();
  const seat = st.turn.seat!;
  const cards = player(st, seat).hand.map((c) => c.id);
  const fold = ok(st, { type: "FOLD", seat }).events.find((x) => x.kind === "FOLDED");
  assert.ok(fold && fold.kind === "FOLDED");
  assert.equal(fold!.revealed?.length, 5, "默认应带亮牌");
  assert.equal(player(st, seat).hand.length, 5, "亮牌不影响手牌数");
  assert.deepEqual(player(st, seat).hand.map((c) => c.id), cards, "亮的就是原来那 5 张");

  const off = setup(undefined, { fold: { revealToAll: false } });
  const s2 = off.turn.seat!;
  const fold2 = ok(off, { type: "FOLD", seat: s2 }).events.find((x) => x.kind === "FOLDED");
  assert.ok(fold2 && fold2.kind === "FOLDED");
  assert.equal(fold2!.revealed, undefined, "关闭后不亮牌");
  inv(off);
});

test("E2E-15 终局:阈值达成即整场结束,并给出赢家", () => {
  const st = setup(["A", "B"], { endGame: { bustAtOrBelow: 0, winAtOrAbove: 10, winTakesPriorityOverBust: true } });
  const seat = st.turn.seat!;
  ok(st, { type: "FOLD", seat });
  assert.equal(st.gameOver, true);
  assert.equal(st.phase, "GAME_OVER");
  assert.ok(st.settlement!.gameOver);
  assert.equal(st.settlement!.gameOverReason, "WIN_THRESHOLD");
  assert.equal(st.settlement!.winnerSeat !== undefined, true);
});

test("E2E-16 终局:全员破产即结束(BUST)", () => {
  const st = setup(["A", "B"], {
    players: { min: 2, max: 6, handSize: 5, startPoints: 1 },
    endGame: { bustAtOrBelow: 0, winAtOrAbove: 50000, winTakesPriorityOverBust: true }
  });
  const seat = st.turn.seat!;
  ok(st, { type: "FOLD", seat });
  assert.equal(st.gameOver, true);
  assert.equal(st.settlement!.gameOverReason, "BUST");
});

interface StepResult { ok: boolean; tried: string; error?: string }
const R = (r: { ok: boolean; error?: { code: string; message: string } }, tried: string): StepResult =>
  ({ ok: r.ok, tried, error: r.error ? r.error.code + " " + r.error.message : undefined });

test("E2E-17 局数上限:打满 maxHands 局后按积分排名收场", () => {
  const st = setup(["A", "B", "C"], { endGame: { bustAtOrBelow: 0, winAtOrAbove: 10 ** 9, winTakesPriorityOverBust: true, maxHands: 3 } });
  let guard = 0;
  while (!st.gameOver && guard++ < 50) {
    if (st.phase !== "BETTING") break;
    ok(st, { type: "FOLD", seat: st.turn.seat! });
  }
  assert.equal(st.gameOver, true);
  assert.equal(st.handNo, 3, "应正好打满 3 局");
  assert.equal(st.settlement!.gameOverReason, "MAX_HANDS");
  const top = Math.max(...st.players.map((p) => p.points));
  const tops = st.players.filter((p) => p.points === top);
  assert.equal(st.settlement!.winnerSeat, tops.length === 1 ? tops[0].seat : undefined);
});

test("E2E-18 阈值优先于局数上限:同局同时达成时判 WIN_THRESHOLD", () => {
  const st = setup(["A", "B"], { endGame: { bustAtOrBelow: 0, winAtOrAbove: 10, winTakesPriorityOverBust: true, maxHands: 1 } });
  ok(st, { type: "FOLD", seat: st.turn.seat! });
  assert.equal(st.gameOver, true);
  assert.equal(st.handNo, 1);
  assert.equal(st.settlement!.gameOverReason, "WIN_THRESHOLD");
});

test("E2E-19 maxHands = null 时不因局数收场", () => {
  const st = setup(["A", "B"], { endGame: { bustAtOrBelow: -1, winAtOrAbove: 10 ** 9, winTakesPriorityOverBust: true, maxHands: null } });
  let guard = 0;
  while (guard++ < 12) {
    if (st.phase !== "BETTING") break;
    ok(st, { type: "FOLD", seat: st.turn.seat! });
  }
  assert.equal(st.gameOver, false);
  assert.ok(st.handNo >= 12, "已打 " + st.handNo + " 局仍应继续");
});

function stepRandom(st: GameState, rng: { int: (n: number) => number }): StepResult {
  if (st.phase !== "BETTING") return { ok: true, tried: "(自动阶段)" };
  if (st.interceptWindow) {
    const w = st.interceptWindow;
    const hand = player(st, w.candidateSeat).hand;
    if (legalActions(st).includes("INTERCEPT") && rng.int(100) < 70) {
      return R(apply(st, { type: "INTERCEPT", seat: w.candidateSeat, giveCardId: hand[rng.int(hand.length)].id }), "INTERCEPT");
    }
    return R(apply(st, { type: "DECLINE_INTERCEPT", seat: w.candidateSeat }), "DECLINE_INTERCEPT");
  }
  if (st.retake) {
    const seat = st.retake.seat;
    const rp = player(st, seat);
    const options = faceUpPool(st).filter((id) => {
      const m = st.poolMeta[id];
      return !(m.origin === "DISCARDED" && m.holderHistory[m.holderHistory.length - 1] === rp.id);
    });
    if (legalActions(st).includes("RETAKE") && options.length > 0 && rng.int(100) < 60) {
      return R(apply(st, { type: "RETAKE", seat, takeCardId: options[rng.int(options.length)] }), "RETAKE");
    }
    return R(apply(st, { type: "SKIP_RETAKE", seat }), "SKIP_RETAKE");
  }
  const seat = st.turn.seat!;
  const p = player(st, seat);
  const opts = legalActions(st);
  const pick = opts[rng.int(opts.length)];
  switch (pick) {
    case "VIEW_HAND": return R(apply(st, { type: "VIEW_HAND", seat }), "VIEW_HAND");
    case "CALL": return R(apply(st, { type: "CALL", seat }), "CALL");
    case "FOLD": return R(apply(st, { type: "FOLD", seat }), "FOLD");
    case "RAISE": {
      const next = st.config.betting.ladder.find((m) => m > st.multiplier) ?? st.multiplier;
      return R(apply(st, { type: "RAISE", seat, toMultiplier: next }), "RAISE");
    }
    case "COMPARE": {
      const others = aliveSeats(st).filter((s) => s !== seat);
      if (others.length === 0) return R(apply(st, { type: "FOLD", seat }), "FOLD(无对手)");
      return R(apply(st, { type: "COMPARE", seat, targetSeat: others[rng.int(others.length)] }), "COMPARE");
    }
    case "EXCHANGE": {
      const takes = faceUpPool(st).filter((id) => {
        const m = st.poolMeta[id];
        return !(m.origin === "DISCARDED" && m.holderHistory[m.holderHistory.length - 1] === p.id);
      });
      if (takes.length === 0) return R(apply(st, { type: "CALL", seat }), "CALL(无可换)");
      return R(apply(st, { type: "EXCHANGE", seat, takeCardId: takes[rng.int(takes.length)], giveCardId: p.hand[rng.int(p.hand.length)].id }), "EXCHANGE");
    }
    case "KICK": {
      const targets = st.pool.filter((c) => { const m = st.poolMeta[c.id]; return m.faceUp && (!st.config.kick.requireNeverSelected || !m.everSelected); });
      if (targets.length === 0) return R(apply(st, { type: "CALL", seat }), "CALL(无可踢)");
      return R(apply(st, { type: "KICK", seat, targetCardId: targets[rng.int(targets.length)].id }), "KICK");
    }
    case "TAKE_BLOCKED":
      return R(apply(st, { type: "TAKE_BLOCKED", seat, giveCardId: p.hand[rng.int(p.hand.length)].id }), "TAKE_BLOCKED");
    case "INTERCEPT":
      return R(apply(st, { type: "INTERCEPT", seat, giveCardId: p.hand[rng.int(p.hand.length)].id }), "INTERCEPT");
    case "DECLINE_INTERCEPT":
      return R(apply(st, { type: "DECLINE_INTERCEPT", seat }), "DECLINE_INTERCEPT");
    case "PASS_BLOCKED": return R(apply(st, { type: "PASS_BLOCKED", seat }), "PASS_BLOCKED");
    default: return R(apply(st, { type: "FOLD", seat }), "FOLD(default)");
  }
}

test("E2E-22 全员只跟注也会结束:maxRounds(16) 安全阀强制摊牌(防无限牌局)", () => {
  const st = createGame(makeConfig({
    players: { startPoints: 20000 },
    endGame: { maxHands: 1, winAtOrAbove: 1e18, bustAtOrBelow: -1e18, winTakesPriorityOverBust: true }
  }), ["A", "B", "C", "D"], 4242);
  advance(st);
  let steps = 0;
  while (st.phase === "BETTING" && steps++ < 4000) {
    const seat = st.turn.seat!;
    const call = legalActions(st).includes("CALL") ? { type: "CALL", seat } as const : { type: "FOLD", seat } as const;
    if (!apply(st, call, { dealNextHand: false }).ok) break;
  }
  assert.notEqual(st.phase, "BETTING", "全员跟注也必须能结束,不能挂死");
  assert.ok(st.betting.roundIndex <= 16, "应在 maxRounds(16) 内收场,实际 " + st.betting.roundIndex);
  assert.equal(st.settlement?.reason, "SHOWDOWN");
  assert.equal(st.multiplier, 1, "没人加注时 M 应保持 1");
  inv(st);
});

test("E2E-23 欠债模式:分值为负时仍能行动,守恒与不变量都成立;关闭时则跌不到负数", () => {
  const play = (debt: boolean) => {
    const cfg = mergeConfig(makeBalancedConfig(3), {
      players: { startPoints: 200, allowDebt: debt },
      ante: { amount: 40 },
      endGame: { bustAtOrBelow: -5000, winAtOrAbove: 100000, maxHands: 4 },
    });
    const st = createGame(cfg, ["A", "B", "C"], 5);
    advance(st);
    const normal = ["EQB", "ZeroB", "Yeon"].map(makeAgent);
    const rng = createRng(77);
    // 开局后底注已进池,所以守恒量 = 玩家积分 + 底池(不能只算积分)
    const total0 = st.players.reduce((s, p) => s + p.points, 0) + st.pot;
    let min = Infinity, g = 0;
    while (!st.gameOver && g++ < 3000) {
      const seat = st.turn.seat;
      if (seat === null) break;
      let a: Action | null = null;
      if (seat === 0) {
        // 被迫跟注机器:只要 CALL 合法就跟(饿着也要跟 → 才会欠债)
        a = legalActions(st, 0).find((x) => x.type === "CALL") ?? null;
      }
      if (!a) a = normal[seat](st, rng) as Action;
      if (!a || !apply(st, a).ok) break;
      for (const p of st.players) min = Math.min(min, p.points);
    }
    return { st, min, total0, inv: checkInvariants(st) };
  };

  const on = play(true);
  assert.ok(on.min < 0, "欠债模式下应出现负分,实际最低 " + on.min);
  assert.deepEqual(on.inv, [], "欠债模式下 INV4 应放宽,其余不变量仍须成立");

  const off = play(false);
  assert.ok(off.min >= 0, "非欠债模式必须跌不到负数,实际最低 " + off.min);
  assert.deepEqual(off.inv, []);

  // 守恒:总分(含负数)与开局一致(赢家通吃,积分只在玩家间转移)
  const sum = on.st.players.reduce((s, p) => s + p.points, 0) + (on.st.pot ?? 0);
  assert.equal(sum, on.total0, "总分守恒(欠债也不改变总账):" + sum + " vs " + on.total0);
});
