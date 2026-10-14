// 前端静态检查:防止再出现"重复 id 导致渲染写错元素"这类 bug(踩过一次,很难查)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = new URL("../web/public/", import.meta.url);
const html = readFileSync(new URL("index.html", DIR), "utf8");
const js = readFileSync(new URL("app.js", DIR), "utf8");

test("HTML-01 index.html 的 id 全部唯一", () => {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual(dup, [], "重复 id: " + dup.join(",") + " —— getElementById 只会返回第一个,另一个会被写坏");
});

test("HTML-02 app.js 引用的元素 id 都存在于 HTML", () => {
  const declared = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const used = [...js.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]);
  const missing = [...new Set(used)].filter((id) => !declared.has(id));
  assert.deepEqual(missing, [], "app.js 引用了不存在的 id: " + missing.join(","));
});

test("HTML-03 页头人数控件与座位面板是两个不同元素", () => {
  assert.ok(html.includes('id="players"'), "页头人数控件应存在");
  assert.ok(html.includes('id="playerlist"'), "座位面板应存在");
  assert.ok(!/id="players"[^>]*class="players"|class="players"[^>]*id="players"/.test(html), "两者不能是同一个元素");
});

test("HTML-04 关键控件齐全", () => {
  for (const id of ["table", "new", "curtain-btn", "reset", "seats", "settingline", "playerlist", "pool", "ops", "hint", "log",
                  "god", "save", "replay", "replaybar", "rpl-list", "rpl-prev", "rpl-next", "rpl-play", "rpl-range", "rpl-step", "rpl-key", "rpl-exit", "advanced", "num-ante", "num-start", "num-win", "num-bust", "num-hands", "num-debt", "num-cmp-round", "num-cmp-protect", "num-cmp-cost", "thresh-hint"]) {
    assert.ok(html.includes('id="' + id + '"'), "缺少 #" + id);
  }
});

test("HTML-05 前端期望的服务端版本与 src/version.ts 一致", () => {
  const versionFile = readFileSync(new URL("../src/version.ts", import.meta.url), "utf8");
  const ver = versionFile.match(/ENGINE_VERSION = "([^"]+)"/)?.[1];
  const expect = js.match(/EXPECT_SERVER = "([^"]+)"/)?.[1];
  assert.ok(ver, "src/version.ts 应该有 ENGINE_VERSION");
  assert.equal(expect, ver, "前端 EXPECT_SERVER=" + expect + " 与服务端 " + ver + " 不一致 —— 改了版本号要两边一起改");
});

test("HTML-06 欠债模式不得在前端禁用按钮(引擎已放开,前端不能又拦住)", () => {
  const js = readFileSync(new URL("../web/public/app.js", import.meta.url), "utf8");
  const line = js.split("\n").find((l) => l.includes("const afford =")) ?? "";
  assert.ok(line.includes("v.allowDebt"), "afford 判断必须考虑 allowDebt:实际 " + line.trim());
  assert.ok(js.includes("按钮") || js.includes("欠债模式:不再因为"), "应有说明性注释");
});

test("HTML-07 语法闸门:所有前端 JS 都必须能通过 node --check(防止中文引号截断字符串这类低级但致命的事故)", () => {
  const files = ["web/public/app.js"];
  for (const f of files) {
    const p = new URL("../" + f, import.meta.url);
    // 直接用 node --check 验证(能捕获"字符串被中文引号截断"这类问题)
    const r = spawnSync(process.execPath, ["--check", fileURLToPath(p)], { encoding: "utf8" });
    assert.equal(r.status, 0, f + " 语法错误:\n" + (r.stderr || "").split("\n").slice(0, 6).join("\n"));
  }
});

test("HTML-08 回放工具条不能被轮询自动隐藏(用户点「回放」后应保持可见)", () => {
  assert.ok(js.includes("replayBarOpen"), "应有 replayBarOpen 标记");
  const lines = js.split("\n").filter((l) => l.includes('classList.toggle("hidden", !('));
  assert.ok(lines.some((l) => l.includes("replayBarOpen")), "工具条可见性必须考虑 replayBarOpen,实际:" + lines.join(" | "));
});

test("HTML-09 卡片文本不许换行(emoji 花色比文本符号宽一倍,\"符号+10\"曾在卡里断成两行)", () => {
  const link = readFileSync(new URL("../web/public/style.css", import.meta.url), "utf8");
  const all = link.split("\n");
  const i0 = all.findIndex((l) => l.startsWith(".card{"));
  const cardRule = all.slice(i0, all.findIndex((l, i) => i >= i0 && l.includes("}")) + 1).join(" ");
  assert.ok(cardRule.includes("white-space:nowrap"), ".card 必须 nowrap,实际:" + cardRule.slice(0, 100));
  assert.ok(/width:(6[0-9]|7[0-9])px/.test(cardRule), ".card 宽度应 >= 60px,实际:" + (cardRule.match(/width:\d+px/) ?? [""])[0]);
  const cards = readFileSync(new URL("../src/cards.ts", import.meta.url), "utf8");
  for (const name of ["SNOW", "DROPLET", "STAR", "MOON"]) {
    const line = cards.split("\n").find((l) => l.includes('id: "' + name + '"')) ?? "";
    assert.ok(line.includes("\\uFE0E"), name + " 必须带文本呈现变体符 U+FE0E,实际:" + line.slice(0, 90));
  }
});
