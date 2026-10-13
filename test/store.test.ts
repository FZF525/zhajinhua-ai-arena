// 存档层用例:写/列/读/删/清理 + 防路径穿越
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveReplay, listReplays, loadReplay, deleteReplay, pruneReplays, isValidReplayName, replaysDir } from "../src/store.ts";
import { createRecorder, record, replayTo } from "../src/replay.ts";
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";

const dir = mkdtempSync(join(tmpdir(), "zhj-replays-"));
process.env.ZHJ_REPLAY_DIR = dir;

function makeRec(seed: number) {
  const names = ["A", "B", "C"];
  const cfg = { players: { startPoints: 20000 } };
  const st = createGame(makeConfig(cfg), names, seed);
  advance(st);
  const rec = createRecorder(seed, names, cfg);
  let steps = 0;
  while (!st.gameOver && steps++ < 60) {
    const seat = st.turn.seat;
    if (seat === null) break;
    const a = { type: "CALL", seat } as const;
    const r = apply(st, a);
    if (!r.ok) break;
    record(rec, a);
  }
  return rec;
}

test("ST-01 存档目录可被 ZHJ_REPLAY_DIR 覆盖", () => {
  assert.equal(replaysDir(), dir);
});

test("ST-02 保存 → 列表 → 读回 → 重放一致", () => {
  const rec = makeRec(101);
  const saved = saveReplay(rec, { hands: 2, players: rec.players, actions: rec.actions.length });
  assert.ok(saved.bytes > 100);
  const items = listReplays().filter((x) => x.file === saved.file);
  assert.equal(items.length, 1);
  assert.equal(items[0].actions, rec.actions.length);
  const back = loadReplay(saved.file);
  assert.equal(back.seed, rec.seed);
  assert.deepEqual(back.actions, rec.actions);
  const frame = replayTo(back, Math.min(3, back.actions.length));
  assert.ok(frame.players.length === 3);
});

test("ST-03 删除与保留策略", () => {
  const a = saveReplay(makeRec(1), { hands: 1, players: ["A"], actions: 1 }, "aaa-1.json");
  const b = saveReplay(makeRec(2), { hands: 1, players: ["A"], actions: 1 }, "bbb-2.json");
  assert.equal(deleteReplay(a.file), true);
  assert.equal(deleteReplay(a.file), false, "重复删除应返回 false");
  assert.ok(b.bytes > 0);
  const removed = pruneReplays(0);
  assert.ok(removed >= 1, "keep=0 应清空");
  assert.equal(listReplays().length, 0);
});

test("ST-04 非法文件名一律拒绝(防路径穿越)", () => {
  for (const bad of ["../evil.json", "a/b.json", "..\\evil.json", "x.txt", "/etc/passwd"]) {
    assert.equal(isValidReplayName(bad), false, "应拒绝 " + bad);
  }
  assert.equal(isValidReplayName("20260101-120000-3p-abc-20h.json"), true);
  assert.throws(() => loadReplay("../evil.json"), /非法存档名/);
});
