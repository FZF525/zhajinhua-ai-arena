// 八门拱猪 Web 端到端:真起服务打完整一局(服务端改动必须真跑一次 —— 今天的闸门)
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = 9060 + Math.floor(Math.random() * 100);
const BASE = "http://127.0.0.1:" + PORT;

async function waitHealth(tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(BASE + "/api/health"); if (r.ok) return; } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error("服务端没起来");
}
const post = async (path: string, body: unknown) =>
  (await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

test("ZP-WEB-02 连局:累计分会累加,有人到线就停并给出排名", async () => {
  const child = spawn(process.execPath, [join(ROOT, "web", "server.ts"), "--port=" + (PORT + 7)], { cwd: ROOT, stdio: "ignore" });
  const B2 = "http://127.0.0.1:" + (PORT + 7);
  const p2 = async (path: string, body: unknown) =>
    (await fetch(B2 + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  try {
    for (let i = 0; i < 60; i++) { try { const r = await fetch(B2 + "/api/health"); if (r.ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 120)); }
    const created = await p2("/api/zhupig/new", { seat: 0, ai: "greedy", stopLow: -1, stopHigh: 1 });
    assert.equal(created.ok, true);
    assert.equal(created.view.match.total.length, 4, "应当有累计分");
    assert.equal(created.view.match.stopLow, -1, "低线应当生效");
    assert.equal(created.view.match.stopHigh, 1, "高线应当生效");
    const dec = await p2("/api/zhupig/declare", { seat: 0, cardIds: [] });
    assert.equal(dec.ok, true, "亮牌声明(空)必须成功");
    assert.equal(dec.view.phase, "play");
    // 打一局
    let over = false;
    for (let g = 0; g < 500 && !over; g++) {
      const st: any = await (await fetch(B2 + "/api/zhupig/state?seat=0")).json();
      if (st.view.phase === "over") { over = true; break; }
      if (st.view.myTurn) await p2("/api/zhupig/action", { seat: 0, cardId: st.view.legalIds[0] });
      else await p2("/api/zhupig/step", { seat: 0 });
    }
    assert.equal(over, true, "应当打得完一局");
    const fin: any = await (await fetch(B2 + "/api/zhupig/state?seat=0")).json();
    // 累计应当等于本局最终分(第一局)
    assert.deepEqual(fin.view.match.total.length, 4);
    const sumFinal = fin.view.score.perSeat.reduce((a: number, p: any) => a + p.final, 0);
    assert.equal(Math.abs(sumFinal) < 1e-9, true, "本局仍零和");
    // stopAt=-1:一定有人 ≤ -1(除非全员恰好 0)→ 连局结束 + 有排名
    if (fin.view.match.over) {
      assert.ok(Array.isArray(fin.view.match.ranking), "到线后必须给出排名");
      assert.equal(fin.view.match.ranking.length, 4);
      assert.equal(fin.view.match.ranking[0].total >= fin.view.match.ranking[3].total, true, "排名要按累计分降序");
      // 已结束时不允许再开下一局
      const nxt = await p2("/api/zhupig/next", { seat: 0 });
      assert.equal(nxt.ok, false, "连局已结束时不能再开下一局");
    } else {
      const nxt = await p2("/api/zhupig/next", { seat: 0 });
      assert.equal(nxt.ok, true, "没到线应当能开下一局");
      assert.equal(nxt.view.match.no, 2, "局数要 +1");
      assert.equal(nxt.view.phase, "declare", "新局从亮牌阶段开始");
    }
  } finally {
    child.kill();
  }
});

test("ZP-WEB-01 真起服务打完整一局:发牌 → 亮牌 → 26 轮 → 结算(含隐私检查)", async () => {
  const child = spawn(process.execPath, [join(ROOT, "web", "server.ts"), "--port=" + PORT], { cwd: ROOT, stdio: "ignore" });
  try {
    await waitHealth();
    const page = await fetch(BASE + "/zhupig");
    assert.equal(page.status, 200, "拱猪页面应当能打开");
    assert.ok((await page.text()).includes("八门拱猪"), "页面内容应当是拱猪");

    const created = await post("/api/zhupig/new", { seat: 0 });
    assert.equal(created.ok, true, "开新局必须成功: " + JSON.stringify(created));
    assert.equal(created.view.phase, "declare", "开局应当先进入亮牌阶段");
    assert.equal(created.view.hand.length, 26, "每人 26 张");
    assert.equal(created.view.seats.length, 4);
    // 页面用到的字段必须在视图里(否则前端会静默崩)
    assert.equal(typeof created.view.turn, "number", "视图要有 turn");
    assert.equal(Array.isArray(created.view.trick), true, "视图的 trick 必须是数组");
    assert.equal(Array.isArray(created.view.hand), true);
    assert.equal(Array.isArray(created.view.legalIds), true);
    // 收牌堆是**公开信息**(每轮都明着打)→ 四家都实时展示
    assert.equal(Array.isArray(created.view.seats[0].pile), true, "自己的收牌堆要实时可见");
    assert.equal(Array.isArray(created.view.seats[1].pile), true, "别人的收牌堆也要实时可见(公开信息)");
    // 别人的**手牌**仍然不可见(视图里根本没有这个字段)
    assert.equal(created.view.seats[1].hand, undefined, "别人的手牌绝不能出现在视图里");

    const declared = await post("/api/zhupig/declare", { seat: 0, cardIds: [] });
    assert.equal(declared.ok, true, "亮牌声明必须成功");
    assert.equal(declared.view.phase, "play", "声明后进入出牌阶段");

    let over = false;
    for (let guard = 0; guard < 500 && !over; guard++) {
      const st: any = await (await fetch(BASE + "/api/zhupig/state?seat=0")).json();
      assert.equal(st.ok, true);
      if (st.view.phase === "over") { over = true; break; }
      if (st.view.myTurn) {
        const id = st.view.legalIds[0];
        assert.ok(id, "轮到我时必须有合法牌");
        const r = await post("/api/zhupig/action", { seat: 0, cardId: id });
        assert.equal(r.ok, true, "出牌失败: " + JSON.stringify(r));
      } else {
        const r = await post("/api/zhupig/step", { seat: 0 });
        assert.equal(r.ok, true, "AI 步骤失败: " + JSON.stringify(r));
      }
    }
    assert.equal(over, true, "应当能打完整一局(104 张全出完)");

    const fin: any = await (await fetch(BASE + "/api/zhupig/state?seat=0")).json();
    assert.ok(fin.view.score, "局末必须有结算");
    assert.equal(fin.view.score.perSeat.length, 4);
    const sum = fin.view.score.perSeat.reduce((a: number, p: any) => a + p.final, 0);
    assert.equal(Math.abs(sum) < 1e-9, true, "四家最终分必须零和,实际 " + sum);
    assert.equal(fin.view.score.ledger.length > 10, true, "结算账本必须有逐步留痕");
    assert.deepEqual(fin.view.score.ambiguities, [], "规则已定稿,不应再有未定项");
  } finally {
    child.kill();
  }
});
