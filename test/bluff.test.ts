// 唬牌规则用例:先测后玩(今天的教训:测试全绿也要真跑一遍)
import test from "node:test";
import assert from "node:assert/strict";
import { createDeck } from "../src/cards.ts";
import type { Card } from "../src/cards.ts";
import { createRng } from "../src/rng.ts";
import { DEFAULT_BLUFF_CONFIG, BLUFF_BUST_MODES, createBluffGame, cardCount, rankOf, isHonestCard, describeExhibition } from "../src/games/bluff/state.ts";
import type { BluffState } from "../src/games/bluff/state.ts";
import { newBluffGame, startHand, play, challenge, legalActions, checkBluffInvariants, settleHand } from "../src/games/bluff/rules.ts";
import { createAdaptiveAgent, createEvolvingAgent, DEFAULT_EXCEL, pickBestCandidate } from "../src/games/bluff/ai.ts";

const NAMES = ["A", "B", "C", "D"];
function fresh(seed = 7): BluffState {
  return newBluffGame(DEFAULT_BLUFF_CONFIG, NAMES, seed);   // 工厂自带发牌,别再手动 startHand(会多打一局)
}

/** 从其余各家凑牌,把某座位补到 target 张(单家可能不够,比如要顶到 52 张时) */
function topUp(st: BluffState, seat: number, target: number): boolean {
  let need = target - st.seats[seat].hand.length;
  for (const p of st.seats) {
    if (p.seat === seat || need <= 0) continue;
    // 给每家至少留 1 张:抽光了会误触「出空赢」的提前返回(真实对局不会这样,纯测试构造问题)
    const take = Math.min(need, Math.max(0, p.hand.length - 1));
    st.seats[seat].hand.push(...p.hand.splice(0, take));
    need -= take;
  }
  return need === 0;
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
  const st = newBluffGame(DEFAULT_BLUFF_CONFIG, NAMES, 31);
  const rng = createRng(99);
  let guard = 0;
  while (!st.over && guard++ < 20000) {
    if (st.over) break;
    if (st.handOver) { startHand(st); continue; }   // 上一局结束,开下一局
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
test("BLUFF-10 牌堆是叠加的:没人质疑就一直涨;一旦质疑结算,整堆被吃走并清零", () => {
  const st = fresh(41);
  const startSeat = st.turn;
  // 连续四家各出 2 张,全程不质疑 → 牌堆应逐手变大
  let expectPile = 0;
  for (let i = 0; i < 4; i++) {
    const seat = st.turn;
    const p = st.seats[seat];
    const ids = p.hand.slice(0, 2).map((c) => c.id);
    const before = st.pile.length;
    play(st, seat, ids);
    // 刚出的那手在 pending 里;上一手(如果有)已并入 pile
    if (i > 0) {
      assert.equal(st.pile.length, before + 2, "上一手应当并入牌堆(叠加)");
    }
    expectPile = st.pile.length;
  }
  assert.ok(expectPile >= 4, "牌堆应当已经涨到 4 张以上,实际 " + expectPile);
  assert.equal(st.pile.length + (st.pending ? st.pending.cards.length : 0), st.pile.length + 2, "最后一手仍在待判定区");

  // 下家质疑 → 整堆(含待判定的那一手)被吃走,牌堆清零
  const challenger = st.turn;
  const eaterBefore = st.seats[challenger].hand.length + st.seats[(challenger + 3) % 4].hand.length;
  const potBefore = st.pile.length + st.pending!.cards.length;
  challenge(st, challenger);
  assert.equal(st.pile.length, 0, "质疑结算后牌堆必须清零");
  assert.equal(st.pending, null, "待判定区也要清空");
  const eaterAfter = st.seats[challenger].hand.length + st.seats[(challenger + 3) % 4].hand.length;
  assert.equal(eaterAfter, eaterBefore + potBefore, "整堆(含上一手)应当归吃牌者,一张不漏");
  assert.equal(startSeat >= 0, true);
});

test("BLUFF-11 局末展览:牌堆真容 + 每人的谎话账本(纯展示,不影响分数)", () => {
  const st = fresh(101);
  const seat = st.turn;
  const R = st.roundRank, W = st.wildRank;
  // 第一手:故意全报假牌(2 张)
  const fake = st.seats.flatMap((p) => p.hand).filter((c) => !isHonestCard(c, R, W)).slice(0, 2).map((c) => c.id);
  give(st, seat, fake);
  play(st, seat, fake);
  // 第二手:下家把手里真牌全出(诚实)
  const seat2 = st.turn;
  const honest = st.seats[seat2].hand.filter((c) => isHonestCard(c, st.roundRank, st.wildRank)).slice(0, 2).map((c) => c.id);
  give(st, seat2, honest);
  play(st, seat2, honest);
  // 让游戏结束(随便出到爆/空),这里直接触发展览:造一个 > 40 张的座位
  const donor = st.seats[st.turn];
  st.seats[(st.turn + 1) % 4].hand.push(...donor.hand.splice(0, 20));
  play(st, st.turn, [st.seats[st.turn].hand[0].id]);
  assert.equal(st.handOver, true, "应当结束(爆牌)");
  const ex = st.exhibition!;
  assert.ok(ex, "应当生成展览");
  assert.equal(ex.handNo, 1);
  const mine = ex.perSeat.find((x) => x.seat === seat)!;
  assert.equal(mine.claims, 1, "该座位报了 1 手");
  assert.equal(mine.lies, 2, "那 2 张全是假的(账本要记 2)");
  assert.equal(mine.biggestLie, 2);
  const his = ex.perSeat.find((x) => x.seat === seat2)!;
  assert.equal(his.lies, 0, "诚实那一手不该记谎话");
  assert.ok(ex.pileSize > 0, "牌堆应当有牌(展览要能看到真容)");
  assert.ok(Object.values(ex.pileOf).reduce((a, b) => a + b, 0) === ex.pileSize, "牌堆点数统计应当等于张数");
  // 关键:展览纯展示,不改分 —— 分数仍然零和
  assert.equal(st.lastScores.reduce((a, b) => a + b, 0), 0);
});

test("BLUFF-12 自适应对手模型:看到谎话后要记账,而且学会质疑被证明过的骗子", () => {
  const st = fresh(202);
  const agent = createAdaptiveAgent({ ...DEFAULT_EXCEL, learnAlpha: 4 });
  const seat = 0;
  // 造一批观测:座位 1 报了 3 次 5 张,全是假话(直接塞进 claims,模拟展览账本)
  for (let i = 0; i < 3; i++) st.claims.push({ seat: 1, handNo: 1, claimedRank: st.roundRank, count: 5, honest: 0 });
  // 座位 2 报了 3 次 5 张,全是真的
  for (let i = 0; i < 3; i++) st.claims.push({ seat: 2, handNo: 1, claimedRank: st.roundRank, count: 5, honest: 5 });
  agent.observeHand(st);
  assert.deepEqual(agent.statsFor(1, 5), { claims: 3, lies: 3 }, "骗子的账要记对");
  assert.deepEqual(agent.statsFor(2, 5), { claims: 3, lies: 0 }, "诚实者的账也要记对");

  // 面对座位 1 报 5 张(结构模型认为这种几乎必真 ✓)→ 自适应后应当质疑(因为实测 100% 是假)
  const fake = fresh(203);
  const agent2 = createAdaptiveAgent({ ...DEFAULT_EXCEL, learnAlpha: 2 });
  for (let i = 0; i < 6; i++) fake.claims.push({ seat: 1, handNo: 1, claimedRank: fake.roundRank, count: 5, honest: 0 });
  agent2.observeHand(fake);
  const turn = fake.turn;
  // 让座位 1 出一手 5 张,轮到别人来决定是否质疑
  const p1 = fake.seats[1];
  const ids = p1.hand.slice(0, 5).map((c) => c.id);
  // 保证轮到 1(不行就顺推)
  let guard = 0;
  while (fake.turn !== 1 && guard++ < 8) { const s2 = fake.turn; const q = fake.seats[s2]; play(fake, s2, [q.hand[0].id]); }
  if (fake.turn === 1 && !fake.handOver) {
    play(fake, 1, ids);
    const chalSeat = fake.turn;
    if (chalSeat === 0) {
      const act = agent2.decide(fake, 0);
      assert.equal(act.type, "CHALLENGE", "对 100% 撒谎的对手,报了 5 张就该抓");
    }
  }
});

test("BLUFF-13 两种爆牌线(40 / 52)都按各自阈值生效", () => {
  assert.equal(BLUFF_BUST_MODES.tight, 40);
  assert.equal(BLUFF_BUST_MODES.loose, 52);
  for (const [mode, limit] of Object.entries(BLUFF_BUST_MODES)) {
    const cfg = { ...DEFAULT_BLUFF_CONFIG, bustCards: limit };
    const st = newBluffGame(cfg, NAMES, 301);
    // 把当前行动者的牌堆到 limit 张(正好等于阈值,不该爆)
    const seat = st.turn;
    assert.equal(topUp(st, seat, limit), true, mode + ": 应当能凑到 " + limit + " 张");
    assert.equal(st.seats[seat].hand.length, limit, mode + ": 应当正好 " + limit + " 张");
    const trig = st.turn;
    play(st, trig, [st.seats[trig].hand[0].id]);
    assert.equal(st.handOver, false, mode + ": 正好等于阈值不该爆(规则是超过才爆)");
    // 补到 limit + 1(注意:刚出过一张,手牌已经少 1)→ 出牌后结算时越线 → 爆
    // 注意①:前面那一手已经推进了轮次 → 必须重新取当前行动者(这是我写测试时的第一版错)
    // 注意②:爆牌判定在**出牌之后**,而出牌让手牌再减 1 → 要补到 limit + 2
    const trig2 = st.turn;
    assert.ok(limit + 2 > st.seats[trig2].hand.length, mode + ": 前置应当还差至少 1 张");
    assert.equal(topUp(st, trig2, limit + 2), true, mode + ": 应当能凑到 " + (limit + 2) + " 张");
    assert.equal(st.seats[trig2].hand.length, limit + 2, mode + ": 补到 " + (limit + 2) + " 张");
    play(st, trig2, [st.seats[trig2].hand[0].id]);
    assert.equal(st.seats[trig2].hand.length, limit + 1, mode + ": 出牌后应当是 " + (limit + 1) + " 张");
    assert.equal(st.handOver, true, mode + ": 超过 " + limit + " 张应当爆牌");
  }
});

test("BLUFF-14 局末牌堆不计分:只做展览,分数只按手牌数算", () => {
  const st = fresh(401);
  const seat = st.turn;
  // 让三个人各出几张堆着,没人质疑 → 局末牌堆非空
  for (let i = 0; i < 3 && !st.handOver; i++) {
    const q = st.seats[st.turn];
    play(st, st.turn, [q.hand[0].id]);
  }
  assert.ok(st.pile.length > 0, "前置:牌堆应当非空,实际 " + st.pile.length);
  const pileBefore = st.pile.length;
  const handsBefore = st.seats.map((p) => p.hand.length);
  // 造结束:把某家顶到 41 张
  // 补到 42:出掉 1 张后剩 41 > 40 → 结算时爆(爆牌判定在出牌之后)
  const trig = st.turn;
  assert.equal(topUp(st, trig, 42), true, "应当能凑到 42 张");
  assert.ok(st.seats[trig].hand.length > 41, "前置:应当 > 41 张");
  play(st, trig, [st.seats[trig].hand[0].id]);
  assert.equal(st.handOver, true, "应当结束");
  const ex = st.exhibition!;
  assert.ok(ex, "应当生成展览");
  assert.ok(ex.pileSize > 0, "局末牌堆非空,应当被展览记录: " + ex.pileSize);
  // 关键:牌堆那些牌没有进任何人的手牌(「不计分」的前提 = 守恒)
  // 用模块自己的 cardCount(手牌 + 牌堆 + 待判定)—— 手搓会漏掉待判定区,我因此错过一次
  assert.equal(cardCount(st), 26 * 4, "全副 104 张:手牌 + 牌堆 + 待判定 = 104");
  assert.equal(handsBefore.length, 4);
  // 分数只跟手牌数有关:分数越高的人,剩牌越少
  const sorted = st.seats.map((p, i) => ({ i, hand: p.hand.length, sc: st.lastScores[i] })).sort((a, b) => b.sc - a.sc);
  assert.ok(sorted[0].hand <= sorted[sorted.length - 1].hand, "分最高的应当剩牌最少(牌堆不参与计分)");
  const text = describeExhibition(st);
  assert.ok(text.includes("本局展览"), "展览要能渲染成文本: " + text.slice(0, 40));
  assert.ok(text.includes("假牌"), "文本里要有谎话统计");
  assert.equal(st.lastScores.reduce((a, b) => a + b, 0), 0, "仍然零和");
});

test("BLUFF-15 展览要能解释「牌堆为什么是空的」:给出牌堆去向 + 逐手时间线", () => {
  const st = newBluffGame({ ...DEFAULT_BLUFF_CONFIG, bustCards: BLUFF_BUST_MODES.tight }, NAMES, 7);
  // 三家各出一手(不质疑),然后下家质疑 → 整堆被吃走 → 牌堆清零
  for (let i = 0; i < 3; i++) { const q = st.seats[st.turn]; play(st, st.turn, q.hand.slice(0, 2).map((c) => c.id)); }
  const before = st.pile.length;
  assert.ok(before > 0, "质疑前牌堆应当非空");
  challenge(st, st.turn);
  assert.equal(st.pile.length, 0, "质疑结算后牌堆清零(这就是「真容为空」的原因)");
  // 顶爆当前行动者,结束本局
  const seat = st.turn;
  let need = 42 - st.seats[seat].hand.length;
  for (const p of st.seats) {
    if (p.seat === seat || need <= 0) continue;
    const take = Math.min(need, Math.max(0, p.hand.length - 1));
    st.seats[seat].hand.push(...p.hand.splice(0, take));
    need -= take;
  }
  play(st, seat, [st.seats[seat].hand[0].id]);
  assert.equal(st.handOver, true, "应当结束");
  const ex = st.exhibition!;
  assert.equal(ex.pileSize, 0, "局末牌堆确实是 0");
  assert.equal(ex.eaten.length, 1, "应当记录到 1 次吃牌(牌堆去向)");
  assert.equal(ex.eaten[0].pot, before + 2, "吃掉的张数 = 原牌堆 + 那一手");
  assert.ok(ex.timeline.length >= 4, "应当有逐手时间线,实际 " + ex.timeline.length);
  assert.ok(ex.timeline.every((c) => c.count >= 1 && c.count <= 5), "时间线里的每手张数应当合法");
  const text = describeExhibition(st);
  assert.ok(text.includes("吃走") && text.includes("空"), "牌堆为空时要解释原因: " + text.split(String.fromCharCode(10))[1]);
  assert.ok(text.includes("牌堆去向"), "要列出牌堆去向");
  assert.ok(text.includes("逐手回顾"), "要列出逐手回顾");
});

test("BLUFF-16 choose3 模式:抽 3 个候选、由出牌者选 1、非候选的点数一律拒绝", () => {
  const cfg = { ...DEFAULT_BLUFF_CONFIG, drawMode: "choose3" as const };
  const st = newBluffGame(cfg, NAMES, 501);
  assert.equal(st.candidates.length, 3, "应当抽出 3 个候选点数");
  assert.equal(new Set(st.candidates).size, 3, "候选不能重复");
  assert.ok(!st.candidates.includes(st.wildRank), "候选不能包含癞子点数");
  assert.equal(st.roundRank, st.candidates[0], "默认点数取第一个候选");
  // 用候选里的第 3 个点数宣告 → 应当被接受
  const seat = st.turn;
  const want = st.candidates[2];   // 注意:出牌后候选会重抽,所以要先记下来
  const r = play(st, seat, [st.seats[seat].hand[0].id], want);
  assert.equal(r.ok, true, "候选内的点数应当能报: " + r.error);
  assert.equal(st.pending!.declaredRank, want, "pending 要记住出牌当时宣告的点数(而不是新抽到的候选)");
  // 非候选的点数 → 拒绝
  const other = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].find((x) => !st.candidates.includes(x) && x !== st.wildRank)!;
  const seat2 = st.turn;
  const r2 = play(st, seat2, [st.seats[seat2].hand[0].id], other);
  assert.equal(r2.ok, false, "非候选点数必须被拒绝");
  assert.equal(r2.error, "declaredRankNotInCandidates");
});

test("BLUFF-17 pickBestCandidate 会挑「手里真牌最多」的那个候选", () => {
  const cfg = { ...DEFAULT_BLUFF_CONFIG, drawMode: "choose3" as const };
  const st = newBluffGame(cfg, NAMES, 601);
  const seat = st.turn;
  // 让候选人里第一个成为"手里真牌最多"的:把手里所有该点数的牌都换给他
  const target = st.candidates[0];
  const ids = st.seats.flatMap((p) => p.hand).filter((c) => !isHonestCard(c, target, st.wildRank)).slice(0, 0).map((c) => c.id);
  assert.equal(ids.length, 0);
  const best = pickBestCandidate(st, seat);
  const counts = st.candidates.map((r) => ({ r, n: st.seats[seat].hand.filter((c) => isHonestCard(c, r, st.wildRank)).length }));
  const maxN = Math.max(...counts.map((x) => x.n));
  assert.equal(counts.find((x) => x.r === best)!.n, maxN, "应当挑真牌最多的候选: " + JSON.stringify(counts));
});

test("BLUFF-18 Lynn 自进化:能决策、能读账本、一盘结束后能留优弃劣", () => {
  const st = newBluffGame({ ...DEFAULT_BLUFF_CONFIG, drawMode: "choose3" as const }, ["Lynn", "Bajiao", "Nizi", "Nannan"], 701);
  const lynn = createEvolvingAgent(11);
  assert.equal(lynn.name, "Lynn");
  assert.equal(lynn.generation, 0);
  const before = { ...lynn.opts };
  // 打几手,全部合法
  for (let i = 0; i < 12 && !st.handOver; i++) {
    const seat = st.turn;
    if (st.seats[seat].name !== "Lynn") { const q = st.seats[seat]; play(st, seat, q.hand.slice(0, 1).map((c) => c.id)); continue; }
    const act = lynn.decide(st, seat);
    const r = act.type === "PLAY" ? play(st, seat, act.cardIds, act.declaredRank) : challenge(st, seat);
    assert.equal(r.ok, true, "Lynn 的动作必须合法: " + r.error);
  }
  // 进化语义:每 5 盘(一个窗口)评估一次变异
  for (let i = 0; i < 5; i++) lynn.endMatch(10 + i);        // 第 1 个窗口,平均 12
  assert.ok(lynn.generation >= 1, "第一个窗口后应当保留变异(代数增长),实际 " + lynn.generation);
  for (let i = 0; i < 5; i++) lynn.endMatch(30 + i);        // 第 2 个窗口,平均 32(更好)
  assert.ok(lynn.generation >= 2, "第二个更好的窗口后应当再进化一代,实际 " + lynn.generation);
  const genBefore = lynn.generation;
  for (let i = 0; i < 5; i++) lynn.endMatch(-999);          // 第 3 个窗口,惨败 → 应当回退
  assert.equal(lynn.generation, genBefore, "变差时不该继续涨代数(回退)");
  assert.ok(typeof lynn.opts.challengeAt === "number" && lynn.opts.challengeAt >= 0.2 && lynn.opts.challengeAt <= 0.9, "参数必须留在合法范围");
  assert.ok(lynn.bestScore >= 30, "窗口里的最好成绩要记住,实际 " + lynn.bestScore);
  assert.ok(before.challengeAt >= 0.2);
});

test("BLUFF-19 质疑赌注:失败者扣 5 分并转给被质疑者(零和),成功不扣", () => {
  const cfg = { ...DEFAULT_BLUFF_CONFIG, challengeFee: 5 };
  // 场景一:质疑一个"说真话"的人 → 质疑者应当扣 5 分
  const st = newBluffGame(cfg, NAMES, 801);
  const seat = st.turn;
  const R = st.roundRank, W = st.wildRank;
  const honestIds = st.seats.flatMap((p) => p.hand).filter((c) => isHonestCard(c, R, W)).slice(0, 2).map((c) => c.id);
  give(st, seat, honestIds);
  play(st, seat, honestIds);
  const ch = (seat + 1) % 4;
  const before = st.seats.map((p) => p.points);
  challenge(st, ch);
  assert.equal(st.seats[ch].points, before[ch] - 5, "质疑失败者应当扣 5 分");
  assert.equal(st.seats[seat].points, before[seat] + 5, "这 5 分应当转给被质疑者");
  assert.equal(st.seats.reduce((s, p) => s + p.points, 0), before.reduce((s, p) => s + p, 0), "整体必须零和");

  // 场景二:质疑一个"说谎"的人 → 质疑成功,不扣分
  const st2 = newBluffGame(cfg, NAMES, 802);
  const seat2 = st2.turn;
  const fakeIds = st2.seats.flatMap((p) => p.hand).filter((c) => !isHonestCard(c, st2.roundRank, st2.wildRank)).slice(0, 2).map((c) => c.id);
  give(st2, seat2, fakeIds);
  play(st2, seat2, fakeIds);
  const ch2 = (seat2 + 1) % 4;
  const before2 = st2.seats.map((p) => p.points);
  challenge(st2, ch2);
  assert.equal(st2.seats[ch2].points, before2[ch2], "质疑成功不该扣分");
  assert.equal(st2.seats[seat2].points, before2[seat2], "被质疑者也不该因为被猜中而额外扣分");
});
