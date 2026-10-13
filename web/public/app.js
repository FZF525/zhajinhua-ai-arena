// 热座前端(原生 JS,无构建)
// 关键约定:牌一律用服务端下发的 {id, text};动作的 seat 由服务端判定。
let view = null, lastActor = null, pending = null, sel = { take: null };
let aiDelay = 700, aiTimer = null, aiRunning = false, aiLog = [];
const $ = (id) => document.getElementById(id);

function stopAI() {
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  aiRunning = false;
}
/** 按玩家设定的节奏，一次只推进【一步】AI 动作 —— 这样每一步都看得见 */
async function pumpAI() {
  if (aiRunning || !view) return;
  aiRunning = true;
  try {
    while (view && view.actorIsAI && !view.gameOver) {
      if (aiDelay > 0) await new Promise((res) => { aiTimer = setTimeout(res, aiDelay); });
      aiTimer = null;
      if (!aiRunning) return;
      const r = await api("/api/step", { god: godView });
      if (!r.ok) break;
      view = r.view;
      if (r.events && r.events.length) aiLog = r.events.slice(-3);
      render();
    }
  } finally {
    aiTimer = null;
    aiRunning = false;
  }
}

/** 下拉框选项兜底重建:HTML 被缓存/写坏时也能用 */
function ensureOptions(id, choices) {
  const sel = $(id);
  if (!sel) return;
  const have = [...sel.options].map((o) => o.value);
  if (choices.every((c) => have.includes(c.value))) return;
  sel.innerHTML = "";
  for (const c of choices) {
    const o = document.createElement("option");
    o.value = c.value; o.textContent = c.label;
    sel.appendChild(o);
  }
}
/** 只在值合法时赋值,否则回到默认(避免出现"空白下拉框") */
function setSelectValue(id, v, fallback) {   // 仅用于分场下拉
  const sel = $(id);
  if (!sel) return fallback;
  const ok = v !== undefined && v !== null && [...sel.options].some((o) => o.value === String(v));
  sel.value = ok ? String(v) : fallback;
  return sel.value;
}
const PLAYER_CHOICES = [2, 3, 4, 5, 6];
let players = 3;                                   // 当前人数(不再依赖原生 select 渲染)
function playerCount() { return players; }
function setPlayerCount(v, silent) {
  const n = Number(v);
  players = Number.isFinite(n) && n >= 2 && n <= 6 ? Math.round(n) : 3;
  renderPlayerButtons();
  if (!silent) { renderSeats(); markDirty(); }
}
/** 人数用按钮组:原生 select 在某些浏览器里会出现"有选项但显示空白" */
function renderPlayerButtons() {
  const box = $("players");
  if (!box) return;
  box.innerHTML = "";
  for (const n of PLAYER_CHOICES) {
    const b = document.createElement("button");
    b.textContent = String(n);
    b.title = n + " 人";
    if (n === players) b.classList.add("on");
    b.onclick = () => setPlayerCount(n);
    box.appendChild(b);
  }
}
const TABLE_CHOICES = [
  { value: "auto", label: "自适应分场" }, { value: "small", label: "小分场 ×10" }, { value: "big", label: "大分场 ×25" }
];

let AI_LABELS = { human: "人类", Baozi: "Baozi·保守", Sam: "Sam·标准", Lucas: "Lucas·激进", May: "May·稳健", Yeon: "Yeon·均衡", Brian: "Brian·激进", EQB: "EQB·精确胜率", EQBfast: "EQBfast·快", ZeroB: "ZeroB·学习型" };
let AI_KEYS = Object.keys(AI_LABELS);
/** 从服务端拉角色列表(新增 AI 无需改前端) */
async function loadAgentList() {
  try {
    const r = await api("/api/agents", undefined, "GET");
    if (!r.ok || !Array.isArray(r.agents)) return;
    const next = { human: "人类" };
    for (const g of r.agents) next[g.name] = g.name + "·" + g.label;
    AI_LABELS = next; AI_KEYS = Object.keys(next);
  } catch { /* 保持内置表 */ }
}

function renderSeats(restore) {
  const n = playerCount();
  const box = $("seats");
  const prev = Array.isArray(restore) ? restore : [...box.querySelectorAll("select")].map((s) => s.value);
  box.innerHTML = "<span>座位安排:</span>";
  for (let i = 0; i < n; i++) {
    const label = document.createElement("label");
    const seat = i === 0 ? AI_KEYS[0] : "Sam";       // 默认:你坐 0 号,其余用标准 AI
    label.textContent = "座位" + i + " ";
    const sel = document.createElement("select");
    sel.dataset.seat = String(i);
    for (const k of AI_KEYS) {
      const o = document.createElement("option");
      o.value = k; o.textContent = AI_LABELS[k];
      sel.appendChild(o);
    }
    const want = prev[i] === null ? "human" : prev[i];
    sel.value = want && AI_KEYS.includes(want) ? want : seat;
    label.appendChild(sel);
    box.appendChild(label);
  }
}
function selectedAgents() {
  return [...$("seats").querySelectorAll("select")].map((s) => (s.value === "human" ? null : s.value));
}

const EXPECT_SERVER = "1.8.2";   // 与服务端 src/version.ts 对齐

const suitClass = (t) => {
  if (!t) return "";
  if (t[0] === "\u2665" || t[0] === "\u2666") return "red";
  if (t[0] === "\u2660" || t[0] === "\u2663") return "black";
  if (t[0] === "\u2744" || t[0] === "\u{1F4A7}") return "blue";
  return "gold";
};
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function cardEl(card, opts = {}) {
  const d = document.createElement("div");
  d.className = "card" + (opts.small ? " small" : "");
  if (!card || !card.text) { d.classList.add("back"); d.textContent = "?"; return d; }
  d.classList.add(suitClass(card.text));
  d.textContent = card.text;
  if (opts.clickable) { d.classList.add("clickable"); d.onclick = opts.onClick; }
  if (opts.selected) d.classList.add("sel");
  if (opts.disabled) d.classList.add("disabled");
  if (opts.note) { const s = document.createElement("div"); s.className = "sub"; s.textContent = opts.note; d.appendChild(s); }
  return d;
}

async function api(path, body, method) {
  let init;
  if (method) init = { method };
  else if (body !== undefined) init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(path, init);
  return r.json();
}

const LABELS = { VIEW_HAND: "看牌", CALL: "跟注", RAISE: "加注", FOLD: "弃牌", COMPARE: "比牌", EXCHANGE: "换牌", KICK: "踢牌", TAKE_BLOCKED: "换走暗牌", PASS_BLOCKED: "不换(公开)", INTERCEPT: "截胡", DECLINE_INTERCEPT: "放弃截胡" };
const CANCEL = { EXCHANGE: 1, KICK: 1, TAKE_BLOCKED: 1, INTERCEPT: 1, COMPARE: 1 };

function hintText(v) {
  if (v.gameOver) return "整场结束 —— 可点右上「新开一场」。";
  switch (pending) {
    case "take": return "① 点公共池里要【换入】的明牌";
    case "give": return "② 点自己手牌里要【放回】的那张 → 立即换牌";
    case "kick": return "点公共池里要【踢掉】的明牌(仅未被选取的可用)";
    case "intercept": return "点自己手牌里要【放回】的那张 → 立即截胡";
    case "takeblocked": return "点自己手牌里要【放回】的那张 → 立即换走暗牌";
    case "target": return "选择比牌对象";
  }
  if (v.intercept) return "截胡窗口:目标 " + (v.intercept.cardId ?? "?") + ",n=" + v.intercept.n + ",候选座位 " + v.intercept.candidateSeat;

  if (v.actor === null) return "等待中…";
  return "轮到 " + v.actorName + " · " + (v.actorBlind ? "闷牌中(跟注减半,但不能换牌/截胡)" : "已看牌") +
    " · 已换牌 " + v.actorExchangeCount + " 次";
}

function render() {
  const v = view;
  if (!v) return;
  renderNotice(v);
  // 回放模式:藏起操作区,亮出时间轴
  const bar = $("replaybar");
  if (bar) bar.classList.toggle("hidden", !replayMode);
  // 操作区只在"轮到自己"时出现 —— 否则界面上会显示 AI 的可选动作,容易被误点
  const canAct = !replayMode && v.actor !== null && !v.actorIsAI && v.isMyTurn !== false;
  const opsPanel = $("ops");
  if (opsPanel) opsPanel.classList.toggle("hidden", !canAct);
  $("meta").innerHTML =
    "第 <b>" + v.handNo + "</b>/" + (v.maxHands ?? "\u221e") + " 局 &nbsp; <b>" + v.phase + "</b>" +
    " &nbsp; M=<b>" + v.multiplier + "</b> &nbsp; 底池 <b>" + v.pot + "</b> &nbsp; 下注轮 <b>" + v.round + "</b>" +
    (v.capReached ? "(封顶 " + v.postCapRounds + "/" + v.roundCap + ")" : "") +
    " &nbsp; 刻度 底注 <b>" + v.fees.ante + "</b> / 跟注 <b>" + v.fees.seen + "</b>·<b>" + v.fees.blind + "</b>" +
    " &nbsp; 阈值 <b>" + v.winAtOrAbove + "</b>";

  // 公共池
  const pool = $("pool");
  pool.innerHTML = "";
  v.pool.forEach((c) => {
    const pickTake = pending === "take";
    const pickKick = pending === "kick";
    const kickable = kickableCard(v, c);
    const clickable = (pickTake && !!c.id && c.blockadedBy === null) || (pickKick && !!c.id && kickable);
    const note = c.blockadedBy !== null ? (c.ripe ? "暗牌·可换走" : "暗牌·保护中")
      : pickKick ? (kickable ? "可踢" : "已被选取") : (c.everSelected ? "经手过" : "未选取");
    pool.appendChild(cardEl(c.id ? { text: c.text } : null, {
      clickable,
      note,
      selected: sel.take === c.id,
      disabled: (pickKick && !kickable) || (pickTake && (!c.id || c.blockadedBy !== null)),
      onClick: () => {
        if (pickKick) return act({ type: "KICK", targetCardId: c.id });
        sel.take = c.id; pending = "give"; render();
      }
    }));
  });
  $("pool-note").textContent = pending === "kick" ? "(点明牌踢掉)" : pending === "take" ? "(点明牌选入)" : "";

  // 座位
  const ps = $("playerlist");        // 座位面板(注意:别和页头人数控件的 id 撞车)
  ps.innerHTML = "";
  v.players.forEach((p) => {
    const d = document.createElement("div");
    d.className = "pl" + (p.isActor ? " actor" : "") + (!p.inHand ? " out" : p.folded ? " folded" : "");
    const badge = !p.inHand ? '<span class="badge fold">出局</span>'
      : p.folded ? '<span class="badge fold">已弃牌</span>'
      : p.blind ? '<span class="badge blind">闷牌</span>'
      : '<span class="badge seen">看牌</span>';
    d.innerHTML = '<span class="name">' + esc(p.name) + '</span><span class="badge">座位' + p.seat + '</span>' +
      '<span class="pts">' + p.points + ' 分</span>' + badge + '<span class="badge">已投 ' + p.committed + '</span>';
    const cards = document.createElement("div");
    cards.className = "cards";
    if (p.hand) p.hand.forEach((c) => cards.appendChild(cardEl({ text: c.text }, { small: true })));
    else if (p.inHand && !p.folded) for (let i = 0; i < p.handCount; i++) cards.appendChild(cardEl(null, { small: true }));
    d.appendChild(cards);
    ps.appendChild(d);
  });

  // 我的手牌
  const hand = $("hand");
  hand.innerHTML = "";
  const needGive = pending === "give" || pending === "intercept" || pending === "takeblocked";
  if (v.actorHand && v.actorHand.length) {
    v.actorHand.forEach((c) => hand.appendChild(cardEl(c, {
      clickable: needGive,
      onClick: () => {
        if (pending === "give") return act({ type: "EXCHANGE", takeCardId: sel.take, giveCardId: c.id });
        if (pending === "intercept") return act({ type: "INTERCEPT", giveCardId: c.id });
        if (pending === "takeblocked") return act({ type: "TAKE_BLOCKED", giveCardId: c.id });
      }
    })));
    $("hand-note").textContent = needGive ? "点一张放回公共池" : "5 张暗牌";
  } else {
    const d = document.createElement("div");
    d.className = "hint";
    d.textContent = v.actorHandHidden ? "闷牌中 —— 点「看牌」才显示手牌(看牌后跟注加倍,且不能再闷)" : "无需你行动 / 本局已结束";
    hand.appendChild(d);
    $("hand-note").textContent = "";
  }

  // 操作按钮
  const ops = $("ops");
  ops.innerHTML = "";
  (v.legal || []).forEach((l) => {
    const b = document.createElement("button");
    b.textContent = LABELS[l.name] ?? l.name;
    if (l.cost) { b.dataset.cost = l.cost + " 分"; b.classList.add("cost"); }
    if (l.name === "INTERCEPT") { b.classList.add("primary"); b.textContent = "\u26a1 截胡"; }
    const afford = v.actor === null ? true : v.players[v.actor].points >= (l.cost ?? 0) || l.name === "VIEW_HAND";
    b.disabled = !afford;
    b.onclick = () => {
      sel = { take: null };
      switch (l.name) {
        case "EXCHANGE": pending = "take"; render(); break;
        case "KICK": pending = "kick"; render(); break;
        case "INTERCEPT": pending = "intercept"; render(); break;
        case "TAKE_BLOCKED": pending = "takeblocked"; render(); break;
        case "COMPARE": pending = "target"; render(); break;
        case "RAISE": act({ type: "RAISE", toMultiplier: v.ladderNext }); break;
        default: act({ type: l.name }); break;
      }
    };
    ops.appendChild(b);
  });

  if (pending === "target") {
    v.players.filter((p) => p.inHand && !p.folded && p.seat !== v.actor).forEach((p) => {
      const b = document.createElement("button");
      b.textContent = "比 " + p.name;
      b.onclick = () => act({ type: "COMPARE", targetSeat: p.seat });
      ops.appendChild(b);
    });
  }
  if (pending && CANCEL[pending]) {
    const b = document.createElement("button");
    b.textContent = "取消";
    b.onclick = () => { pending = null; sel = { take: null }; render(); };
    ops.appendChild(b);
  }
  $("hint").textContent = hintText(v);

  // 日志(服务端只给最近 16 条,倒序显示)
  const log = $("log");
  log.innerHTML = "";
  v.log.slice().reverse().forEach((t) => { const li = document.createElement("li"); li.textContent = t; log.appendChild(li); });
  for (const t of aiLog.slice().reverse()) { const li = document.createElement("li"); li.textContent = "AI · " + t; li.style.color = "#caa24a"; log.prepend(li); }

  // 本局结算:一眼看清谁赢了多少、用什么牌赢的
  const s = v.settlement;
  $("result-panel").hidden = !s;
  if (s) {
    const REASON = { LAST_STANDING: "其他人都弃牌", SHOWDOWN: "摊牌比大小", TIE_COMPONENT: "平局分量结束" };
    const OVER = { WIN_THRESHOLD: "有人达到胜利阈值", BUST: "全员破产", BOTH: "阈值与破产同时", MAX_HANDS: "打满局数上限" };
    const names = s.winners.map((w) => v.players[w] ? v.players[w].name : ("座位" + w)).join("、");
    const rows = v.players.slice()
      .sort((x, y) => y.handDelta - x.handDelta)
      .map((p) => {
        const d = p.handDelta;
        const cls = d > 0 ? "win" : d < 0 ? "lose" : "";
        const cards = p.hand ? "<span class='cards'>" + p.hand.map((c) => c.text).join(" ") + (p.handDesc ? " · " + esc(p.handDesc) : "") + "</span>" : "";
        return "<div class='row'><span class='nm'>" + esc(p.name) + "</span><span>" + p.points + " 分</span>" +
          "<span class='dl " + cls + "'>" + (d > 0 ? "+" + d : String(d)) + "</span>" + cards + "</div>";
      }).join("");
    $("result-note").textContent = "第 " + v.handNo + " 局";
    $("result").innerHTML =
      (s.gameOver ? "<div class='result-win'>整场结束:" + esc(OVER[s.gameOverReason ?? ""] ?? s.gameOverReason ?? "") +
        (s.winnerSeat !== undefined && v.players[s.winnerSeat] ? " · 赢家 <b>" + esc(v.players[s.winnerSeat].name) + "</b>" : " · 并列第一") + "</div>" : "") +
      "本局:" + esc(REASON[s.reason] ?? s.reason) + " · 底池 <b>" + s.pot + "</b> → <span class='result-win'>" + esc(names) + "</span>"
      + (s.winners.length > 1 ? " 各得 " + s.perWinner + (s.remainder ? "(余 " + s.remainder + " 给先手)" : "") : "")
      + (s.showdown ? "" : " · 未摊牌") +
      "<div style='margin-top:8px'>" + rows + "</div>";
  }
  $("next-hand").style.display = (s && !s.gameOver && v.awaitingNext) ? "inline-block" : "none";

  // 热座遮屏:默认关闭 —— 单人对 AI 每次都弹很烦;勾上开关才自动盖
  const hotseat = !!($("hotseat") && $("hotseat").checked);
  if (replayMode || v.gameOver || v.actor === null || v.actorIsAI || !hotseat) hideCurtain();
  else if (v.actor !== lastActor) showCurtain(v.actor);
  lastActor = v.actor;
}

function renderNotice(v) {
  const box = $("notice");
  // 服务端没版本号 = 旧进程(改过引擎/视图后必须重启进程,刷新浏览器没用)
  if (!v.serverVersion || v.serverVersion !== EXPECT_SERVER) {
    box.className = "notice hot";
    box.innerHTML = "\u26a0 " + (v.serverVersion
      ? "服务端版本是 <b>" + esc(v.serverVersion) + "</b>,页面需要 <b>" + EXPECT_SERVER + "</b>"
      : "服务端没有版本标记(几乎肯定是旧进程)") +
      " —— 请到终端把 <b>node web/server.ts</b> 停掉重启。注意:<b>刷新浏览器只更新前端</b>,引擎/视图改动必须重启服务端。";
    return;
  }
  const lastInterceptLine = v.log.slice().reverse().find((t) => t.indexOf("截胡") >= 0);
  if (v.intercept) {
    if (v.intercept.forMe) {
      const note = v.intercept.canNow ? "费用 <b>" + v.intercept.cost + " 分</b> —— 现在就可以截(或直接做别的事,回合结束即作废)"
        : (v.intercept.reason === "ERR_BLIND_CANNOT_INTERCEPT" ? "你还在闷牌 —— <b>先点「看牌」</b>,再看要不要截" : "当前不可截:" + esc(v.intercept.reason ?? ""));
      box.className = "notice hot";
      box.innerHTML = "\u26a1 轮到你了:<b>" + esc(v.players[v.intercept.fromSeat].name) + "</b> 刚换入的 <b>" + esc(v.intercept.cardId) +
        "</b>(第 " + v.intercept.n + " 次被截)可以被你截胡," + note;
    } else {
      box.className = "notice";
      box.innerHTML = "待截胡:<b>" + esc(v.players[v.intercept.fromSeat].name) + "</b> 换入的 <b>" + esc(v.intercept.cardId) +
        "</b> 归紧邻下家 <b>" + esc(v.players[v.intercept.candidateSeat].name) + "</b> 在自己的回合内决定";
    }
    return;
  }
  if (lastInterceptLine) { box.className = "notice"; box.textContent = lastInterceptLine; return; }
  box.className = "notice hidden";
  box.textContent = "";
}

function kickableCard(v, c) {
  return c.id !== null && c.faceUp && !c.everSelected && c.blockadedBy === null;
}

function showCurtain(seat) {
  if (!view) return;
  $("curtain-actor").textContent = view.players[seat].name + "(座位" + seat + ")";
  const sub = $("curtain-sub");
  if (view.intercept && view.intercept.candidateSeat === seat) {
    sub.innerHTML = "<b>" + esc(view.players[view.intercept.fromSeat].name) + "</b> 刚换入了 <b>" + esc(view.intercept.cardId) +
      "</b>,你是紧邻下家,可以截胡(费用见操作区)或放弃";
  } else {
    sub.textContent = "其他人请回避";
  }
  $("curtain").classList.remove("hidden");
}
function hideCurtain() { $("curtain").classList.add("hidden"); }

async function refresh() {
  if (replayMode) return;                     // 回放中不拉实时状态
  if (aiRunning) return;                      // 正在逐步推进 AI 时不要打断节奏
  const r = await api("/api/state" + (godView ? "?god=1" : ""));
  if (r.ok) { view = r.view; render(); pumpAI(); }
}
async function act(action) {
  action.clientActionId = "a" + Date.now() + Math.random().toString(36).slice(2, 6);
  const r = await api("/api/action", action);
  if (!r.ok) {
    $("hint").textContent = "× " + (r.error?.code ?? "") + " " + (r.error?.message ?? r.error);
    if (r.view) { view = r.view; render(); $("hint").textContent = "× " + (r.error?.code ?? "") + " " + (r.error?.message ?? r.error); }
    return;
  }
  view = r.view;
  pending = null; sel = { take: null };
  render();
  pumpAI();
}

const LS_KEY = "zjh.settings.v1";
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ players: playerCount(), table: $("table").value, agents: selectedAgents() })); } catch { /* 隐私模式 */ }
}
let currentSettings = "";
function settingsKey() { return playerCount() + "|" + $("table").value + "|" + selectedAgents().join(","); }

async function newGame() {
  const req = { players: playerCount(), table: $("table").value, agents: selectedAgents() };
  const r = await api("/api/new", req);
  if (r.ok) {
    view = r.view; pending = null; sel = { take: null }; lastActor = null; aiLog = [];
    currentSettings = settingsKey();
    saveSettings();
    aiLog = [];
    render();
    pumpAI();
  }
}

$("curtain-go").onclick = () => { hideCurtain(); refresh(); };
$("curtain-btn").onclick = () => {                     // 手动遮屏(单人时也能用)
  const v = view;
  if (v && v.actor !== null && !v.actorIsAI) { lastActor = v.actor; showCurtain(v.actor); }
};
$("table").onchange = () => markDirty();
$("seats").onchange = () => markDirty();
$("new").onclick = () => { stopAI(); newGame(); };
$("speed").onchange = () => { aiDelay = Number($("speed").value) || 0; };
$("reset").onclick = () => {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  location.reload();
};
function markDirty() { render(); }

// 首屏:兜底选项 → 恢复上次设置(校验后)→ 按设置开一局(而不是服务端写死的 3 人场)
(function boot() {
  try {
    ensureOptions("table", TABLE_CHOICES);
    const s = loadSettings();
    renderPlayerButtons();
    setPlayerCount(s.players === undefined || s.players === null ? 3 : s.players, true);
    setSelectValue("table", s.table, "auto");
    renderSeats(Array.isArray(s.agents) ? s.agents : undefined);
    loadAgentList().then(() => renderSeats(Array.isArray(loadSettings().agents) ? loadSettings().agents : undefined));
    newGame();
  } catch (err) {
    const box = $("hint");
    if (box) box.textContent = "初始化失败:" + (err && err.message ? err.message : err) + " —— 请点「重置设置」或 Ctrl+F5";
    console.error("boot failed", err);
  }
})();
setInterval(() => { if (!pending) refresh(); }, 3000);

// ===== 观战 & 回放 =====
let godView = false;
let replayMode = false;
const rpl = { file: null, steps: 0, step: 0, playing: false, timer: null, labels: [] };
const KEY_TYPES = { KICK: "踢牌", INTERCEPT: "截胡", COMPARE: "比牌", TAKE_BLOCKED: "收暗牌", FOLD: "弃牌" };

async function saveCurrent() {
  const r = await api("/api/replay/save", {});
  const al = $("ailine");
  if (al) al.textContent = r.ok ? "已存档:" + r.file + "(" + Math.round(r.bytes / 1024 * 10) / 10 + " KB,目录 " + r.dir + ")" : "存档失败";
  refreshReplayList();
}

async function refreshReplayList() {
  const r = await api("/api/replays");
  const sel = $("rpl-list");
  if (!sel || !r.ok) return;
  const cur = sel.value;
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = r.items.length ? "选择历史对局(" + r.items.length + ")" : "暂无历史对局";
  sel.appendChild(ph);
  for (const it of r.items) {
    const o = document.createElement("option");
    o.value = it.file;
    o.textContent = it.file.replace(".json", "") + " · " + it.hands + "局/" + it.actions + "步 · " + Math.round(it.sizeBytes / 1024) + "KB" + (it.reason ? " · " + it.reason : "");
    sel.appendChild(o);
  }
  if (cur) sel.value = cur;
}

async function openReplay(file) {
  const meta = await api("/api/replay/load?file=" + encodeURIComponent(file));
  if (!meta.ok) return;
  stopAI();
  rpl.file = file; rpl.steps = meta.steps; rpl.step = 0; rpl.labels = meta.labels ?? [];
  replayMode = true;
  const range = $("rpl-range");
  range.min = "0"; range.max = String(rpl.steps); range.value = "0";
  $("rpl-dl").href = "/api/replay/frame?file=" + encodeURIComponent(file) + "&raw=1";
  const key = $("rpl-key");
  key.innerHTML = '<option value="">跳到事件…</option>';
  rpl.labels.forEach((t, i) => {
    const name = KEY_TYPES[t];
    if (!name) return;
    const o = document.createElement("option");
    o.value = String(i + 1);
    o.textContent = "第 " + (i + 1) + " 步 · " + name;
    key.appendChild(o);
  });
  await showFrame(0);
}

async function showFrame(step) {
  step = Math.max(0, Math.min(rpl.steps, step));
  const r = await api("/api/replay/frame?file=" + encodeURIComponent(rpl.file) + "&step=" + step);
  if (!r.ok) return;
  rpl.step = step;
  view = r.view;
  render();
  $("rpl-range").value = String(step);
  $("rpl-step").textContent = "第 " + step + " / " + rpl.steps + " 步";
}

function togglePlay() {
  if (rpl.playing) {
    clearInterval(rpl.timer); rpl.timer = null; rpl.playing = false;
    $("rpl-play").textContent = "▶ 播放";
    return;
  }
  rpl.playing = true;
  $("rpl-play").textContent = "⏸ 暂停";
  const tick = aiDelay > 0 ? aiDelay : 120;
  rpl.timer = setInterval(() => {
    if (rpl.step >= rpl.steps) { togglePlay(); return; }
    showFrame(rpl.step + 1);
  }, tick);
}

function exitReplay() {
  if (rpl.playing) togglePlay();
  replayMode = false;
  $("replaybar").classList.add("hidden");
  $("ops").classList.remove("hidden");
  refresh();
}

$("god").onchange = () => { godView = $("god").checked; refresh(); };
$("next-hand").onclick = async () => {
  const r = await api("/api/next-hand", {});
  if (r.ok) { view = r.view; aiLog = []; render(); pumpAI(); }
  else { const al = $("ailine"); if (al) al.textContent = r.reason === "gameOver" ? "整场已结束,点「新开一场」再来" : "还不能开新局(" + r.reason + ")"; }
};
$("save").onclick = () => saveCurrent();
$("replay").onclick = async () => {
  await refreshReplayList();
  $("replaybar").classList.toggle("hidden", false);
  if (!$("rpl-list").value && replayMode) { /* 保持当前回放 */ }
};
$("rpl-list").onchange = () => { const f = $("rpl-list").value; if (f) openReplay(f); };
$("rpl-first").onclick = () => showFrame(0);
$("rpl-prev").onclick = () => showFrame(rpl.step - 1);
$("rpl-next").onclick = () => showFrame(rpl.step + 1);
$("rpl-last").onclick = () => showFrame(rpl.steps);
$("rpl-play").onclick = () => togglePlay();
$("rpl-range").oninput = () => showFrame(Number($("rpl-range").value));
$("rpl-key").onchange = () => { const v2 = $("rpl-key").value; if (v2) showFrame(Number(v2)); };
$("rpl-exit").onclick = () => exitReplay();
$("rpl-del").onclick = async () => {
  if (!rpl.file) return;
  await api("/api/replay?file=" + encodeURIComponent(rpl.file), undefined, "DELETE");   // DELETE 删除存档
  rpl.file = null;
  exitReplay();
  refreshReplayList();
};
refreshReplayList();
