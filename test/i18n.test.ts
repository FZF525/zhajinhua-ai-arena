// 多语言护栏:键集一致 / 不留中文 / 默认语言不变 / 英文视图无中文
import test from "node:test";
import assert from "node:assert/strict";
import { keysOf, catalogOf, resolveLocale, t } from "../src/i18n.ts";
import { categoryLabel, describe as describeHand, evaluate } from "../src/evaluator.ts";
import { describeEvent } from "../src/format.ts";
import { buildView } from "../web/view.ts";
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { advance } from "../src/engine.ts";
import { cardsFromIds } from "../src/cards.ts";

const CJK = /[\u4e00-\u9fff]/;

test("I18N-01 中英目录键集必须完全一致(防漏翻)", () => {
  assert.deepEqual(keysOf("en"), keysOf("zh"), "两个目录的键必须一一对应");
  assert.ok(keysOf("zh").length > 40, "目录太小,可能没抽干净: " + keysOf("zh").length);
});

test("I18N-02 英文目录里不得残留中文", () => {
  for (const [k, v] of Object.entries(catalogOf("en"))) assert.ok(!CJK.test(v), k + " 没翻: " + v);
});

test("I18N-03 12 个牌型名中英齐全,且与术语表一致", () => {
  const cats = ["STRAIGHT_FLUSH", "FIVE_OF_A_KIND", "SAME_COLOR_STRAIGHT", "FLUSH", "FOUR_OF_A_KIND", "FULL_HOUSE",
    "SAME_COLOR", "STRAIGHT", "THREE_OF_A_KIND", "TWO_PAIR", "ONE_PAIR", "HIGH_CARD"] as const;
  for (const c of cats) {
    assert.ok(!CJK.test(categoryLabel(c, "en")), c + " 英文名不能是中文");
    assert.ok(CJK.test(categoryLabel(c, "zh")), c + " 中文名不能是英文");
  }
  // 术语表的关键约定:同色顺 = Colour Straight,同花顺 = Straight Flush,不能混
  assert.equal(categoryLabel("SAME_COLOR_STRAIGHT", "en"), "Colour Straight");
  assert.equal(categoryLabel("STRAIGHT_FLUSH", "en"), "Straight Flush");
  assert.equal(categoryLabel("FIVE_OF_A_KIND", "en"), "Five of a Kind");
});

test("I18N-04 事件日志支持英文,默认仍是中文(不破坏既有行为)", () => {
  const ante: never = { kind: "ANTE_PAID", seat: 2, amount: 45 } as never;
  assert.equal(describeEvent(ante), "座位2 交底注 45", "默认必须是中文");
  assert.equal(describeEvent(ante, { locale: "en" }), "Seat 2 posts ante 45");
  // 脱敏文案也要跟着语言走(否则英文界面里蹦出中文 [暗牌])
  const kick: never = { kind: "KICKED", seat: 3, removedId: "SPADE-K", drawnId: "MOON-7", cost: { total: 360 } } as never;
  const en = describeEvent(kick, { locale: "en", hideCardIds: new Set(["SPADE-K"]) });
  assert.ok(!CJK.test(en), "英文日志里不该有中文: " + en);
  assert.ok(en.includes("[hidden]"), "脱敏也要翻: " + en);
});

test("I18N-05 英文视图里不得出现中文(牌型/日志/面板)", () => {
  const cfg = makeConfig({ players: { startPoints: 2000 }, endGame: { maxHands: 2, winAtOrAbove: 1e9, bustAtOrBelow: -1 } });
  const st = createGame(cfg, ["Anna", "Ben", "Cleo"], 7);
  advance(st);
  const v = buildView(st, true, { locale: "en" }) as unknown as Record<string, unknown>;
  const text = JSON.stringify(v);
  const hits = text.match(/[\u4e00-\u9fff]+/g) ?? [];
  assert.deepEqual(hits, [], "英文视图里出现了中文: " + [...new Set(hits)].join(" / "));
  // 中文视图仍然有中文(证明不是把文案全删了)
  const zhView = JSON.stringify(buildView(st, true, { locale: "zh" }));
  assert.ok(CJK.test(zhView), "中文视图里应该有中文");
});

test("I18N-06 语言归一:en-US → en,不认识 → 中文", () => {
  assert.equal(resolveLocale("en-US,en;q=0.9"), "en");
  assert.equal(resolveLocale("zh-CN"), "zh");
  assert.equal(resolveLocale("fr-FR"), "zh");
  assert.equal(resolveLocale(null), "zh");
  // 缺键时回退中文而不是显示 key → 便于渐进翻译
  const zhCat = catalogOf("zh");
  const anyKey = Object.keys(zhCat)[0];
  assert.equal(t("zh", anyKey), zhCat[anyKey]);
});