// 服务端端到端冒烟:真的把 web/server.ts 起起来,走一遍「新开一场 → 查询 → 推进 → 存档 → 读档」
//
// 为什么必须有这一条:纯库级测试跑得再绿,也抓不到「服务端处理函数里引用了不存在的变量」这类错误 ——
// 曾经真的发生过:i18n 改动把 localeOf(req, url) 塞进了没有 req 参数的辅助函数,
// 全套 139 条测试全绿,但浏览器里新开一场直接报 `req is not defined`(表现为「参数有问题,没有开局」)。
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function bootServer(port: number) {
  const proc = spawn(process.execPath, ["web/server.ts", "--port=" + port], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout?.on("data", (d) => { out += String(d); });
  proc.stderr?.on("data", (d) => { out += String(d); });
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { const r = await fetch(base + "/api/health"); if (r.ok) return { base, kill: () => proc.kill(), log: () => out }; } catch { /* 还没起来,继续等 */ }
  }
  proc.kill();
  throw new Error("服务端没起来:\n" + out);
}

test("E2E-SRV-01 真起服务走一遍主流程(防「只有真跑才暴露」的服务端错误)", async () => {
  const port = 8910 + Math.floor(Math.random() * 80);
  const s = await bootServer(port);
  const post = async (p: string, body: unknown = {}) => {
    const r = await fetch(s.base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json()) as any;
  };
  try {
    const neu = await post("/api/new", { players: 3, table: "auto", agents: ["Sam", "Baozi", "Lucas"] });
    assert.equal(neu.ok, true, "新开一场必须成功(失败 = 服务端抛异常,如 req is not defined): " + JSON.stringify(neu).slice(0, 160));
    assert.equal(neu.view?.players?.length, 3, "视图里应有 3 个座位");
    assert.ok(neu.view?.fees?.ante > 0, "视图里应有费用表(参数显示依赖它)");

    const st = (await (await fetch(s.base + "/api/state")).json()) as any;
    assert.ok(st.view?.phase, "应当能取到当前阶段");
    assert.ok(Array.isArray(st.view.legal), "应当下发合法动作列表");

    const step = await post("/api/step");
    assert.ok(typeof step.ok === "boolean", "推进接口应当返回 ok 字段");

    const save = await post("/api/replay/save");
    assert.ok(save.file, "存档应当返回文件名");
    const list = (await (await fetch(s.base + "/api/replays")).json()) as any;
    assert.ok(list.items?.some((x: any) => x.file === save.file), "存档列表里应能找到刚存的档");
    await fetch(s.base + "/api/replay?file=" + encodeURIComponent(save.file), { method: "DELETE" });

    // 英文视图:这条同时守住 i18n 的服务端管道(将来若合并 i18n,这里会先炸) ✓
    const en = (await (await fetch(s.base + "/api/state?lang=en")).json()) as any;
    assert.ok(en.view?.phase, "带 ?lang=en 也必须能工作");
  } finally {
    s.kill();
  }
});