// 唬牌 Web 端到端:真起服务走一遍(今天的教训:服务端改动必须真跑一次)
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

    const created = await (await fetch(BASE + "/api/bluff/new", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bust: "tight", seats: ["human", "standard", "standard", "gambler"] }) })).json();
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
      const myTurn = st.view.turn === 0;
      if (!myTurn) { continue; }
      const body = st.view.legal.canChallenge && i % 5 === 4
        ? { seat: 0, type: "CHALLENGE" }
        : { seat: 0, type: "PLAY", cardIds: st.view.hand.slice(0, Math.min(2, st.view.hand.length)).map((c: { id: string }) => c.id) };
      const r = await (await fetch(BASE + "/api/bluff/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
      assert.equal(r.ok, true, "动作应当被接受: " + JSON.stringify(r));
    }
    const last = await (await fetch(BASE + "/api/bluff/state?seat=0")).json();
    assert.equal(last.ok, true);
    assert.equal(last.view.seats.reduce((s: number, x: { cards: number }) => s + x.cards, 0) + last.view.pileCount <= 104, true, "牌数不该超过一副");
    // 切换爆牌线也要能开新盘
    const loose = await (await fetch(BASE + "/api/bluff/new", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bust: "loose", seats: ["human", "standard", "standard", "standard"] }) })).json();
    assert.equal(loose.ok, true, "52 爆牌线也要能开局");
  } finally {
    child.kill();
  }
});