// 外部 AI(LLM)入口用例:隐私隔离 / 解析 / 合法性 / 违规兜底 / 超时 / 端到端
import test from "node:test";
import assert from "node:assert/strict";
import { makeConfig } from "../src/config.ts";
import { createGame, checkInvariants, player } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { enumerateActions } from "../src/env.ts";
import { buildPrompt, parseAction, matchLegal, remoteDecide, newRemoteStats } from "../src/ai/remote.ts";
import type { RemoteConfig } from "../src/ai/remote.ts";

function fresh(names = ["A", "B", "C"], seed = 5) {
  const st = createGame(makeConfig({ players: { startPoints: 20000 }, endGame: { maxHands: 3, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true } }), names, seed);
  advance(st);
  return st;
}

/** 用注入的 fetch 冒充 LLM,answer 可以是字符串或函数(prompt => 字符串) */
function stub(answer: string | ((prompt: string) => string), opts: { hang?: boolean } = {}) {
  const calls: string[] = [];
  const impl = (async (_url: unknown, init: { body?: string; signal?: AbortSignal }) => {
    const body = JSON.parse(String(init.body ?? "{}")) as { messages: Array<{ role: string; content: string }> };
    const prompt = body.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    calls.push(prompt);
    if (opts.hang) {
      return await new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }
    const content = typeof answer === "function" ? answer(prompt) : answer;
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const cfgWith = (impl: typeof fetch, extra: Partial<RemoteConfig> = {}): RemoteConfig => ({
  name: "LLM", endpoint: "http://mock/v1/chat/completions", model: "mock", fetchImpl: impl, ...extra
});

test("RM-01 隐私:发给 LLM 的 prompt 里绝不含别人的手牌", () => {
  const st = fresh();
  const seen = st.turn.seat!;                        // A 看牌(牌面对引擎已知)
  apply(st, { type: "VIEW_HAND", seat: seen });
  const theirs = player(st, seen).hand.map((c) => c.id);
  const theirTexts = player(st, seen).hand.map((c) => c.text ?? c.id);
  apply(st, { type: "CALL", seat: seen });            // A 过牌 → 行动权交给 B
  const me = st.turn.seat!;
  assert.notEqual(me, seen);
  const prompt = buildPrompt(st, me, enumerateActions(st));
  for (const id of theirs) assert.equal(prompt.includes(id), false, "prompt 泄露了对手手牌 id: " + id);
  for (const t of theirTexts) assert.equal(prompt.includes(t), false, "prompt 泄露了对手牌面: " + t);
  // 也不能泄露牌堆
  assert.equal(prompt.includes("deck"), false);
});

test("RM-02 解析:裸 JSON / 代码块 / 夹带解释 都能抽出来;垃圾返回 null", () => {
  assert.deepEqual(parseAction('{"action":"CALL"}'), { type: "CALL" });                       // action → type 统一
  assert.deepEqual(parseAction('{"type":"FOLD"}'), { type: "FOLD" });                           // 引擎原生写法也认
  assert.deepEqual(parseAction("CALL"), { type: "CALL" });                                      // 裸字符串
  assert.deepEqual(parseAction('\u0060\u0060\u0060json\n{"action":"FOLD"}\n\u0060\u0060\u0060'), { type: "FOLD" });
  assert.deepEqual(parseAction('我认为应该跟注。{"action":"CALL","seat":2} 完毕'), { type: "CALL", seat: 2 });
  assert.equal(parseAction("我不知道该怎么办"), null);
  // 新增形状推断后,{"noop":1} 会变成一个"没有动作名"的候选 —— 但它必须在合法性校验那关被拒
  const bogus = parseAction('{"noop":1}');
  assert.equal(matchLegal(bogus, enumerateActions(fresh())), null, "字段对不上任何合法动作 → 必须拒绝");
});

test("RM-03 合法性:参数不对不放过;唯一候选时可救;未知类型拒绝", () => {
  const st = fresh();
  const legal = enumerateActions(st);
  const call = legal.find((a) => a.type === "CALL")!;
  assert.deepEqual(matchLegal({ ...call }, legal), call);
  assert.equal(matchLegal({ action: "ALLIN" } as never, legal), null);
  if (legal.some((a) => a.type === "EXCHANGE")) {
    const wrong = { type: "EXCHANGE", takeCardId: "NOT-A-CARD", giveCardId: "NOPE" } as never;
    const all = legal.filter((a) => a.type === "EXCHANGE");
    const got = matchLegal(wrong, legal);
    if (all.length === 1) assert.deepEqual(got, all[0], "唯一候选应救回");
    else assert.equal(got, null, "多候选时不能瞎猜");
  }
});

test("RM-04 违规兜底:LLM 返回非法动作 → 记违规并弃牌,比赛继续", async () => {
  const st = fresh();
  const seat = st.turn.seat!;
  const stats = newRemoteStats();
  const s = stub('{"action":"ALLIN"}');            // 引擎里没有这个动作,救不回来
  const { action, info } = await remoteDecide(cfgWith(s.impl), st, seat, stats);
  assert.equal(info.violation, "illegal");
  assert.equal(action.type, "FOLD");
  assert.equal(stats.violations, 1);
  assert.equal(stats.byViolation.illegal, 1);
  assert.equal(apply(st, action).ok, true, "兜底动作必须合法");

  // 补充:参数写错但该类型只有一个候选时,按"救回"处理(对弱模型友好)
  const st2 = fresh();
  const seat2 = st2.turn.seat!;
  const legal2 = enumerateActions(st2);
  const raiseLegal = legal2.filter((a) => a.type === "RAISE");
  const s2 = stub('{"action":"RAISE","toMultiplier":999}');
  const r2 = await remoteDecide(cfgWith(s2.impl), st2, seat2, newRemoteStats());
  if (raiseLegal.length === 1) {
    assert.equal(r2.info.violation, undefined, "唯一候选应被救回,不算违规");
    assert.equal(r2.action.type, "RAISE");
  }
});

test("RM-05 超时:LLM 不回话 → 记 timeout 并兜底,不卡死", async () => {
  const st = fresh();
  const seat = st.turn.seat!;
  const stats = newRemoteStats();
  const s = stub("", { hang: true });
  const t0 = Date.now();
  const { action, info } = await remoteDecide(cfgWith(s.impl, { timeoutMs: 80, fallback: "call" }), st, seat, stats);
  assert.equal(info.violation, "timeout");
  assert.equal(action.type, "CALL", "fallback=call 应跟注");
  assert.ok(Date.now() - t0 < 3000, "必须及时返回");
  assert.equal(stats.timeouts, 1);
});

test("RM-06 端到端:LLM 座位按合法动作打完 2 局,不变量成立、零违规", async () => {
  const names = ["LLM", "Sam", "May"];
  const st = createGame(makeConfig({
    players: { startPoints: 20000 },
    endGame: { maxHands: 2, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }
  }), names, 42);
  advance(st);
  // 冒充 LLM:永远挑第一个合法动作(保证合法)
  const s = stub((prompt) => {
    const call = prompt.match(/(\{"action":"CALL"[^\n]*\})/);
    const first = prompt.match(/\s0\)\s*(\{[^\n]*\})/);
    return call ? call[1] : (first ? first[1] : '{"action":"FOLD"}');
  });
  const cfg = cfgWith(s.impl);
  const others = [null, (await import("../src/ai/index.ts")).makeAgent("Sam"), (await import("../src/ai/index.ts")).makeAgent("May")];
  const rng = createRng(7);
  const stats = newRemoteStats();
  let steps = 0;
  while (!st.gameOver && steps++ < 400) {
    const seat = st.turn.seat;
    if (seat === null) break;
    const action = seat === 0 ? (await remoteDecide(cfg, st, seat, stats)).action : others[seat]!(st, rng)!;
    assert.equal(apply(st, action, { dealNextHand: false }).ok, true, "动作必须合法");
    assert.deepEqual(checkInvariants(st), []);
    if (st.phase === "HAND_START") advance(st);
  }
  assert.ok(st.handNo >= 2, "应至少打满 2 局: " + st.handNo);
  assert.equal(stats.violations, 0, "走合法动作时不应有违规");
  assert.ok(s.calls.length > 5, "应该真的调用过 LLM: " + s.calls.length);
});

test("RM-07 LLM 多回一个 reason 字段不应被判违规(否则真模型全会踩)", () => {
  const st = fresh();
  const legal = enumerateActions(st);
  const call = legal.find((a) => a.type === "CALL")!;
  const withReason = matchLegal({ type: "CALL", reason: "我先跟注看看" } as never, legal);
  assert.deepEqual(withReason, call, "带 reason 的 CALL 应匹配上真正的 CALL");
  const exchange = legal.find((a) => a.type === "EXCHANGE") as (typeof legal[number] & { takeCardId?: string; giveCardId?: string }) | undefined;
  if (exchange) {
    const r = matchLegal({ type: "EXCHANGE", takeCardId: exchange.takeCardId, giveCardId: exchange.giveCardId, reason: "换张好牌" } as never, legal);
    assert.deepEqual(r, exchange, "带 reason 的换牌也应匹配");
  }
  // 参数错了仍然要拒绝
  assert.equal(matchLegal({ type: "EXCHANGE", takeCardId: "X", giveCardId: "Y" } as never, legal.filter((a) => a.type === "EXCHANGE").length > 1 ? legal : []), null);
});

test("RM-08 思考型模型:正文为空时报 empty(带 finish_reason),只有推理内容时也能抽出来", async () => {
  const st = fresh();
  const seat = st.turn.seat!;
  // (a) 完全空正文 + finish_reason=length → 明确的 empty 诊断
  const emptyImpl = (async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "" } }] }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  const r1 = await remoteDecide(cfgWith(emptyImpl), st, seat, newRemoteStats());
  assert.equal(r1.info.violation, "empty");
  assert.equal(r1.info.finishReason, "length");
  assert.equal(r1.action.type, "FOLD", "兜底仍是合法动作");

  // (b) 正文为空但推理里有动作 → 抽出来用
  const reasoningImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "", reasoning_content: '先看牌。{\\"action\\":\\"VIEW_HAND\\"}' } }] }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  const r2 = await remoteDecide(cfgWith(reasoningImpl), st, seat, newRemoteStats());
  assert.equal(r2.info.raw.includes("VIEW_HAND"), true);
});

test("RM-09 参数被嵌进 action / 缺动作名:用字段形状反推(救回 v4-pro 那类回复)", () => {
  const st = fresh();
  const legal = enumerateActions(st);
  const ex = legal.find((a) => a.type === "EXCHANGE") as (typeof legal[number] & { takeCardId?: string; giveCardId?: string }) | undefined;
  if (ex) {
    // 真实模型写法:{"reason":"…","action":{"takeCardId":…,"giveCardId":…}}
    const nested = parseAction(JSON.stringify({ reason: "换这张能变两对", action: { takeCardId: ex.takeCardId, giveCardId: ex.giveCardId } }));
    assert.ok(nested, "应该能解析出半成品动作");
    assert.deepEqual(matchLegal(nested, legal), ex, "应按字段形状唯一匹配到那手换牌");
  }
  // action 里带 type 的嵌套写法
  assert.deepEqual(parseAction('{"action":{"type":"CALL"}}'), { type: "CALL" });
  // 只有 reason、没有参数 → 解析失败(不硬猜)
  assert.equal(parseAction('{"reason":"我再想想"}'), null);
  // 参数对不上任何合法动作 → 不匹配
  assert.equal(matchLegal(parseAction('{"action":{"takeCardId":"NOT-A-CARD","giveCardId":"NOPE"}}'), legal), null);
});

test("RM-10 prompt 自洽:system 不能要求'不要解释'而 user 又要求'先写理由'(否则模型会卡在这条矛盾上烧光 token)", async () => {
  const st = fresh();
  const seat = st.turn.seat!;
  let systemContent = "";
  let userContent = "";
  const spy = (async (_u: unknown, init: { body?: string }) => {
    const b = JSON.parse(String(init.body ?? "{}")) as { messages: Array<{ role: string; content: string }> };
    systemContent = b.messages.find((m) => m.role === "system")?.content ?? "";
    userContent = b.messages.find((m) => m.role === "user")?.content ?? "";
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"CALL"}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  await remoteDecide(cfgWith(spy), st, seat, newRemoteStats());
  assert.ok(systemContent.length > 0 && userContent.length > 0);
  const userWantsReason = userContent.includes("reason");
  const sysForbids = /不要(输出)?任何解释|不要解释/.test(systemContent);
  assert.equal(userWantsReason && sysForbids, false, "system 与 user 指令矛盾:user 要理由,system 却禁止解释");
  assert.ok(systemContent.includes("reason"), "system 应明确允许 reason");
});

test("RM-11 json-mode:开启后请求体要带 response_format=json_object(专治分析被截断)", async () => {
  const st = fresh();
  const seat = st.turn.seat!;
  let body: Record<string, unknown> = {};
  const spy = (async (_u: unknown, init: { body?: string }) => {
    body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"CALL"}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  await remoteDecide(cfgWith(spy, { jsonMode: true }), st, seat, newRemoteStats());
  assert.deepEqual(body.response_format, { type: "json_object" });
  const spy2 = (async (_u: unknown, init: { body?: string }) => {
    body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"CALL"}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  await remoteDecide(cfgWith(spy2), st, seat, newRemoteStats());
  assert.equal(body.response_format, undefined, "没开启时不应带上");
});
