// 唬牌规则用例:先测后玩(今天的教训:测试全绿也要真跑一遍)
import test from "node:test";
import assert from "node:assert/strict";
import { createDeck } from "../src/cards.ts";
import type { Card } from "../src/cards.ts";
import { createRng } from "../src/rng.ts";
import { DEFAULT_BLUFF_CONFIG, createBluffGame, cardCount, rankOf, isHonestCard } from "../src/games/bluff/state.ts";
import type { BluffState } from "../src/games/bluff/state.ts";
import { startHand, play, challenge, legalActions, checkBluffInvariants, settleHand } from "../src/games/bluff/rules.ts";

const NAMES = ["A", "B", "C", "D"];
function fresh(seed = 7): BluffState {
  const st = createBluffGame(DEFAULT_BLUFF_CONFIG, NAMES, seed);
  startHand(st);
  return st;
}

/** 安全换手牌:把指定 id 的牌换到某座位(总量不变,不会重复) */
function give(st: BluffState, seat: number, ids: string[]): void {
  const want: Card[] = [];
  for (const id of ids) {
    for (const p of st.seats) {
      const i = p.hand.findIndex((c) => c.id === id);
      if (i >= 0) { want.push(p.hand.splice(i, 1)[0]); break; }
    }
  }
  assert.equal(want.length, ids.length, "找不到这些牌: " + ids.join(","));
  const target = st.seats[seat];
  const give = target.hand.splice(0, want.length);
  target.hand.push(...want);
  // 换出去的牌塞回原处(保持守恒)
  for (const c of give) {
    const other = st.seats.find((p) => p.seat !== seat && p.hand.every((x) => x.id !== c.id));
    (other ?? st.seats[(seat + 1) % 4]).hand.push(c);
  }
}

test("BLUFF-01 发牌守恒:4×26 全发、无重复、不变量成立", () => {
  const st = fresh();
  for (const p of st.seats) assert.equal(p.hand.length, 26, "每人 26 张");
  assert.equal(cardCount(st), 104, "场上总牌数 = 104");
  assert.deepEqual(checkBluffInvariants(st), []);
});

test("BLUFF-02 每回合抽的点数绝不是癞子(抽 2000 次验证)", () => {
  const st = createBluffGame(DEFAULT_BLUFF_CONFIG, NAMES, 11);
  startHand(st);
  for (let i = 0; i < 2000; i++) {
    // 用出牌推动回合,观察每次抽到的点数
    const seat = st.turn;
    const p = st.seats[seat];
    const r = play(st, seat, [p.hand[0].id]);
    if (!r.ok) break;
    assert.notEqual(st.roundRank, st.wildRank, "回合点数不能是癞子");
    if (st.handOver) { startHand(st); }
  }
});

test("BLUFF-03 不能过牌:轮到你时一定有可行动作,且至少一个出牌", () => {
  const st = fresh(3);
  for (let i = 0; i < 50 && !st.handOver; i++) {
    const acts = legalActions(st);
    assert.ok(acts.length > 0, "不能出现无动作可做");
    assert.ok(acts.some((a) => a.type === "PLAY"), "必须能出牌(没有 0 张这个选项)");
    const a = acts.find((x) => x.type === "CHALLENGE") ?? acts.find((x) => x.type === "PLAY")!;
    const r = a.type === "PLAY" ? play(st, a.seat, a.cardIds) : challenge(st, a.seat);
    assert.equal(r.ok, true, "合法动作必须被接受: " + r.error);
  }
});

test("BLUFF-04 出牌张数必须是 1~5", () => {
  const st = fresh(5);
  const p = st.seats[st.turn];
  assert.equal(play(st, st.turn, []).ok, false, "0 张(过牌)必须被拒");
  assert.equal(play(st, st.turn, p.hand.slice(0, 6).map((c) => c.id)).ok, false, "6 张必须被拒");
  assert.equal(play(st, st.turn, p.hand.slice(0, 5).map((c) => c.id)).ok, true, "5 张应当允许");
});

test("BLUFF-05 质疑判定:全真(含癞子)→ 质疑者吃;有假 → 出牌者吃", () => {
  // 让出牌者手里全是真牌(该回合点数 + 癞子),质疑应当失败
  const st = fresh(9);
  const seat = st.turn;
  const R = st.roundRank, W = st.wildRank;
  const honestIds = st.seats.flatMap((p) => p.hand).filter((c) => rankOf(c) === R || rankOf(c) === W).slice(0, 3).map((c) => c.id);
  assert.ok(honestIds.length >= 1, "场上应当有真牌");
  give(st, seat, honestIds);
  play(st, seat, honestIds);
  const before = st.seats[(seat + 1) % 4].hand.length;
  const r = challenge(st, (seat + 1) % 4);
  assert.equal(r.ok, true);
  assert.equal(st.events.at(-1)!.kind, "CHALLENGE");
  const ev = st.events.at(-1)! as { honest: boolean; eater: number };
  assert.equal(ev.honest, true, "真话应当判定为真");
  assert.equal(ev.eater, (seat + 1) % 4, "质疑失败 → 质疑者吃下整堆");
  assert.ok(st.seats[(seat + 1) % 4].hand.length > before, "质疑者手牌应增加");

  // 让出牌者手里全是假牌,质疑应当成功
  const st2 = fresh(10);
  const seat2 = st2.turn;
  const fakeIds = st2.seats.flatMap((p) => p.hand).filter((c) => rankOf(c) !== st2.roundRank && rankOf(c) !== st2.wildRank).slice(0, 2).map((c) => c.id);
  give(st2, seat2, fakeIds);
  play(st2, seat2, fakeIds);
  challenge(st2, (seat2 + 1) % 4);
  const ev2 = st2.events.at(-1)! as { honest: boolean; eater: number };
  assert.equal(ev2.honest, false, "假话应当判定为假");
  assert.equal(ev2.eater, seat2, "质疑成功 → 出牌者收回整堆");
});

test("BLUFF-06 循环不破:出牌后轮到下家;质疑后仍是质疑者出牌", () => {
  const st = fresh(13);
  const s0 = st.turn;
  const p = st.seats[s0];
  play(st, s0, [p.hand[0].id]);
  assert.equal(st.turn, (s0 + 1) % 4, "出牌后轮到下家");
  const s1 = st.turn;
  challenge(st, s1);
  assert.equal(st.turn, s1, "质疑后仍然是质疑者出牌(即上家的下家)→ 循环不破");
  // 再出牌 → 继续 (s1+1)
  const q = st.seats[s1];
  play(st, s1, [q.hand[0].id]);
  assert.equal(st.turn, (s1 + 1) % 4);
});

test("BLUFF-07 结束条件:有人出空 / 有人超过 40 张", () => {
  const st = fresh(17);
  const seat = st.turn;
  // 把该座位手牌清到只剩 1 张;其余**平均分给另外三家**(塞给一家会把他顶到 40+ 触发爆牌 ✗)
  const keep = st.seats[seat].hand[0];
  const rest = st.seats[seat].hand.slice(1);
  st.seats[seat].hand = [keep];
  rest.forEach((c, i) => st.seats[(seat + 1 + (i % 3)) % 4].hand.push(c));
  play(st, seat, [keep.id]);
  assert.equal(st.handOver, false, "刚出空还不能算赢:下一手可能质疑最后一手");
  const q = st.seats[st.turn];
  play(st, st.turn, [q.hand[0].id]);   // 下家选择出牌 = 默认不质疑 → 出空者赢
  assert.equal(st.handOver, true);
  assert.equal(st.winnerSeat, seat, "出空者赢");
  assert.equal(st.bustedSeat, null);

  const st2 = fresh(19);
  const donor2 = st2.seats[st2.turn];
  const hostSeat = (st2.turn + 1) % 4;
  // 只搬 15 张:接收方 26+15 = 41 > 40 爆牌;出牌方还剩 11 张,仍能正常出牌
  st2.seats[hostSeat].hand.push(...donor2.hand.splice(0, 15));
  const host = st2.seats[hostSeat];
  assert.ok(host.hand.length > 40, "前置条件:某人超过 40 张");
  // 触发一次检查(出牌即可)
  const t = st2.turn;
  play(st2, t, [st2.seats[t].hand[0].id]);
  assert.equal(st2.handOver, true, "超过 40 张应当提前结束");
  assert.equal(st2.bustedSeat, hostSeat, "爆牌者是那个人");
});

test("BLUFF-08 结算零和:四人得分相加为 0", () => {
  const st = fresh(23);
  st.seats[0].hand = st.seats[0].hand.slice(0, 5);
  st.seats[1].hand.push(...st.seats[0].hand);   // 随便造一个分布(不一定守恒,只测结算公式)
  const scores = settleHand(st);
  assert.equal(scores.reduce((a, b) => a + b, 0), 0, "零和:总分必须为 0");
});

test("BLUFF-09 完整对局:随机策略能打完一盘 4 局,全程不变量成立", () => {
  const st = createBluffGame(DEFAULT_BLUFF_CONFIG, NAMES, 31);
  const rng = createRng(99);
  let guard = 0;
  while (!st.over && guard++ < 20000) {
    if (st.over) break;
    if (st.handNo === 0 || st.handOver) { startHand(st); continue; }   // 手牌还没发 / 上一局结束
    const acts = legalActions(st);
    assert.ok(acts.length > 0, "总得有动作");
    const a = acts[Math.floor(rng.next() * acts.length)];
    const r = a.type === "PLAY" ? play(st, a.seat, a.cardIds) : challenge(st, a.seat);
    assert.equal(r.ok, true, "随机合法动作必须被接受: " + r.error);
    assert.deepEqual(checkBluffInvariants(st), [], "第 " + guard + " 步不变量被破坏");
    if (st.over) break;
  }
  assert.ok(st.over, "应当能打完一盘(4 局)");
  assert.equal(st.handNo, 4, "一盘 = 4 局");
  assert.equal(st.seats.reduce((s, p) => s + p.points, 0), 0, "一盘下来总分仍零和");
});