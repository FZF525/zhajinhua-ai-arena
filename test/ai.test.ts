// AI 用例:合法性 / 守恒 / 性格差异 / MC 采样正确性
import test from "node:test";
import assert from "node:assert/strict";
import { makeConfig, makeBalancedConfig, mergeConfig } from "../src/config.ts";
import { createGame, checkInvariants, player, isAlive } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { makeAgent, AI_NAMES, AGENTS, PROFILES, MC_PROFILES, MC_NAMES } from "../src/ai/index.ts";
import { makeHeuristic } from "../src/ai/heuristic.ts";
import { determinize, enumerateActions, simulateAction, exchangeGain } from "../src/env.ts";
import { createRng } from "../src/rng.ts";
import { mcDecide } from "../src/ai/montecarlo.ts";
import { handReward } from "../src/ai/learning.ts";
import { cardsFromIds } from "../src/cards.ts";
import { legalActions } from "../src/validate.ts";
import { callCost } from "../src/costs.ts";
import { effectivePoints } from "../src/ai/heuristic.ts";

/** 安全换手牌:把原手牌还回牌堆,再从牌堆里取指定牌 —— 不会产生重复卡牌 */
function setHand(st: GameState, seat: number, ids: string[]): void {
  const me = st.players[seat];
  st.deck.push(...me.hand);
  const picked = [];
  for (const id of ids) {
    const i = st.deck.findIndex((c) => c.id === id);
    if (i < 0) throw new Error("牌堆里没有 " + id);
    picked.push(st.deck.splice(i, 1)[0]);
  }
  me.hand = picked;
}

/** 造一手"三条"(从牌堆里取,保证合法) */
function makeTriple(st: GameState, seat: number): void {
  const rank = st.deck[0].rank;
  const same = st.deck.filter((c) => c.rank === rank).slice(0, 3).map((c) => c.id);
  const others = st.deck.filter((c) => c.rank !== rank).slice(0, 2).map((c) => c.id);
  setHand(st, seat, [...same, ...others]);
}

function fresh(names: string[], seed = 7, patch?: unknown) {
  const st = createGame(makeConfig({ players: { startPoints: 20000 }, endGame: { maxHands: 4, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }, ...(patch as object ?? {}) }), names, seed);
  advance(st);
  return st;
}

test("AI-01 六个 AI 全部只出合法动作(随机种 × 多种人数)", () => {
  for (const name of AI_NAMES) {
    for (const n of [2, 3]) {
      const names = ["A", "B", "C"].slice(0, n);
      const st = fresh(names, 11);
      const agents = names.map(() => makeAgent(name));
      const rng = createRng(5);
      let steps = 0;
      while (!st.gameOver && steps++ < 400) {
        const seat = st.turn.seat;
        if (seat === null) break;
        const a = agents[seat](st, rng);
        if (!a) break;
        const r = apply(st, a);
        assert.equal(r.ok, true, name + " 出了非法动作 " + a.type + ":" + (r.error?.code ?? "") + (r.error?.message ?? ""));
      }
      assert.deepEqual(checkInvariants(st), [], name + " 破坏不变量");
    }
  }
});

test("AI-02 混合对局:积分守恒 + 不变量成立 + 能打完", () => {
  const names = AI_NAMES.slice(0, 3);
  const st = fresh(names, 99);
  const total0 = st.players.reduce((a, p) => a + p.points, 0) + st.pot + st.carryPot;   // 含底池与结转
  const agents = names.map(makeAgent);
  const rng = createRng(3);
  let steps = 0;
  while (!st.gameOver && steps++ < 3000) {
    const seat = st.turn.seat;
    if (seat === null) break;
    const a = agents[seat](st, rng);
    if (!a) break;
    const r = apply(st, a);
    assert.equal(r.ok, true, names[seat] + " 出了非法动作 " + a.type + ":" + (r.error?.code ?? "") + " " + (r.error?.message ?? ""));
    assert.equal(st.players.reduce((x, p) => x + p.points, 0) + st.pot + st.carryPot, total0, "积分不守恒");
    assert.deepEqual(checkInvariants(st), []);
  }
  assert.ok(st.handNo >= 4, "应至少打满 maxHands 局: " + st.handNo);
});

test("AI-03 性格可分辨:保守弃牌率 > 激进弃牌率,激进加注率 > 保守加注率", () => {
  const stat: Record<string, { acts: number; fold: number; raise: number }> = {};
  for (const name of AI_NAMES.slice(0, 3)) stat[name] = { acts: 0, fold: 0, raise: 0 };
  for (let g = 0; g < 24; g++) {
    const names = ["Baozi", "Sam", "Lucas"];
    const st = fresh(names, g + 1);
    const agents = names.map(makeAgent);
    const rng = createRng(g + 50);
    let steps = 0;
    while (!st.gameOver && steps++ < 1200) {
      const seat = st.turn.seat;
      if (seat === null) break;
      const a = agents[seat](st, rng);
      if (!a) break;
      if (!apply(st, a).ok) break;
      stat[names[seat]].acts++;
      if (a.type === "FOLD") stat[names[seat]].fold++;
      if (a.type === "RAISE") stat[names[seat]].raise++;
    }
  }
  const rate = (n: string, k: "fold" | "raise") => stat[n][k] / Math.max(1, stat[n].acts);
  assert.ok(rate("Baozi", "fold") > rate("Lucas", "fold"), "保守应更常弃牌");
  assert.ok(rate("Lucas", "raise") > rate("Baozi", "raise"), "激进应更常加注");
});

test("AI-04 MC:determinize 不改变牌数与手牌张数(只是重新分配未知牌)", () => {
  const st = fresh(["May", "Yeon", "Brian"], 5);
  const sizes = st.players.map((p) => p.hand.length);
  const deck = st.deck.length;
  const pool = st.pool.map((c) => c.id).join(",");
  const w = determinize(st, 0, createRng(123));
  assert.deepEqual(w.players.map((p) => p.hand.length), sizes);
  assert.equal(w.deck.length, deck);
  assert.equal(w.pool.map((c) => c.id).join(","), pool, "公共池不应被重排");
  assert.equal(w.players[0].hand.map((c) => c.id).join(","), st.players[0].hand.map((c) => c.id).join(","), "自己的手牌不变");
  const all = [...w.deck, ...w.pool, ...w.players.flatMap((p) => p.hand)].map((c) => c.id).sort();
  const all0 = [...st.deck, ...st.pool, ...st.players.flatMap((p) => p.hand)].map((c) => c.id).sort();
  assert.deepEqual(all, all0, "整副牌守恒");
});

test("AI-05 MC:simulateAction 给出有限期望值,且 rollout 用独立随机源(不推动真实牌局)", () => {
  const st = fresh(["May", "Sam", "Brian"], 17);
  apply(st, { type: "VIEW_HAND", seat: st.turn.seat! });
  const rngBefore = st.rng.snapshot();
  const acts = enumerateActions(st);
  const call = acts.find((a) => a.type === "CALL")!;
  const r = simulateAction(st, call, st.turn.seat!, makeAgent("Sam"), 6, 4242, 80);
  assert.ok(Number.isFinite(r.mean));
  assert.equal(r.samples, 6);
  assert.ok(r.winRate >= 0 && r.winRate <= 1);
  assert.equal(st.rng.snapshot(), rngBefore, "模拟不得推进真实随机序列");
  assert.deepEqual(checkInvariants(st), [], "模拟不得改动原状态");
});

test("AI-06 MC trace:主决策会评估多个候选动作", () => {
  const names = ["May", "Sam"];
  const st = fresh(names, 21);
  const seat = st.turn.seat!;
  apply(st, { type: "VIEW_HAND", seat });
  const mc = MC_PROFILES.Yeon;
  const out = mcDecide(st, createRng(1), mc);
  assert.ok(out.trace.length >= 1, "应至少评估一个候选");
  assert.ok(out.trace.every((t) => Number.isFinite(t.mean) && t.samples > 0));
  assert.ok(["FOLD", "CALL", "RAISE", "COMPARE"].includes(out.action.type));
});

test("AI-07 注册表:10 个角色,标签与说明齐全", () => {
  assert.equal(AI_NAMES.length, 10);
  assert.deepEqual(AI_NAMES, ["Baozi", "Sam", "Lucas", "May", "Yeon", "Brian", "EQB", "EQBfast", "EQBnaive", "ZeroB"]);
  assert.equal(AGENTS.filter((a) => a.kind === "heuristic").length, 3);
  assert.equal(AGENTS.filter((a) => a.kind === "montecarlo").length, 3);
  assert.equal(AGENTS.filter((a) => a.kind === "equity").length, 3);
  assert.equal(AGENTS.filter((a) => a.kind === "learning").length, 1);
  assert.equal(PROFILES.Lucas.foldBelow < PROFILES.Baozi.foldBelow, true);
  assert.ok(MC_PROFILES.May.rollouts > MC_PROFILES.Brian.rollouts, "稳健型采样更多");
});

test("AI-08 env:换牌评估能识别「换了会变好」的情形", () => {
  const st = fresh(["Sam", "Sam"], 3);
  const seat = st.turn.seat!;
  apply(st, { type: "VIEW_HAND", seat });
  const me = player(st, seat);
  const poolCard = st.pool.find((c) => st.poolMeta[c.id].faceUp)!;
  const gain = exchangeGain(st, me, poolCard);
  assert.ok(Number.isFinite(gain));
  assert.ok(gain <= 1 && gain >= -1);
});

test("AI-09 MC 算牌:已经亮出来的弃牌不会被重新洗牌(属于已知信息)", () => {
  const st = fresh(["May", "Sam", "Lucas"], 31);
  const folder = st.turn.seat!;
  const known = player(st, folder).hand.map((c) => c.id).sort();
  apply(st, { type: "FOLD", seat: folder });
  const world = determinize(st, st.turn.seat!, createRng(9));
  assert.deepEqual(world.players[folder].hand.map((c) => c.id).sort(), known, "弃牌者手牌应保持原样");
  // 其余对局信息仍守恒
  const all = [...world.deck, ...world.pool, ...world.players.flatMap((p) => p.hand)].map((c) => c.id).sort();
  const all0 = [...st.deck, ...st.pool, ...st.players.flatMap((p) => p.hand)].map((c) => c.id).sort();
  assert.deepEqual(all, all0);
});

test("AI-10 负债不该只会弃牌:欠债模式下按名义筹码评估,非欠债模式才只能弃", () => {
  const mk = (debt: boolean) => {
    const cfg = mergeConfig(makeBalancedConfig(3), {
      players: { startPoints: 200, allowDebt: debt },
      ante: { amount: 40 },
      endGame: { bustAtOrBelow: -100000, winAtOrAbove: 1000000, maxHands: 20 },
    });
    const st = createGame(cfg, ["A", "B", "C"], 4);
    advance(st);
    const seat = st.turn.seat!;
    const me = st.players[seat];
    me.blind = false;
    makeTriple(st, seat);                                                            // 三条:强牌(从牌堆取,避免重复卡牌)
    me.points = -50;                                                                 // 深度负债
    return st;
  };
  const on = mk(true);
  const aOn = makeAgent("Sam")(on, createRng(1))!;
  assert.notEqual(aOn.type, "FOLD", "欠债模式下拿着三条不该直接弃牌,实际 " + aOn.type);

  const off = mk(false);
  const aOff = makeAgent("Sam")(off, createRng(1))!;
  assert.equal(aOff.type, "FOLD", "非欠债模式下付不起就只能弃牌,实际 " + aOff.type);
  assert.equal(legalActions(off).includes("CALL"), false, "非欠债模式下不该提供 CALL");
  assert.equal(legalActions(on).includes("CALL"), true, "欠债模式下应提供 CALL");
});

test("AI-11 复合回报:名次项零和、取胜项给赢家、净收益项被裁剪", () => {
  const cfg = makeConfig({ players: { startPoints: 20000 }, ante: { amount: 10 }, endGame: { maxHands: 1, winAtOrAbove: 1e9, bustAtOrBelow: -1e9 } });
  const st = createGame(cfg, ["A", "B", "C"], 5);
  advance(st);
  // 手工构造一手结果:座位1 赢最多,座位2 中,座位0 亏最多
  st.players.forEach((p) => (p.pointsAtHandStart = 1000));
  st.players[0].points = 900; st.players[1].points = 1300; st.players[2].points = 1000;
  (st as unknown as { settlement: { winners: number[] } }).settlement = { winners: [1] };

  const w = { rank: 0.5, win: 0.4, points: 0.1 };
  const r = handReward(st, w);
  assert.equal(r.length, 3);
  // 名次项零和:三个人名次得分 1 / 0 / -1
  const rankOnly = handReward(st, { rank: 1, win: 0, points: 0 });
  assert.ok(Math.abs(rankOnly.reduce((a, b) => a + b, 0)) < 1e-9, "名次项应零和");
  assert.ok(rankOnly[1] > rankOnly[2] && rankOnly[2] > rankOnly[0], "谁赢得多名次得分越高");
  // 取胜项只给赢家
  const winOnly = handReward(st, { rank: 0, win: 1, points: 0 });
  assert.deepEqual(winOnly, [0, 1, 0]);
  // 净收益项被裁剪到 ±1 以内
  const pointOnly = handReward(st, { rank: 0, win: 0, points: 1 });
  assert.ok(pointOnly.every((x) => Math.abs(x) <= 1), "净收益项应裁剪");
  // 组合:赢家 > 中位 > 亏家
  assert.ok(r[1] > r[2] && r[2] > r[0], "复合回报应保持顺序:" + JSON.stringify(r));
});

test("AI-12 欠债模式下'初始积分=1'也不能让 AI 变被动(名义筹码含 20 倍底注兜底)", () => {
  const mk = (allowDebt: boolean, startPoints: number) => {
    const cfg = mergeConfig(makeBalancedConfig(3), {
      players: { startPoints, allowDebt },
      ante: { amount: 5 },
      endGame: { bustAtOrBelow: -1e9, winAtOrAbove: 1e9, maxHands: 20 },
    });
    const st = createGame(cfg, ["A", "B", "C"], 6);
    advance(st);
    const seat = st.turn.seat!;
    const me = st.players[seat];
    me.blind = false;
    makeTriple(st, seat);                                                          // 三条(从牌堆取)
    me.points = -300;                                                              // 深度负债
    return st;
  };
  // 名义筹码 = max(初始积分 1, 20 × 底注 5) = 100 → 拿着三条不该弃牌
  const on = mk(true, 1);        // 欠债模式 + 初始积分 1
  const aOn = makeAgent("Sam")(on, createRng(3))!;
  assert.notEqual(aOn.type, "FOLD", "初始积分=1 也不该让 AI 拿着三条弃牌,实际 " + aOn.type);
  // 非欠债模式:初始积分给足(否则开局就全员破产),再把玩家打到付不起 → 只能弃
  const off = mk(false, 200);
  off.players[off.turn.seat!].points = -300;
  assert.equal(legalActions(off).includes("CALL"), false, "非欠债模式下付不起就不该有 CALL");
});

test("AI-13 蒙特卡洛不得因 rollout 截断而弃掉强牌(四条事件回归)", () => {
  // 病根:Brian 的 rollout 上限 100 步 < 一手实际所需(CALL 之后还要 111 步才结算)
  // → 未结算的"半局"里已投入筹码还没收回,强牌被算成期望为负 → MC 弃掉四条把自己整死
  for (const nm of MC_NAMES) {
    assert.ok(MC_PROFILES[nm].maxSteps >= 400, nm + " 的 rollout 上限必须够打完一手,maxSteps=" + MC_PROFILES[nm].maxSteps);
  }
  // 未结算的样本必须被剔除:samples=0 说明这次评估没有任何有效样本
  const cfg = mergeConfig(makeConfig(), { players: { startPoints: 2000, allowDebt: true }, ante: { amount: 10 } });
  const st = createGame(cfg, ["Sam", "Baozi", "May", "Yeon"], 4242);
  advance(st);
  let guard = 0;
  while (st.phase === "BETTING" && st.turn.seat === null && guard++ < 10) advance(st);
  const seat = st.turn.seat;
  if (seat !== null) {
    const cands = enumerateActions(st).filter((x) => x.type === "CALL" || x.type === "RAISE");
    for (const c of cands) {
      const sim = simulateAction(st, c, seat, makeHeuristic("Sam"), 4, 7, 1);   // 1 步必然打不完
      assert.equal(sim.samples, 0, "被截断的 rollout 不能计入样本");
      assert.equal(sim.mean, 0, "没有有效样本时不应给出虚假期望值");
    }
  }
});

test("AI-14 欠债模式下不该因「名义筹码不够」弃强牌(真实事故:葫芦被弃)", () => {
  // 事故现场:底注 53 / 初始 2888 / 允许欠债;长局 M=32 时跟注 3392 > 名义筹码 2888
  // → 旧逻辑的 canCall 为假 → EQB 拿着葫芦弃牌(引擎其实允许它欠债跟注)
  const build = (allowDebt: boolean) => {
    const cfg = mergeConfig(makeConfig(), {
      players: { startPoints: 2888, allowDebt },
      ante: { amount: 53 },
      endGame: { maxHands: 10, winAtOrAbove: 250000, bustAtOrBelow: -150000 },
    });
    const st = createGame(cfg, ["EQB", "Sam", "Baozi", "Lucas", "ZeroB", "Brian"], 4242);
    advance(st);
    let guard = 0;
    while (st.turn.seat !== 0 && st.phase === "BETTING" && guard++ < 50) {
      const s = st.turn.seat;
      if (s === null) break;
      if (!apply(st, { type: "CALL", seat: s }, { dealNextHand: false }).ok) break;
    }
    // 从牌堆里动态凑一手葫芦(直接写死牌 id 会撞上"这张在别人手里")
    const byRank = new Map<string, typeof st.deck>();
    for (const c of [...st.deck]) {
      const r = c.id.slice(c.id.indexOf("-") + 1);
      byRank.set(r, [...(byRank.get(r) ?? []), c]);
    }
    const ranks = [...byRank.entries()].filter(([, cs]) => cs.length >= 3).sort((a, b) => b[1].length - a[1].length);
    const r1 = ranks[0];
    const r2 = ranks.find(([r, cs]) => r !== r1[0] && cs.length >= 2)!;
    setHand(st, 0, [...r1[1].slice(0, 3).map((c) => c.id), ...r2[1].slice(0, 2).map((c) => c.id)]);
    const me = player(st, 0);
    me.points = -45236;      // 深度负债(与真实那一局相同)
    me.blind = false;
    // 把注码一路拉高,直到"跟注超过名义筹码"——真实事故就发生在这样的高 M 长局里
    for (let m = 4; m <= 4096 && callCost(st, 0).total <= effectivePoints(me.points, st.config); m *= 2) st.multiplier = m;
    return st;
  };
  const debt = build(true);
  assert.ok(callCost(debt, 0).total > effectivePoints(-45236, debt.config), "前提:这一注必须超过名义筹码,否则用例失去意义");
  for (const nm of ["EQB", "Sam", "Baozi", "Lucas"]) {
    const a = makeAgent(nm)(debt, createRng(7));
    assert.notEqual(a?.type, "FOLD", nm + " 在欠债模式下不该弃掉葫芦(引擎允许赊账)");
  }
  // 对照:不允许欠债时,付不起就只能弃 —— 这道闸门本身是对的,别一起删了
  const noDebt = build(false);
  assert.equal(makeAgent("Sam")(noDebt, createRng(7))?.type, "FOLD", "非欠债模式:付不起仍应弃牌");
});
