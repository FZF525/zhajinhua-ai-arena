// Web 层可见性回归:引擎可以知道一切,但下发给浏览器的 JSON 不能泄露
import test from "node:test";
import assert from "node:assert/strict";
import { makeConfig } from "../src/config.ts";
import { createGame, player } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { actorOf, buildView } from "../web/view.ts";

function fresh(patch?: unknown) {
  const st = createGame(makeConfig(patch ?? {}), ["A", "B", "C"], 3);
  advance(st);
  return st;
}

test("WEB-01 闷牌者自己的手牌也不下发(防止前端偷看)", () => {
  const st = fresh();
  const actor = actorOf(st)!;
  assert.equal(player(st, actor).blind, true);
  const v = buildView(st);
  assert.equal(v.actor, actor);
  assert.equal(v.actorHand, null, "闷牌时不得下发手牌");
  assert.equal(v.actorHandHidden, true);
  assert.equal(v.players[actor].hand, null);
  // 其他人更不下发
  for (const p of v.players) if (p.seat !== actor) assert.equal(p.hand, null);
});

test("WEB-02 看牌后才下发自己的手牌,且始终不下发别人手牌", () => {
  const st = fresh();
  const actor = actorOf(st)!;
  apply(st, { type: "VIEW_HAND", seat: actor });
  const v = buildView(st);
  assert.equal(v.actorHand?.length, 5, "看牌后应能看到 5 张");
  assert.equal(v.actorHandHidden, false);
  for (const p of v.players) if (p.seat !== actor) assert.equal(p.hand, null, "别人的手牌必须为 null");
});

test("WEB-03 公共池:暗牌只对踢牌者可见;手牌数只给张数不给牌面", () => {
  const st = fresh();
  const actor = actorOf(st)!;
  apply(st, { type: "KICK", seat: actor, targetCardId: st.pool[0].id });
  const blocked = st.blockades[0];
  const mine = buildView(st);
  const myBlocked = mine.pool.find((c: { blockadedBy: number | null }) => c.blockadedBy === blocked.kickerSeat);
  assert.equal(myBlocked?.text !== null, true, "踢牌者应能看到自己的暗牌");
  // 换下家视角
  const other = st.players.find((p) => p.seat !== actor)!.seat;
  st.turn = { seat: other, needsMainDecision: true };
  const theirs = buildView(st);
  const theirView = theirs.pool.find((c: { blockadedBy: number | null }) => c.blockadedBy === blocked.kickerSeat);
  assert.equal(theirView?.text, null, "别人看不到暗牌牌面");
  for (const p of theirs.players) assert.ok(typeof p.handCount === "number");
});

test("WEB-04 动作与费用一起下发,客户端不用自己算", () => {
  const st = fresh();
  const v = buildView(st);
  assert.ok(v.legal.length > 0);
  const call = v.legal.find((l: { name: string }) => l.name === "CALL");
  assert.ok(call && call.cost! > 0, "CALL 应带费用");
  assert.equal(call!.cost, v.fees.blind, "闷牌跟注 = 闷牌基准 × M");
  const view = v.legal.find((l: { name: string }) => l.name === "VIEW_HAND");
  assert.equal(view?.cost, 0);
});

test("WEB-05 牌局结束后(摊牌)所有手牌可见", () => {
  // 2 人局:一人弃牌 → 只剩 1 人 → 结算 → 阈值(10)达成 → 整场结束
  const st = createGame(makeConfig({ endGame: { bustAtOrBelow: 0, winAtOrAbove: 10, winTakesPriorityOverBust: true, maxHands: 1 } }), ["A", "B"], 3);
  advance(st);
  apply(st, { type: "FOLD", seat: actorOf(st)! });
  assert.equal(st.gameOver, true, "应因阈值达成而结束");
  const v = buildView(st);
  assert.equal(v.gameOver, true);
  for (const p of v.players) assert.equal(p.hand?.length, 5, "结束时应摊牌");
});

test("WEB-06 契约:view 下发的牌 id 可直接用于换牌(前端不该自造 id)", () => {
  const st = fresh();
  const actor = actorOf(st)!;
  apply(st, { type: "VIEW_HAND", seat: actor });
  const v = buildView(st);
  const handIds = v.actorHand!.map((c: { id: string }) => c.id);
  assert.equal(handIds.length, 5);
  for (const id of handIds) assert.ok(player(st, actor).hand.some((c) => c.id === id), "手牌 id 必须真实存在");
  const p = player(st, actor);
  const take = v.pool
    .map((c: { id: string | null }) => c.id)
    .filter((id: string | null): id is string => id !== null)
    .find((id: string) => {
      const m = st.poolMeta[id];
      return !(m.origin === "DISCARDED" && m.holderHistory[m.holderHistory.length - 1] === p.id);
    })!;
  assert.ok(take, "应能选到可换的公共牌");
  const r = apply(st, { type: "EXCHANGE", seat: actor, takeCardId: take, giveCardId: handIds[0] });
  assert.equal(r.ok, true, "换牌应成功:" + (r.error?.code ?? "") + " " + (r.error?.message ?? ""));
});

test("WEB-07 契约:view 下发的公共牌 id 可直接用于踢牌", () => {
  const st = fresh();
  const actor = actorOf(st)!;
  const v = buildView(st);
  const target = v.pool.find((c: { id: string | null; everSelected: boolean }) => c.id !== null && !c.everSelected);
  assert.ok(target, "首轮应存在未被选取的明牌");
  const r = apply(st, { type: "KICK", seat: actor, targetCardId: target!.id! });
  assert.equal(r.ok, true, "踢牌应成功:" + (r.error?.code ?? "") + " " + (r.error?.message ?? ""));
});

test("WEB-08 公共池暗牌对非踢牌者不下发 id(前端无法拿它去换牌)", () => {
  const st = fresh();
  const kicker = actorOf(st)!;
  apply(st, { type: "KICK", seat: kicker, targetCardId: st.pool[0].id });
  const blocked = st.blockades[0];
  // 换成下家视角
  const other = st.players.find((p) => p.seat !== kicker)!.seat;
  st.turn = { seat: other, needsMainDecision: true };
  const theirs = buildView(st);
  const hidden = theirs.pool.find((c: { blockadedBy: number | null }) => c.blockadedBy === blocked.kickerSeat);
  assert.equal(hidden?.id, null, "别人的暗牌 id 必须是 null");
  assert.equal(hidden?.text, null);
  // 踢牌者自己仍然能看到
  st.turn = { seat: kicker, needsMainDecision: true };
  const mine = buildView(st);
  const mineCard = mine.pool.find((c: { blockadedBy: number | null }) => c.blockadedBy === blocked.kickerSeat);
  assert.equal(mineCard?.id, blocked.cardId, "踢牌者应拿到自己暗牌的 id");
});

test("WEB-09 弃牌后手牌对其他人可见(算牌用);关闭配置后不可见", () => {
  const st = fresh();
  const folder = actorOf(st)!;
  const cards = player(st, folder).hand.map((c) => c.id);
  apply(st, { type: "FOLD", seat: folder });
  const next = actorOf(st)!;
  assert.notEqual(next, folder, "弃牌后应轮到别人");
  const v1 = buildView(st);
  assert.equal(v1.players[next].seat === next, true);
  const seen = v1.players.find((p: { seat: number }) => p.seat === folder);
  assert.deepEqual(seen?.hand?.map((c: { id: string }) => c.id), cards, "弃牌者的牌应公开");

  const off = fresh({ fold: { revealToAll: false } });
  const f2 = actorOf(off)!;
  apply(off, { type: "FOLD", seat: f2 });
  const v2 = buildView(off);
  const hidden = v2.players.find((p: { seat: number }) => p.seat === f2);
  assert.equal(hidden?.hand, null, "关闭时不得公开");
  assert.ok(hidden!.handCount === 5, "仍应给出张数");
});

test("WEB-10 单人视角:轮到 AI 也不下发它的手牌", () => {
  const st = fresh();
  // 座位1 先看牌,再依次过牌,直到轮到我(座位0)看牌
  const s1 = actorOf(st)!;
  apply(st, { type: "VIEW_HAND", seat: s1 });
  apply(st, { type: "CALL", seat: s1 });
  const s2 = actorOf(st)!;
  apply(st, { type: "CALL", seat: s2 });
  const me = actorOf(st)!;
  apply(st, { type: "VIEW_HAND", seat: me });

  const mine = buildView(st, true, { viewer: me });
  assert.ok(mine.players[me].hand, "自己的牌应可见");
  assert.equal(mine.players[s1].hand, null, "别人的牌无论轮到谁都不可见");
  assert.equal(mine.players[s2].hand, null, "同上");
  assert.equal(mine.isMyTurn, true);
  assert.equal(mine.viewerSeat, me);

  // 换成"s1 的视角":s1 的牌可见,我的不可见
  const his = buildView(st, true, { viewer: s1 });
  assert.ok(his.players[s1].hand, "s1 视角下 s1 的牌可见");
  assert.equal(his.players[me].hand, null, "s1 视角下看不到我的牌");
  assert.equal(his.isMyTurn, false, "这时不是 s1 的回合");
});

test("WEB-11 本局结算后把手牌全部摊开(便于复盘)", () => {
  const st = fresh();
  let guard = 0;
  while (st.phase !== "HAND_START" && guard++ < 20) {
    const seat = actorOf(st);
    if (seat === null) break;
    if (st.players.filter((p) => p.inHand && !p.folded).length <= 1) break;
    if (!apply(st, { type: "FOLD", seat }, { dealNextHand: false }).ok) break;
  }
  assert.equal(st.phase, "HAND_START", "本局应已结算并停在局间");
  const v = buildView(st, true, { viewer: 0 });
  assert.ok(v.settlement, "应暴露结算");
  for (const p of v.players) assert.ok(p.hand, p.name + " 的手牌也应摊开");
  for (const p of v.players) assert.ok(typeof p.handDelta === "number", "应有本局净收支");
  assert.equal(v.players.reduce((a, p) => a + p.handDelta, 0), 0, "净收支合计为 0");
});
