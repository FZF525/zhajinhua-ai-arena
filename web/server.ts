// 极简热座 Web UI 服务端:零依赖 node:http,把引擎状态按"可见性"裁剪后发给浏览器。
// 运行:node web/server.ts [--port=8787]   然后浏览器打开 http://127.0.0.1:8787
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { makeBalancedConfig, makeTableConfig, mergeConfig, TABLE_PRESETS } from "../src/config.ts";
import type { GameConfig, TableSize } from "../src/config.ts";
import { createGame, aliveSeats, player, isAlive, blockadeRipe } from "../src/state.ts";
import type { Action, GameState } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { legalActions } from "../src/validate.ts";
import { callCost, compareCost, exchangeCost, interceptCost, kickCost, raiseCost, nextLadderValue } from "../src/costs.ts";
import { cardText } from "../src/cards.ts";
import { describeEvent } from "../src/format.ts";
import { makeAgent, isAgentName, AI_NAMES, AGENTS } from "../src/ai/index.ts";
import type { Policy } from "../src/env.ts";
import { createRng } from "../src/rng.ts";
import { createRecorder, record, replayTo } from "../src/replay.ts";
import type { Recording } from "../src/replay.ts";
import { saveReplay, listReplays, loadReplay, deleteReplay, replaysDir, pruneReplays } from "../src/store.ts";
import { ENGINE_VERSION } from "../src/version.ts";
import { actorOf, buildView } from "./view.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "public");
const PORT = Number((process.argv.find((a) => a.startsWith("--port=")) ?? "--port=8787").split("=")[1]);

let game: GameState;
let agents: Array<Policy | null> = [];
let recorder: Recording | null = null;      // 当前对局的录制(种子 + 动作序列)
let autoSaved = false;                      // 本场是否已自动存档
const PAUSE_BETWEEN_HANDS = process.env.ZHJ_NO_PAUSE !== "1";   // 局末停一下,等玩家点「下一局」

/** 保存当前录制(带摘要) */
function saveCurrent(fileName?: string) {
  if (!recorder) throw new Error("本场还没有录制");
  const summary = {
    hands: game ? game.handNo : 0,
    players: recorder.players,
    actions: recorder.actions.length,
    result: game?.settlement ? {
      gameOver: !!game.settlement.gameOver,
      reason: game.settlement.gameOverReason ?? game.settlement.reason,
      winnerSeat: game.settlement.winnerSeat,
      points: game.players.map((p) => p.points)
    } : undefined
  };
  const saved = saveReplay(recorder, summary, fileName);
  pruneReplays();
  return { ...saved, dir: replaysDir() };
}

/** 整场结束自动存一份(每场只存一次) */
function maybeAutoSave(): void {
  if (!game || !recorder || autoSaved || !game.gameOver) return;
  try { saveCurrent(); autoSaved = true; } catch { /* ignore */ }
}
let seedCounter = 20240000;

function agentNames(): Array<string | null> {
  return agents.map((a) => (a ? "AI" : null));
}

export interface NumberOverrides {
  ante?: number;
  startPoints?: number;
  winAtOrAbove?: number;
  bustAtOrBelow?: number;
  maxHands?: number | null;
}

/** 分场预设 + 自定义数值覆盖:自定义值**原样生效**,不参与等比缩放 */
export function buildConfig(players: number, table: string, ov: NumberOverrides = {}): GameConfig {
  const n = Math.max(2, Math.min(6, players));
  const base = table === "small" || table === "big" ? makeTableConfig(table as TableSize) : makeBalancedConfig(n);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const patch: Record<string, unknown> = {};
  const ante = num(ov.ante), sp = num(ov.startPoints);
  if (ante !== undefined && ante > 0) patch.ante = { amount: Math.round(ante) };
  if (sp !== undefined && sp > 0) patch.players = { startPoints: Math.round(sp) };
  const eg: Record<string, unknown> = {};
  const win = num(ov.winAtOrAbove), bust = num(ov.bustAtOrBelow);
  if (win !== undefined) eg.winAtOrAbove = Math.round(win);
  if (bust !== undefined) eg.bustAtOrBelow = Math.round(bust);
  if (ov.maxHands !== undefined) eg.maxHands = ov.maxHands === null ? null : Math.max(1, Math.round(Number(ov.maxHands)));
  if (Object.keys(eg).length) patch.endGame = eg;
  return Object.keys(patch).length ? mergeConfig(base, patch) : base;
}

function newGame(players: number, table: string, seed?: number, agentSpec?: Array<string | null>, ov: NumberOverrides = {}): GameState {
  const n = Math.max(2, Math.min(6, players));
  const names = agentSpec
    ? Array.from({ length: n }, (_, i) => {
        const a = agentSpec[i];
        return a && isAgentName(a) ? a + "(AI)" : "玩家" + (i + 1);
      })
    : Array.from({ length: n }, (_, i) => "玩家" + (i + 1));
  const s = seed ?? ++seedCounter;
  const cfg = buildConfig(n, table, ov);
  const st = createGame(cfg, names, s);
  agents = names.map((_, i) => {
    const a = agentSpec?.[i];
    return a && isAgentName(a) ? makeAgent(a) : null;
  });
  recorder = createRecorder(s, names, {});
  autoSaved = false;
  advance(st);
  return st;
}

/** 视图 + 座位归属(AI / 人类),供前端决定"要不要继续推进" */
function viewWithAgents(reveal = true, god = false) {
  const actor = actorOf(game);
  const humans = agents.map((a, i) => (a ? -1 : i)).filter((i) => i >= 0);
  // 单人局:视角锁死在自己那一座(否则轮到哪个 AI 就会看到它的牌);多人同屏才跟随行动者
  const viewer = humans.length === 1 ? humans[0] : actor;
  const v = buildView(game, reveal, { god, viewer }) as ReturnType<typeof buildView> & { actorIsAI: boolean; seatIsAI: boolean[]; humanSeats: number[] };
  v.seatIsAI = agents.map((a) => !!a);
  v.actorIsAI = actor !== null && !!agents[actor];
  v.humanSeats = agents.map((a, i) => (a ? -1 : i)).filter((i) => i >= 0);
  return v;
}

/** 只推进【一步】AI 动作:由前端按自己的节奏反复调用(这样玩家能看清每一步) */
function stepOnce(): { ok: boolean; reason?: string; acted?: number; events?: string[] } {
  if (!game || game.gameOver) return { ok: false, reason: "gameOver" };
  if (game.phase === "HAND_START") return { ok: false, reason: "awaitingNext" };
  const actor = actorOf(game);
  if (actor === null) return { ok: false, reason: "noActor" };
  const ag = agents[actor];
  if (!ag) return { ok: false, reason: "human" };
  const a = ag(game, createRng((Date.now() ^ (actor * 2654435761)) >>> 0));
  if (!a) return { ok: false, reason: "noAction" };
  const before = game.events.length;
  const r = apply(game, a, { dealNextHand: !PAUSE_BETWEEN_HANDS });
  if (!r.ok) return { ok: false, reason: r.error?.code ?? "rejected" };
  record(recorder!, a);
  maybeAutoSave();
  return { ok: true, acted: actor, events: game.events.slice(before).map(describeEvent) };
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function send(res: http.ServerResponse, code: number, body: string, type = "application/json; charset=utf-8"): void {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  try {
    if (path === "/api/new" && req.method === "POST") {
      const body = await readBody(req);
      game = newGame(Number(body.players ?? 3), String(body.table ?? "auto"),
        body.seed === undefined ? undefined : Number(body.seed),
        Array.isArray(body.agents) ? body.agents : undefined,
        (body.numbers && typeof body.numbers === "object" ? body.numbers : {}) as NumberOverrides);
      return send(res, 200, JSON.stringify({ ok: true, view: viewWithAgents(), agents: agentNames() }));
    }
    if (path === "/api/state" && req.method === "GET") {
      if (!game) game = newGame(3, "auto");
      const reveal = url.searchParams.get("reveal") !== "0";
      const god = url.searchParams.get("god") === "1";
      if (god) return send(res, 200, JSON.stringify({ ok: true, view: viewWithAgents(true, true) }));
      return send(res, 200, JSON.stringify({ ok: true, view: viewWithAgents(reveal) }));
    }
    if (path === "/api/action" && req.method === "POST") {
      if (!game) return send(res, 400, JSON.stringify({ ok: false, error: "尚未开局" }));
      const body = await readBody(req);
      const actor = actorOf(game);
      if (actor === null) return send(res, 400, JSON.stringify({ ok: false, error: "当前无人需要行动" }));
      // 座位由服务端决定,避免客户端越权
      const action = { ...body, seat: actor, type: String(body.type) } as Action;
      const before = game.events.length;
      const r = apply(game, action, { dealNextHand: !PAUSE_BETWEEN_HANDS });
      if (!r.ok) return send(res, 200, JSON.stringify({ ok: false, error: r.error, view: viewWithAgents() }));
      record(recorder!, action);                             // 人类动作也要进录制
      maybeAutoSave();
      const events = game.events.slice(before).map(describeEvent);
      return send(res, 200, JSON.stringify({ ok: true, events, view: viewWithAgents() }));
    }
    if (path === "/api/health") return send(res, 200, JSON.stringify({ ok: true, players: game ? game.players.length : 0 }));
    if (path === "/api/next-hand" && req.method === "POST") {
      if (!game) return send(res, 400, JSON.stringify({ ok: false, error: "尚未开局" }));
      if (game.gameOver) return send(res, 200, JSON.stringify({ ok: false, reason: "gameOver", view: viewWithAgents() }));
      if (game.phase !== "HAND_START") return send(res, 200, JSON.stringify({ ok: false, reason: "alreadyDealt", view: viewWithAgents() }));
      advance(game);
      maybeAutoSave();
      return send(res, 200, JSON.stringify({ ok: true, view: viewWithAgents() }));
    }
    if (path === "/api/step" && req.method === "POST") {
      if (!game) return send(res, 400, JSON.stringify({ ok: false, error: "尚未开局" }));
      const body = await readBody(req);
      const out = stepOnce();
      const view = viewWithAgents(true, !!body.god);
      return send(res, 200, JSON.stringify({ ...out, view }));
    }
    if (path === "/api/replays" && req.method === "GET") {
      return send(res, 200, JSON.stringify({ ok: true, dir: replaysDir(), items: listReplays() }));
    }
    if (path === "/api/replay/save" && req.method === "POST") {
      if (!recorder) return send(res, 400, JSON.stringify({ ok: false, error: "本场还没有录制" }));
      const body = await readBody(req);
      const saved = saveCurrent(typeof body.file === "string" ? body.file : undefined);
      autoSaved = true;
      return send(res, 200, JSON.stringify({ ok: true, ...saved }));
    }
    if (path === "/api/replay/load" && req.method === "GET") {
      const file = url.searchParams.get("file") ?? "";
      const rec = loadReplay(file);
      return send(res, 200, JSON.stringify({ ok: true, file, seed: rec.seed, players: rec.players, savedAt: rec.savedAt,
        summary: rec.summary, steps: rec.actions.length, labels: rec.labels ?? rec.actions.map((a) => a.type) }));
    }
    if (path === "/api/replay/frame" && req.method === "GET") {
      const file = url.searchParams.get("file") ?? "";
      const step = Math.max(0, Math.min(Number(url.searchParams.get("step") ?? 0), 1e6));
      const rec = loadReplay(file);
      const state = replayTo(rec, step);                      // 现算,约 0.5ms(见 examples/memory-probe.ts)
      return send(res, 200, JSON.stringify({ ok: true, step, steps: rec.actions.length, god: true, view: buildView(state, true, { god: true }) }));
    }
    if (path === "/api/replay" && req.method === "DELETE") {
      const file = url.searchParams.get("file") ?? "";
      return send(res, 200, JSON.stringify({ ok: deleteReplay(file) }));
    }
    if (path === "/api/agents" && req.method === "GET") return send(res, 200, JSON.stringify({ ok: true, agents: AGENTS, names: AI_NAMES }));

    // 静态资源
    const rel = path === "/" ? "index.html" : normalize(path).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC) || !existsSync(file)) return send(res, 404, "not found", "text/plain; charset=utf-8");
    const ext = file.slice(file.lastIndexOf("."));
    return send(res, 200, readFileSync(file, "utf8"), MIME[ext] ?? "application/octet-stream");
  } catch (err) {
    return send(res, 500, JSON.stringify({ ok: false, error: (err as Error).message }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("炸金花 Web UI " + ENGINE_VERSION + ": http://127.0.0.1:" + PORT);
  console.log("(改过引擎/view 后必须重启本进程,浏览器刷新不会更新服务端代码)");
  console.log("对局存档目录:" + replaysDir());
  console.log("分场: 默认按人数自适应;可在页面上切换 小分场(" + TABLE_PRESETS.small.scale + "×) / 大分场(" + TABLE_PRESETS.big.scale + "×)");
  void isAlive; void player;
});
