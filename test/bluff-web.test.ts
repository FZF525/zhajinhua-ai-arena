// 唬牌 Web 端到端:真起服务走一遍(今天的教训:服务端改动必须真跑一次)
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createBluffSession, bluffSeatView, bluffRunAiOne, CHALLENGE_PRESETS } from "../web/bluff-session.ts";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = 8960 + Math.floor(Math.random() * 100);
const BASE = "http://127.0.0.1:" + PORT;

async function waitHealth(tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(BASE + "/api/health"); if (r.ok) return; } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error("服务端没起来");
}

test("BLUFF-WEB-01 真起服务打几手唬牌(含展览面板与切换爆牌线)", async () => {
  const child = spawn(process.execPath, [join(ROOT, "web", "server.ts"), "--port=" + PORT], { cwd: ROOT, stdio: "ignore" });
  try {
    await waitHealth();
    const page = await fetch(BASE + "/bluff");
    assert.equal(page.status, 200, "唬牌页面应当能被打开");
    assert.ok((await page.text()).includes("唬牌 Bluff"), "页面内容应当是唬牌");

    const created = await (await fetch(BASE + "/api/bluff/new", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bust: "tight", seats: ["human", "Bajiao", "Nizi", "Lao6"] }) })).json();
    assert.equal(created.ok, true, "开新盘必须成功: " + JSON.stringify(created));
    assert.ok(created.view.hand.length > 0, "应当拿到自己的手牌");
    assert.equal(created.view.seats.length, 4);

    // 打 40 手(人类座位交替：出牌 / 偶尔质疑),看能不能推到局末展览
    let sawExhibition = false;
    for (let i = 0; i < 40 && !sawExhibition; i++) {
      const st = await (await fetch(BASE + "/api/bluff/state?seat=0")).json();
      assert.equal(st.ok, true);
      if (st.view.exhibition) { sawExhibition = true; break; }
      if (st.view.handOver) {
        await fetch(BASE + "/api/bluff/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat: 0 }) });
        continue;
      }
      if (st.view.turn !== 0) {
        // 不是我的回合 → 推进一步,让 AI 慢慢走(新流程:服务端不再一口气跑完)
        const sres = await (await fetch(BASE + "/api/bluff/step", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat: 0 }) })).json();
        assert.equal(sres.ok, true, "step 必须成功: " + JSON.stringify(sres));
        continue;
      }
      const body = st.view.legal.canChallenge && i % 5 === 4
        ? { seat: 0, type: "CHALLENGE" }
        : { seat: 0, type: "PLAY", cardIds: st.view.hand.slice(0, Math.min(2, st.view.hand.length)).map((c: { id: string }) => c.id) };
      const r = await (await fetch(BASE + "/api/bluff/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
      assert.equal(r.ok, true, "动作应当被接受: " + JSON.stringify(r));
      // 出完牌后再推一步,确保 AI 会跟上(而不是靠 action 顺带跑完)
      const after = await (await fetch(BASE + "/api/bluff/step", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat: 0 }) })).json();
      assert.equal(after.ok, true);
    }
    const last = await (await fetch(BASE + "/api/bluff/state?seat=0")).json();
    assert.equal(last.ok, true);
    assert.equal(last.view.seats.reduce((s: number, x: { cards: number }) => s + x.cards, 0) + last.view.pileCount <= 104, true, "牌数不该超过一副");
    // 回归:热座坐错座位时必须明确拒绝,并告诉现在轮到谁(实测踩到:视角在座位 2 而轮到座位 0 → 界面卡死)
    const wrong = await (await fetch(BASE + "/api/bluff/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat: 2, type: "PLAY", cardIds: [] }) })).json();
    assert.equal(wrong.ok, false, "不该允许替别的座位行动");
    assert.ok(String(wrong.error).includes("还没轮到你"), "错误要说清: " + wrong.error);

    // 传旧的/错误的座位类型必须明确报错(而不是悄悄降级 —— 那会让前端表现成「点了没反应」)
    const bad = await (await fetch(BASE + "/api/bluff/new", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bust: "tight", seats: ["human", "standard", "standard", "gambler"] }) })).json();
    assert.equal(bad.ok, false, "旧的座位名 standard 应当被明确拒绝");
    assert.ok(String(bad.error).includes("未知的座位类型"), "错误信息要说明原因: " + bad.error);

    // 切换爆牌线也要能开新盘
    const loose = await (await fetch(BASE + "/api/bluff/new", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bust: "loose", seats: ["human", "Bajiao", "Bajiao", "Bajiao"] }) })).json();
    assert.equal(loose.ok, true, "52 爆牌线也要能开局");
  } finally {
    child.kill();
  }
});
test("BLUFF-WEB-02 质疑账本盘中必须藏住,只有一盘结束才揭晓", async () => {
  const s = createBluffSession({ bust: "loose", kinds: ["Lao6", "Nizi", "Nannan", "Caocao"], drawMode: "choose3", challenge: CHALLENGE_PRESETS.standard });
  const v0 = bluffSeatView(s, 0);
  assert.equal(v0.challengeReveal, null, "开局时绝不能有账本");
  assert.equal(v0.challengeRule.fee, 5, "默认预设应当是 -5");
  assert.equal(v0.challengeRule.win, 3, "默认预设应当是 +3");
  assert.equal(v0.challengeRule.bluffBonus, 0.5, "默认撒谎奖励应当是 0.5(实测最均衡)");
  assert.equal(v0.challengeRule.learnAlpha, 1, "默认学习平滑应当是 1(6 时桌上没人质疑)");
  const s3 = createBluffSession({ bust: "loose", kinds: ["human", "Bajiao", "Nizi", "Nannan"], learnAlpha: 6 });
  assert.equal(bluffSeatView(s3, 0).challengeRule.learnAlpha, 6, "可以调回慢学习");
  const s2 = createBluffSession({ bust: "loose", kinds: ["human", "Bajiao", "Nizi", "Nannan"], bluffBonus: 0 });
  assert.equal(bluffSeatView(s2, 0).challengeRule.bluffBonus, 0, "可以关掉撒谎奖励");
  assert.ok(!JSON.stringify(v0).includes("challengeReveal\":{" ), "视图里不该出现账本内容");
  // 一路打到一盘结束
  let guard = 0;
  while (!s.state.over && guard++ < 4000) {
    await bluffRunAiOne(s);
    const v = bluffSeatView(s, 0);
    if (!s.state.over) assert.equal(v.challengeReveal, null, "盘中任何时候都不能揭晓账本(第 " + guard + " 步)");
  }
  assert.equal(s.state.over, true, "应当能打完一盘");
  const vEnd = bluffSeatView(s, 0);
  assert.ok(Array.isArray(vEnd.challengeReveal), "盘末必须揭晓质疑账本");
  assert.equal(vEnd.challengeReveal!.length, 4, "四个座位都要有");
  const sumBonus = vEnd.challengeReveal!.reduce((a, b) => a + b.bonus, 0);
  assert.equal(Math.abs(sumBonus) < 0.02, true, "补分必须零和,实际 " + sumBonus);
  assert.ok(vEnd.challengeReveal!.every((x) => typeof x.wins === "number"), "要给出猜对次数");
  // 结构化展览(界面用它渲染卡片)
  const ex = vEnd.exhibitionData;
  assert.ok(ex, "盘末要给出结构化展览");
  assert.equal(ex!.perSeat.length, 4, "四个座位都要有账本");
  assert.ok(ex!.perSeat.every((p) => typeof p.lies === "number" && typeof p.bluffs === "number"), "账本要有假牌数与骗过全场次数");
  assert.ok(Array.isArray(ex!.eaten) && Array.isArray(ex!.timeline), "要有牌堆去向与逐手回顾");
  assert.ok(ex!.timeline.every((c) => ["真", "假", "半真半假"].includes(c.verdict)), "逐手回顾要有真假判定");
});
