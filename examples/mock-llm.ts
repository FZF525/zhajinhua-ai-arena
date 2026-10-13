// 本地 mock LLM:实现 OpenAI 兼容的 /v1/chat/completions,用来免费跑通"LLM 上场"整条链路
// 运行:node examples/mock-llm.ts [--port=11434] [--delay=30] [--fail=illegal|timeout|none]
// 它从 prompt 里抠出可选动作列表,按一点点"直觉"选一个:能比牌且手里有对子就比,否则跟注。
import { createServer } from "node:http";

const args = process.argv.slice(2);
const arg = (n: string, d: string) => { const h = args.find((a) => a.startsWith("--" + n + "=")); return h ? h.split("=")[1] : d; };
const PORT = Number(arg("port", "11434"));
const DELAY = Number(arg("delay", "30"));
const FAIL = arg("fail", "none");

function pickAction(prompt: string): string {
  const acts = [...prompt.matchAll(/\s\d+\)\s*(\{[^\n]*\})/g)].map((m) => m[1]);
  if (acts.length === 0) return '{"action":"FOLD"}';
  const myLine = (prompt.match(/我的牌:([^\n]*)/) ?? [])[1] ?? "";
  const ranks = [...myLine.matchAll(/[\u2660-\u2667\u2744\u2b50\u2764\u2665\u2666\u2663\u2728\u2600][^\s)]+/g)].map((m) => m[0].slice(1));
  const hasPair = new Set(ranks).size < ranks.length;
  const has = (t: string) => acts.find((a) => a.includes('"type":"' + t + '"'));
  if (hasPair && has("COMPARE")) return has("COMPARE")!;
  if (has("CALL")) return has("CALL")!;
  return acts[0];
}

createServer((req, res) => {
  if (!req.url || !req.url.includes("/chat/completions")) { res.writeHead(404).end("not found"); return; }
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    let prompt = "";
    try {
      const j = JSON.parse(body) as { messages?: Array<{ role: string; content: string }> };
      prompt = (j.messages ?? []).filter((m) => m.role === "user").map((m) => m.content).join("\n");
    } catch { /* ignore */ }
    const reply = () => {
      if (FAIL === "timeout") return;                     // 故意不回,测试超时
      const content = FAIL === "illegal" ? '{"action":"RAISE","toMultiplier":999}' : pickAction(prompt);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "mock", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
    };
    if (DELAY > 0) setTimeout(reply, DELAY); else reply();
  });
}).listen(PORT, () => console.log("mock LLM 就绪: http://127.0.0.1:" + PORT + "/v1/chat/completions  (delay=" + DELAY + "ms, fail=" + FAIL + ")"));
