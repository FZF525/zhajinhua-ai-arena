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
/** 安全绑定:元素不存在就跳过 —— 旧缓存的前端文件不该把整个界面搞崩(真出过:人数按钮消失) */
function on(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, fn); return el; }

/** 启动自检:核心控件缺了就明确报错,而不是静默崩掉 */
function selfCheck() {
  const required = ["players", "table", "seats", "ops", "log", "hint", "new", "speed", "reset",
    "num-ante", "num-start", "num-win", "num-bust", "num-hands", "num-debt",
    "num-cmp-round", "num-cmp-protect", "num-cmp-cost", "thresh-hint", "settingline"];
  const missing = required.filter((id) => !$(id));
  if (missing.length === 0) return true;
  const msg = "⚠ 前端文件版本不一致:缺少控件 " + missing.join(", ") + " —— 请按 Ctrl+F5 强制刷新";
  const box = $("hint");
  if (box) { box.textContent = msg; box.style.color = "#e2857e"; }
  console.error(msg);
  return false;
}

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

const EXPECT_SERVER = "1.10.0";   // 与服务端 src/version.ts 对齐

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
  // replayBarOpen:用户点了「回放」但还没选文件时,工具条也要留住 —— 否则下一轮轮询就会把它 hidden 掉(真 bug)
  if (bar) bar.classList.toggle("hidden", !(replayMode || replayBarOpen));
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
      '<span class="pts">' + pointsText(p.points) + '</span>' + badge + '<span class="badge">已投 ' + p.committed + '</span>';
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
    // 欠债模式:不再因为"付不起"禁用按钮 —— 付了会变负数,由破产阈值决定何时出局
    const myPoints = v.actor === null ? 0 : v.players[v.actor].points;
    const afford = (v.allowDebt === true || v.actor === null) ? true : (myPoints >= (l.cost ?? 0) || l.name === "VIEW_HAND");
    b.disabled = !afford;
    if (v.allowDebt === true && v.actor !== null && myPoints < (l.cost ?? 0)) {
      b.classList.add("debt");
      b.title = "欠债模式:这一手会让你变成 " + (myPoints - (l.cost ?? 0)) + " 分(负债)";
    }
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

  numbersHint(v);
  // 设置回显(纯文本,不会因为控件渲染问题而看不见)
  const echo = $("settingline");
  if (echo) {
    const seatTxt = [...$("seats").querySelectorAll("select")].map((s2, i2) => i2 + "=" + (s2.value === "human" ? "人类" : s2.value)).join(" ");
    const tsel = $("table");
    const tableTxt = tsel && tsel.selectedOptions && tsel.selectedOptions[0] ? tsel.selectedOptions[0].textContent : "?";
    const nums = readNumbers();
    const numTxt = Object.keys(nums).length ? " · 自定义 " + JSON.stringify(nums) : "";
    echo.textContent = (v.god ? "【上帝视角已开:所有人手牌可见】 " : "") +
      "当前设置:人数 " + playerCount() + " · 分场 " + tableTxt + numTxt + " · 座位 " + seatTxt +
      (settingsKey() !== currentSettings ? "  ← 已改动,点「按上面设置新开一场」生效" : "");
  }

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
        return "<div class='row'><span class='nm'>" + esc(p.name) + "</span><span>" + pointsText(p.points) + "</span>" +
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

/** 积分显示:负分标成"欠债" */
function pointsText(pts) {
  return pts < 0 ? '<span style="color:#e2857e">' + pts + " 分 · 欠债</span>" : pts + " 分";
}

/** 读自定义数值:空 = 用分场预设 */
function readNumbers() {
  const pick = (id) => { const el = $(id); const t2 = el ? el.value.trim() : ""; return t2 === "" ? undefined : Number(t2); };
  const out = {};
  const ante = pick("num-ante"), start = pick("num-start"), win = pick("num-win"), bust = pick("num-bust"), hands = pick("num-hands");
  if (Number.isFinite(ante)) out.ante = ante;
  if (Number.isFinite(start)) out.startPoints = start;
  if (Number.isFinite(win)) out.winAtOrAbove = win;
  if (Number.isFinite(bust)) out.bustAtOrBelow = bust;
  if (Number.isFinite(hands)) out.maxHands = hands;
  const debt = $("num-debt");
  if (debt && debt.checked) out.allowDebt = true;
  const cr = pick("num-cmp-round"), cp = pick("num-cmp-protect"), cc = pick("num-cmp-cost");
  if (Number.isFinite(cr)) out.compareMinRound = cr;
  if (Number.isFinite(cp)) out.blindTargetProtectRounds = cp;
  if (Number.isFinite(cc)) out.compareCostMultiplier = cc;
  return out;
}
function applyNumbers(n) {
  const set = (id, v2) => { const el = $(id); if (el) el.value = (v2 === undefined || v2 === null) ? "" : String(v2); };
  set("num-ante", n?.ante); set("num-start", n?.startPoints); set("num-win", n?.winAtOrAbove);
  set("num-bust", n?.bustAtOrBelow); set("num-hands", n?.maxHands);
  const debt = $("num-debt");
  if (debt) debt.checked = n?.allowDebt === true;
  set("num-cmp-round", n?.compareMinRound); set("num-cmp-protect", n?.blindTargetProtectRounds); set("num-cmp-cost", n?.compareCostMultiplier);
}
let numberIssues = [];   // 服务端对自定义数值的校验结果
/** 底部提示:当前生效数值 + 校验问题 + 阈值差与场次长度的实测经验 */
function numbersHint(v) {
  const box = $("thresh-hint");
  if (!box || !v) return;
  const bad = numberIssues.filter((i) => i.level === "error");
  const warn = numberIssues.filter((i) => i.level === "warn");
  if (bad.length || warn.length) {
    box.textContent = (bad.length ? "❌ " + bad.map((i) => i.message).join("　❌ ") : "") +
      (warn.length ? (bad.length ? "　" : "") + "⚠ " + warn.map((i) => i.message).join("　⚠ ") : "");
    box.style.color = bad.length ? "#e2857e" : "#e8c56b";
    return;
  }
  box.style.color = "";
  box.textContent = (v.allowDebt ? "【欠债模式:分值可为负,由破产阈值决定何时出局】 " : "") +
    "当前生效:底注 " + v.fees.ante + " 分 · 跟注 " + v.fees.seen + "/" + v.fees.blind + " · 胜利阈值 " + v.winAtOrAbove + " · 局数上限 " + (v.maxHands ?? "不限") +
    "　|　底注是刻度:填了它会把整张费用表等比缩放(跟注/闷注/换牌/踢牌同比例),不破坏玩法平衡。" +
    "　|　比牌:未看牌保护轮数设 1 可治「没看牌就被干掉」(实测狙击降 85%,比牌总数几乎不变);涨价没用(AI 不算比牌费)。" +
    "　|　实战经验:阈值差和注码刻度一起决定场次长度 —— 6 人自适应分场实测 差 2000≈1 手 / 5000≈2 手 / 10000≈6 手 / 20000≈20 手。";
}

const LS_KEY = "zjh.settings.v1";
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ players: playerCount(), table: $("table").value, agents: selectedAgents(), numbers: readNumbers() })); } catch { /* 隐私模式 */ }
}
let currentSettings = "";
function settingsKey() { return playerCount() + "|" + $("table").value + "|" + selectedAgents().join(","); }

async function newGame() {
  const req = { players: playerCount(), table: $("table").value, agents: selectedAgents(), numbers: readNumbers() };
  const r = await api("/api/new", req);
  numberIssues = Array.isArray(r.issues) ? r.issues : [];
  if (!r.ok) {
    const box = $("thresh-hint");
    if (box) {
      box.style.color = "#e2857e";
      box.textContent = "❌ 参数有问题,没有开局:" + (r.error ?? "") +
        (numberIssues.length ? "　" + numberIssues.filter((i) => i.level === "error").map((i) => i.message).join("　") : "");
    }
    if (view) render();
    return;
  }
  if (r.ok) {
    view = r.view; pending = null; sel = { take: null }; lastActor = null; aiLog = [];
    currentSettings = settingsKey();
    saveSettings();
    aiLog = [];
    render();
    pumpAI();
  }
}

// ↓ 先把核心界面跑起来(人数按钮等),再绑定其余控件:后者即使出问题也不影响核心
// 首屏:兜底选项 → 恢复上次设置(校验后)→ 按设置开一局(而不是服务端写死的 3 人场)
(function boot() {
  try {
    if (!selfCheck()) { renderPlayerButtons(); return; }   // 缺控件也要把人数按钮渲染出来
    ensureOptions("table", TABLE_CHOICES);
    const s = loadSettings();
    renderPlayerButtons();
    setPlayerCount(s.players === undefined || s.players === null ? 3 : s.players, true);
    setSelectValue("table", s.table, "auto");
    applyNumbers(s.numbers);
    renderSeats(Array.isArray(s.agents) ? s.agents : undefined);
    loadAgentList().then(() => renderSeats(Array.isArray(loadSettings().agents) ? loadSettings().agents : undefined));
    newGame();
  } catch (err) {
    const box = $("hint");
    if (box) box.textContent = "初始化失败:" + (err && err.message ? err.message : err) + " —— 请点「重置设置」或 Ctrl+F5";
    console.error("boot failed", err);
  }
})();

{"try" === "never" ? 0 : 0}
$("curtain-go").onclick = () => { hideCurtain(); refresh(); };
$("curtain-btn").onclick = () => {                     // 手动遮屏(单人时也能用)
  const v = view;
  if (v && v.actor !== null && !v.actorIsAI) { lastActor = v.actor; showCurtain(v.actor); }
};
$("table").onchange = () => markDirty();
$("seats").onchange = () => markDirty();
{ const el = $("num-debt"); if (el) el.onchange = () => markDirty(); }
for (const id of ["num-ante", "num-start", "num-win", "num-bust", "num-hands", "num-cmp-round", "num-cmp-protect", "num-cmp-cost"]) {
  const el = $(id);
  if (el) el.oninput = () => markDirty();
}
$("new").onclick = () => { stopAI(); newGame(); };
$("speed").onchange = () => { aiDelay = Number($("speed").value) || 0; };
$("reset").onclick = () => {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  location.reload();
};
function markDirty() { render(); }

setInterval(() => { if (!pending) refresh(); }, 3000);

// ===== 观战 & 回放 =====
let godView = false;
let replayMode = false;
let replayBarOpen = false;      // 回放工具条是否被用户显式打开(未选文件时也要保持可见)
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
  replayBarOpen = false;
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
  replayBarOpen = true;
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
