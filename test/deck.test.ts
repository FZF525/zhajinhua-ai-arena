import test from "node:test";
import assert from "node:assert/strict";
import { createDeck, SUITS, RANKS, cardById, FAMILIES } from "../src/cards.ts";
import { createRng } from "../src/rng.ts";

test("D-01 牌堆 104 张,cardId 全局唯一", () => {
  const deck = createDeck();
  assert.equal(deck.length, 104);
  assert.equal(new Set(deck.map((c) => c.id)).size, 104);
});

test("D-02 每点数 8 张 / 每花色 13 张 / 每色系 26 张", () => {
  const deck = createDeck();
  for (const r of RANKS) assert.equal(deck.filter((c) => c.rank === r).length, 8, "点数 " + r);
  for (const s of SUITS) assert.equal(deck.filter((c) => c.suit === s.id).length, 13, s.id);
  for (const f of FAMILIES) assert.equal(deck.filter((c) => c.family === f).length, 26, f);
});

test("D-03 花色 → 色系映射正确", () => {
  assert.equal(cardById("HEART-A").family, "RED");
  assert.equal(cardById("DIAMOND-A").family, "RED");
  assert.equal(cardById("SPADE-A").family, "BLACK");
  assert.equal(cardById("CLUB-A").family, "BLACK");
  assert.equal(cardById("SNOW-A").family, "BLUE");
  assert.equal(cardById("DROPLET-A").family, "BLUE");
  assert.equal(cardById("STAR-A").family, "GOLD");
  assert.equal(cardById("MOON-A").family, "GOLD");
});

test("D-04 无大小王", () => {
  const deck = createDeck();
  assert.ok(deck.every((c) => c.rank >= 2 && c.rank <= 14));
});

test("D-05 同种子洗牌一致 / 不同种子不同", () => {
  const a = createRng(42).shuffle(createDeck()).map((c) => c.id).join(",");
  const b = createRng(42).shuffle(createDeck()).map((c) => c.id).join(",");
  const c = createRng(43).shuffle(createDeck()).map((x) => x.id).join(",");
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("D-06 洗牌是排列(多重集合不变)", () => {
  const src = createDeck().map((c) => c.id).sort().join(",");
  const out = createRng(7).shuffle(createDeck()).map((c) => c.id).sort().join(",");
  assert.equal(src, out);
});
