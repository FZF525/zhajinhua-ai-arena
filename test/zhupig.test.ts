// 八门拱猪·星月版:出牌规则 + 算分器(表驱动)
// "八门" = 8 个花色;特殊牌 = 具体花色+点数;红桃 = HEART 花色
import test from "node:test";
import assert from "node:assert/strict";
import { createDeck } from "../src/cards.ts";
import type { Card } from "../src/cards.ts";
import { CLASSIC_ZHUPIG, type ZhupigState, type ZpPlay } from "../src/games/zhupig/state.ts";
import { dealZhupig, legalZhupig, playZhupig, checkZhupigInvariants, declareShow } from "../src/games/zhupig/rules.ts";
import { scoreZhupig } from "../src/games/zhupig/score.ts";

const DECK = createDeck();
const C = (id: string): Card => {
  const c = DECK.find((x) => x.id === id);
  if (!c) throw new Error("没有这张牌: " + id);
  return { ...c };
};
/** 直接造收牌堆,专测算分 */
function mk(piles: Array<Array<[string, boolean?]>>, cfg = CLASSIC_ZHUPIG): ZhupigState {
  const seats = piles.map((pile, seat) => ({
    seat, name: "P" + seat, hand: [] as Card[],
    pile: pile.map(([id, lit]) => ({ seat, card: C(id), revealed: Boolean(lit) })) as ZpPlay[],
  }));
  return { cfg, seats, trick: { ledSuit: "", plays: [], winner: null }, lastTrick: null,
    leader: 0, turn: 0, trickNo: 1, over: false, ledger: [], discard: [] } as unknown as ZhupigState;
}
const HEARTS_12 = ["HEART-A", "HEART-K", "HEART-Q", "HEART-J", "HEART-10", "HEART-9", "HEART-7", "HEART-6", "HEART-5", "HEART-4", "HEART-3", "HEART-2"];

test("ZP-01 发牌:104 张均分(每人26)、无重复、先手=方片3持有者", () => {
  const st = dealZhupig(CLASSIC_ZHUPIG, ["A", "B", "C", "D"], 42);
  assert.equal(st.seats.every((s) => s.hand.length === 26), true, "每人 26 张");
  assert.deepEqual(checkZhupigInvariants(st), [], "不变量成立");
  const holder = st.seats.find((s) => s.hand.some((c) => c.id === "DIAMOND-3"))!.seat;
  assert.equal(st.leader, holder, "先手应当是方片3持有者");
});

test("ZP-02 跟牌:有同花色必跟,无同花色可贴", () => {
  const st = dealZhupig(CLASSIC_ZHUPIG, ["A", "B", "C", "D"], 7);
  const lead = st.turn;
  const first = st.seats[lead].hand[0];
  assert.equal(playZhupig(st, lead, first.id).ok, true);
  const nxt = st.turn;
  const same = st.seats[nxt].hand.filter((c) => c.suit === first.suit);
  const legal = legalZhupig(st, nxt);
  if (same.length) {
    assert.equal(legal.every((c) => c.suit === first.suit), true, "必须跟同花色");
    const off = st.seats[nxt].hand.find((c) => c.suit !== first.suit);
    if (off) assert.equal(playZhupig(st, nxt, off.id).ok, false, "贴异花色必须被拒");
  } else assert.equal(legal.length, st.seats[nxt].hand.length);
});

test("ZP-03 牌权:贴牌不算赢(即使点数更大)", () => {
  const st = mk([[], [], [], []]);
  st.trick = { ledSuit: "DIAMOND", plays: [], winner: null };
  st.seats[0].hand.push(C("DIAMOND-5"));
  st.seats[1].hand.push(C("SPADE-A"));
  st.seats[2].hand.push(C("DIAMOND-K"));
  st.seats[3].hand.push(C("DIAMOND-6"));   // 注意:不用 ♦2,用 ♦6 以免和先手判定混淆
  st.turn = 0;
  for (let i = 0; i < 4; i++) playZhupig(st, i, st.seats[i].hand[0].id);
  assert.equal(st.lastTrick!.winner, 2, "牌权归 ♦K,贴牌 ♠A 不算");
});

test("ZP-04 收牌:该轮的特殊牌进赢家收牌堆", () => {
  const st = mk([[], [], [], []]);
  st.trick = { ledSuit: "SPADE", plays: [], winner: null };
  st.seats[0].hand.push(C("SPADE-A"));    // 赢家
  st.seats[1].hand.push(C("SPADE-Q"));    // 猪
  st.seats[2].hand.push(C("HEART-5"));    // 红桃
  st.seats[3].hand.push(C("SPADE-9"));
  st.turn = 0;
  for (let i = 0; i < 4; i++) playZhupig(st, i, st.seats[i].hand[0].id);
  assert.equal(st.lastTrick!.winner, 0);
  assert.equal(st.seats[0].pile.length, 2, "赢家应当收到 猪 + 红桃 两张特殊牌");
});

test("ZP-05 星刀:不亮砍后继1个,亮出砍后继2个", () => {
  assert.equal(scoreZhupig(mk([[["STAR-8"], ["HEART-5"], ["HEART-6"]]])).perSeat[0].invalidated.length, 1);
  assert.equal(scoreZhupig(mk([[["STAR-8", true], ["HEART-5"], ["HEART-6"]]])).perSeat[0].invalidated.length, 2);
});

test("ZP-06 月刀:砍前驱(不亮1 / 亮2)", () => {
  assert.equal(scoreZhupig(mk([[["HEART-5"], ["HEART-6"], ["MOON-8"]]])).perSeat[0].invalidated.length, 1);
  assert.equal(scoreZhupig(mk([[["HEART-5"], ["HEART-6"], ["MOON-8", true]]])).perSeat[0].invalidated.length, 2);
});

test("ZP-07 同收双8:砍失效,自身负分照算", () => {
  const r = scoreZhupig(mk([[["STAR-8"], ["HEART-5"], ["MOON-8"], ["HEART-6"]]]));
  assert.equal(r.perSeat[0].invalidated.length, 0, "同收双8 → 不砍任何条目");
  const both = r.perSeat[0].entries.filter((e) => e.kind === "star8" || e.kind === "moon8");
  assert.equal(both.every((e) => e.value === -25), true, "两个刀各 -25 照算");
});

test("ZP-08 不连锁:被砍的刀不能再砍", () => {
  const r = scoreZhupig(mk([[["STAR-8"], ["MOON-8"], ["HEART-5"]]]));
  const h5 = r.perSeat[0].entries.find((e) => e.cardId === "HEART-5")!;
  assert.equal(h5.invalid, false, "被砍的月牙不能再砍 HEART-5");
});

test("ZP-09 被砍红桃:0 分且破坏全红", () => {
  const r = scoreZhupig(mk([[["HEART-5"], ["HEART-6"], ["MOON-8", true], ["HEART-7"]]]));
  assert.ok(r.perSeat[0].invalidated.length >= 1);
  assert.equal(r.perSeat[0].allRed, false);
});

test("ZP-10 变压器:有红桃加倍 / 无红桃 +50 / 亮 +100 / 被砍不补偿", () => {
  assert.equal(scoreZhupig(mk([[["HEART-5"], ["HEART-6"], ["CLUB-10"]]])).perSeat[0].transformer, 20);
  assert.equal(scoreZhupig(mk([[["CLUB-10"]]])).perSeat[0].transformer, 50, "无红桃 → +50");
  assert.equal(scoreZhupig(mk([[["CLUB-10", true]]])).perSeat[0].transformer, 100, "亮出 → +100");
  assert.equal(scoreZhupig(mk([[["STAR-8"], ["CLUB-10"], ["HEART-5"]]])).perSeat[0].transformer, 0, "被砍 → 不补偿");
});

test("ZP-11 水滴9:个人分≠0 减半 / =0 则 -50", () => {
  assert.equal(scoreZhupig(mk([[["HEART-5"], ["DROPLET-9"]]])).perSeat[0].water9, -5, "10 → 减半 → 变动 -5");
  assert.equal(scoreZhupig(mk([[["DROPLET-9"]]])).perSeat[0].water9, -50, "个人分 0 → -50");
});

test("ZP-12 ★ +800 在公式前 → 最终差 2400(证明被放大 3 倍)", () => {
  // 关键做法:**同一手牌**,只把 full16Bonus 归零 → 差异就只剩那笔 +800 ✓(控制变量)
  const pile: Array<[string, boolean?]> = [...HEARTS_12.map((id) => [id] as [string]), ["HEART-8"], ["SPADE-Q"], ["DIAMOND-J"], ["CLUB-10"]];
  const withBonus = scoreZhupig(mk([pile, [], [], []]));
  const noBonusCfg = { ...CLASSIC_ZHUPIG, specials: { ...CLASSIC_ZHUPIG.specials, full16Bonus: 0 } };
  const noBonus = scoreZhupig(mk([pile, [], [], []], noBonusCfg));
  const with16 = withBonus, without = noBonus;
  assert.equal(with16.perSeat[0].full16, true, "13 张红桃 + 猪羊变压器 → 原16 齐全");
  assert.equal(without.perSeat[0].full16, true, "同一手牌,只是把奖励值归零(仍判齐全)");
  assert.equal(with16.perSeat[0].personal - without.perSeat[0].personal, 800, "个人分差 800");
  assert.equal(with16.perSeat[0].final - without.perSeat[0].final, 2400, "★ 最终分差 2400(被公式放大 3 倍)");
});

test("ZP-13 公式:四家最终总和恒为 0", () => {
  const r = scoreZhupig(mk([[["HEART-5"]], [["HEART-6"]], [["HEART-7"]], [["HEART-9"]]]));
  assert.equal(r.perSeat.reduce((a, x) => a + x.final, 0), 0);
});

test("ZP-14 雪花分值 +5/+10/+20(亮出翻倍)", () => {
  assert.equal(scoreZhupig(mk([[["SNOW-5"]]])).perSeat[0].snow, 5);
  assert.equal(scoreZhupig(mk([[["SNOW-10"]]])).perSeat[0].snow, 10);
  assert.equal(scoreZhupig(mk([[["SNOW-K"]]])).perSeat[0].snow, 20);
  assert.equal(scoreZhupig(mk([[["SNOW-K", true]]])).perSeat[0].snow, 40, "亮出 K 翻倍 → +40");
});

test("ZP-15 全红 +200,且**不与原16叠加**", () => {
  const hearts13: Array<[string, boolean?]> = [...HEARTS_12.map((id) => [id] as [string]), ["HEART-8"]];
  const cfgNoRed = { ...CLASSIC_ZHUPIG, specials: { ...CLASSIC_ZHUPIG.specials, allRedBonus: 0 } };
  const withRed = scoreZhupig(mk([hearts13, [], [], []]));
  const noRed = scoreZhupig(mk([hearts13, [], [], []], cfgNoRed));
  assert.equal(withRed.perSeat[0].allRed, true, "13 张红桃应当判全红");
  assert.equal(withRed.perSeat[0].personal - noRed.perSeat[0].personal, 200, "全红 +200");
  // 原16 齐全时(天然包含全红)→ 只给 +800,不再叠加 +200
  const full16Pile: Array<[string, boolean?]> = [...hearts13, ["SPADE-Q"], ["DIAMOND-J"], ["CLUB-10"]];
  const f16 = scoreZhupig(mk([full16Pile, [], [], []]));
  assert.equal(f16.perSeat[0].full16, true);
  const f16NoRed = scoreZhupig(mk([full16Pile, [], [], []], cfgNoRed));
  assert.equal(f16.perSeat[0].personal, f16NoRed.perSeat[0].personal, "原16 齐全时不应再叠加全红 +200");
});

test("ZP-16 亮牌:只能亮门主与有亮出效果的牌(♥4 不许亮),且必须在开局前", () => {
  const st = dealZhupig(CLASSIC_ZHUPIG, ["A", "B", "C", "D"], 99);
  // 造一手可测的牌:确保手里有 ♥4 和 ♥A
  const s0 = st.seats[0];
  s0.hand = [C("HEART-4"), C("HEART-A"), C("SNOW-K"), C("SNOW-5"), C("SPADE-2")];
  assert.equal(declareShow(st, 0, ["HEART-4"]).ok, false, "♥4 不许亮");
  assert.equal(declareShow(st, 0, ["SNOW-5"]).ok, false, "雪花 5 不许亮(只有雪花门主 K 能亮)");
  assert.equal(declareShow(st, 0, ["HEART-A"]).ok, true, "♥A 可以亮");
  assert.equal(declareShow(st, 0, ["SNOW-K"]).ok, true, "SNOW-K 可以亮");
  // 开局后不许再改
  const lead = st.turn;
  const firstLegal = legalZhupig(st, lead)[0];
  playZhupig(st, lead, firstLegal.id);
  assert.equal(declareShow(st, 0, []).ok, false, "开局之后不能再改亮牌");
});

test("ZP-18 亮出 ♥A → 全场红桃分值 ×2(不只是自己那张)", () => {
  // 甲亮 ♥A 且自己收了 ♥A + ♥5;乙收了 ♥K —— 两边都应当翻倍(作者:其他同花色分牌都翻倍)
  const r = scoreZhupig(mk([
    [["HEART-A", true], ["HEART-5"]],        // 甲:亮出的 ♥A(50→100)+ ♥5(10→20)
    [["HEART-K"]],                            // 乙:♥K 40 → 80(全场加倍)
    [["SNOW-5"]],                             // 雪花不受影响
    [],
  ]));
  assert.equal(r.perSeat[0].heartsEffective, 100 + 20, "甲的红桃应当 ×2(♥A 50→100 且 ♥5 10→20)");
  // ★ 作者定稿:"都需要算" —— 门主自己那张也加倍(60 行的 100 已经隐含,这里再单独钉死)
  const ace = r.perSeat[0].entries.find((e) => e.cardId === "HEART-A")!;
  assert.equal(ace.heartValue, 100, "门主 ♥A 自己也要 50→100(不只是其他红桃)");
  assert.equal(r.perSeat[1].heartsEffective, 80, "乙的红桃也应当 ×2(全场)");
  assert.equal(r.perSeat[2].snow, 5, "雪花不受红桃门主影响");
});

test("ZP-19 亮出 SNOW-K → 全场雪花分值 ×2;红桃不受影响", () => {
  const r = scoreZhupig(mk([
    [["SNOW-K", true], ["SNOW-5"]],          // 甲:SNOW-K 20→40,SNOW-5 5→10
    [["SNOW-10"]],                            // 乙:SNOW-10 10→20(全场)
    [["HEART-5"]],                            // 红桃不受影响
    [],
  ]));
  assert.equal(r.perSeat[0].snow, 40 + 10, "甲的雪花 ×2");
  assert.equal(r.perSeat[1].snow, 20, "乙的雪花也 ×2");
  assert.equal(r.perSeat[2].heartsEffective, 10, "红桃不受雪花门主影响");
});

test("ZP-20 其他特殊牌的自身亮出效果仍然生效(变压器 ×4 / 水滴 1/4),不受门主影响", () => {
  const litTransformer = scoreZhupig(mk([[["HEART-5"], ["CLUB-10", true]]]));
  assert.equal(litTransformer.perSeat[0].transformer, 30, "红桃 10 → 亮出变压器 ×4 → 追加 30");
  const litWater = scoreZhupig(mk([[["SNOW-5"], ["DROPLET-9", true]]]));
  assert.equal(litWater.perSeat[0].water9, -3.75, "个人分 5 → 水滴 1/4 → 变动 -3.75");
});
