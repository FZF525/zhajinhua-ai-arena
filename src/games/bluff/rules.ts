// 唬牌规则:发牌 / 出牌 / 质疑 / 判定 / 结算
import { createDeck } from "../../cards.ts";
import type { Card } from "../../cards.ts";
import type { Rng } from "../../rng.ts";
import type { BluffAction } from "./legal.ts";
import { cardCount, createBluffGame, isHonestCard, rankOf, rankText } from "./state.ts";
import type { BluffState } from "./state.ts";

export interface BluffResult { ok: boolean; error?: string; events?: Array<{ kind: string } & Record<string, unknown>> }

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** 抽一个非癞子点数(每回合重抽,公开) */
function drawRoundRank(st: BluffState): number {
  const ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].filter((r) => r !== st.wildRank);
  return ranks[Math.floor(st.rng.next() * ranks.length)];
}
/** 开新一局:洗牌、发牌、抽癞子(每局重抽)、庄家轮换并先手、抽本回合点数 */
export function startHand(st: BluffState): void {
  st.matchNo = Math.floor(st.handNo / st.cfg.handsPerMatch) + 1;
  st.deck = shuffle(createDeck(), st.rng);
  for (const p of st.seats) p.hand = [];
  st.pile = [];
  st.pending = null;
  st.claims = [];
  st.handOver = false;
  st.winnerSeat = null;
  st.bustedSeat = null;
  for (let i = 0; i < st.cfg.handSize; i++) for (const p of st.seats) p.hand.push(st.deck.pop()!);
  // 癞子:随机一个点数(每局重抽)
  const ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  st.wildRank = ranks[Math.floor(st.rng.next() * ranks.length)];
  // 庄家轮换,庄家先手
  st.dealer = (st.dealer + 1) % st.cfg.players;
  st.handNo += 1;
  st.turn = st.dealer;
  st.roundRank = drawRoundRank(st);
  st.events.push({ kind: "HAND_START", handNo: st.handNo, dealer: st.dealer, wildRank: st.wildRank, wildText: rankText(st.wildRank) });
}

/** 结算:零和 —— 每人得分 = (平均剩牌数 − 自己剩牌数) × 倍率 */
export function settleHand(st: BluffState): number[] {
  const sizes = st.seats.map((p) => p.hand.length);
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const scores = sizes.map((n) => Math.round((mean - n) * st.cfg.rate));
  // 严格零和:四舍五入会漂移几点,把误差补给分数最高的座位(照引擎处理底池余数的思路)
  const drift = scores.reduce((a, b) => a + b, 0);
  if (drift !== 0) {
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
    scores[best] -= drift;
  }
  st.lastScores = scores;
  scores.forEach((s, i) => { st.seats[i].points += s; });
  st.events.push({ kind: "HAND_END", handNo: st.handNo, winner: st.winnerSeat, busted: st.bustedSeat, scores });
  if (st.handNo >= st.cfg.handsPerMatch) st.over = true;   // 一盘 = 4 局
  return scores;
}

/** 局末展览:把牌堆翻出来,并给每个人结一份谎话账本(纯展示,不影响分数 ✓) */
function buildExhibition(st: BluffState): void {
  const pileOf: Record<number, number> = {};
  for (const c of st.pile) { const r = rankOf(c); pileOf[r] = (pileOf[r] ?? 0) + 1; }
  const perSeat = st.seats.map((p) => {
    const mine = st.claims.filter((c) => c.seat === p.seat);
    const lies = mine.reduce((s, c) => s + (c.count - c.honest), 0);
    const biggest = mine.reduce((mx, c) => Math.max(mx, c.count - c.honest), 0);
    return { seat: p.seat, name: p.name, claims: mine.length, cards: mine.reduce((s, c) => s + c.count, 0), lies, biggestLie: biggest };
  });
  // 牌堆经常在局末是空的:最后那次质疑把整堆吃走了 → 所以展览必须记录「去向」
  const eaten = st.events
    .filter((e) => e.kind === "CHALLENGE")
    .map((e) => ({ by: Number(e.by), against: Number(e.against), honest: Boolean(e.honest), eater: Number(e.eater), pot: Number(e.pot) }));
  // 逐手时间线:每一手报了几张、其中几张是真的(局末才公开,用于复盘与信誉)
  const timeline = st.claims.map((c) => ({ seat: c.seat, count: c.count, declared: c.claimedRank, honest: c.honest }));
  st.exhibition = { handNo: st.handNo, pileSize: st.pile.length, pileOf, eaten, timeline, perSeat };
  st.events.push({ kind: "EXHIBITION", handNo: st.handNo, pileSize: st.pile.length, perSeat });
}

function endHand(st: BluffState, winnerSeat: number | null, bustedSeat: number | null): void {
  st.handOver = true;
  st.winnerSeat = winnerSeat;
  st.bustedSeat = bustedSeat;
  buildExhibition(st);        // 先展览,再结算(顺序不影响,但展览要看牌堆原样)
  settleHand(st);
}

/** 结算后检查:出空 / 爆牌 */
function checkEnd(st: BluffState): void {
  if (st.handOver) return;
  const busted = st.seats.find((p) => p.hand.length > st.cfg.bustCards);
  if (busted) { endHand(st, null, busted.seat); return; }
  if (!st.pending) {
    const empty = st.seats.find((p) => p.hand.length === 0);
    if (empty) endHand(st, empty.seat, null);
  }
}

/** 建一局并直接发好牌 —— 请优先用它:createBluffGame 只是构造,忘了发牌会得到一个“全员 0 张”的死状态
 * (这个坑在实现里踩了两次:测试循环和擂台脚本都忘了调用 startHand) */
export function newBluffGame(cfg: Parameters<typeof createBluffGame>[0], names: string[], seed: number): BluffState {
  const st = createBluffGame(cfg, names, seed);
  startHand(st);
  return st;
}

export function legalActions(st: BluffState): BluffAction[] {
  if (st.handOver || st.over) return [];
  const p = st.seats[st.turn];
  const acts: BluffAction[] = [];
  if (st.pending && st.pending.seat !== st.turn) acts.push({ type: "CHALLENGE", seat: st.turn });
  const n = Math.min(st.cfg.maxPlay, p.hand.length);
  for (let k = 1; k <= n; k++) for (const combo of combinations(p.hand, k)) acts.push({ type: "PLAY", seat: st.turn, cardIds: combo.map((c) => c.id) });
  return acts;
}

function combinations(cards: Card[], k: number): Card[][] {
  const out: Card[][] = [];
  const rec = (start: number, cur: Card[]) => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i < cards.length; i++) { cur.push(cards[i]); rec(i + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return out;
}

/** 出牌:扣 1~maxPlay 张,宣告都是 roundRank;不能过牌 */
/** 出牌:扣 1~maxPlay 张,宣告都是 roundRank;不能过牌。
 * 注意顺序:先结算“上一手活了下来”(= 上家没被质疑)→ 若上家因此出空,他赢;
 * 这也是“最后一手可以被质疑”的实现:质疑窗口 = 下家的这一手。 */
export function play(st: BluffState, seat: number, cardIds: string[]): BluffResult {
  if (st.handOver) return { ok: false, error: "handOver" };
  if (seat !== st.turn) return { ok: false, error: "notTurn" };
  if (!cardIds.length) return { ok: false, error: "mustPlayAtLeastOne" };
  if (cardIds.length > st.cfg.maxPlay) return { ok: false, error: "tooManyCards" };
  const p = st.seats[seat];
  const toPlay: Card[] = [];
  for (const id of cardIds) {
    const idx = p.hand.findIndex((c) => c.id === id);
    if (idx < 0) return { ok: false, error: "cardNotInHand" };
    toPlay.push(p.hand[idx]);
  }
  const prevOwner = st.pending ? st.pending.seat : null;
  if (st.pending) { st.pile.push(...st.pending.cards); st.pending = null; }
  // 上家那一手没被质疑 → 若他已经出空,他赢这一局
  if (prevOwner !== null && st.seats[prevOwner].hand.length === 0) {
    endHand(st, prevOwner, null);
    return { ok: true, events: [st.events[st.events.length - 1]] };
  }
  // 正常出牌
  for (const c of toPlay) { const i = p.hand.findIndex((x) => x.id === c.id); p.hand.splice(i, 1); }
  st.pending = { seat, cards: toPlay, declaredRank: st.roundRank };
  // 记账:这一手里有几张是真的(局末展览 + 对手模型学习都用它)
  const honestCount = toPlay.filter((c) => isHonestCard(c, st.roundRank, st.wildRank)).length;
  st.claims.push({ seat, handNo: st.handNo, claimedRank: st.roundRank, count: toPlay.length, honest: honestCount });
  const ev = { kind: "PLAY", seat, count: toPlay.length, declaredRank: st.roundRank, declaredText: rankText(st.roundRank) };
  st.events.push(ev);
  st.turn = (seat + 1) % st.cfg.players;
  st.roundRank = drawRoundRank(st);
  checkEnd(st);
  return { ok: true, events: [ev] };
}
/** 质疑:上家说谎 → 上家吃下整堆;上家为真 → 质疑者吃下整堆。无论成败,都是质疑者继续出牌(循环不破) */
export function challenge(st: BluffState, seat: number): BluffResult {
  if (st.handOver) return { ok: false, error: "handOver" };
  if (seat !== st.turn) return { ok: false, error: "notTurn" };
  if (!st.pending) return { ok: false, error: "nothingToChallenge" };
  const pend = st.pending;
  const honest = pend.cards.every((c) => isHonestCard(c, pend.declaredRank, st.wildRank));
  const eater = honest ? seat : pend.seat;
  const pot = st.pile.concat(pend.cards);
  st.seats[eater].hand.push(...pot);
  st.pile = [];
  st.pending = null;
  const ev = { kind: "CHALLENGE", by: seat, against: pend.seat, honest, eater, pot: pot.length };
  st.events.push(ev);
  // 关键:无论成败,turn 都保持质疑者(他就是上家的下家)—— 1→2→3→4 循环不破
  st.turn = seat;
  st.roundRank = drawRoundRank(st);
  checkEnd(st);
  return { ok: true, events: [ev] };
}

export function applyBluff(st: BluffState, action: BluffAction): BluffResult {
  if (action.type === "PLAY") return play(st, action.seat, action.cardIds);
  if (action.type === "CHALLENGE") return challenge(st, action.seat);
  return { ok: false, error: "unknownAction" };
}

/** 不变量:牌数守恒 + 张数在界内 */
export function checkBluffInvariants(st: BluffState): string[] {
  const problems: string[] = [];
  const total = cardCount(st);
  const expect = st.cfg.handSize * st.cfg.players;
  if (total !== expect) problems.push("牌数守恒被破坏: " + total + " != " + expect);
  const ids = st.seats.flatMap((p) => p.hand.map((c) => c.id)).concat(st.pile.map((c) => c.id), st.pending ? st.pending.cards.map((c) => c.id) : []);
  if (new Set(ids).size !== ids.length) problems.push("出现重复卡牌");
  if (st.roundRank === st.wildRank && st.handNo > 0) problems.push("回合点数不应等于癞子点数");
  return problems;
}