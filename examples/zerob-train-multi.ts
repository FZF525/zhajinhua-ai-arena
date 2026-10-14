// 多人自对弈训练:ZeroB 的覆盖率瓶颈在"训练对局人数",不在训练量
//   node examples/zerob-train-multi.ts [人数=6] [手数=40000] [种子=778] [输出=data/zerob-p6.json] [基础表=data/zerob.json]
// 实测:2 人自对弈 30000 手只把状态从 147 → 191;4 人 4 万手 → 468;6 人 4 万手 → 684(状态空间 1200)
import { trainZeroB, loadZeroB, saveZeroB, zeroBPath } from "../src/ai/learning.ts";
import type { ZeroBTable } from "../src/ai/learning.ts";

const PLAYERS = Number(process.argv[2] ?? 6);
const HANDS = Number(process.argv[3] ?? 40000);
const SEED = Number(process.argv[4] ?? 778);
const OUT = process.argv[5] ?? "data/zerob-p" + PLAYERS + ".json";
const BASE = process.argv[6] ?? zeroBPath();
// 复合回报:--reward=名次,取胜,净收益   (例如 --reward=0.5,0.4,0.1);不填 = 纯净收益
const REWARD_ARG = process.argv.find((a) => a.startsWith("--reward="));
const REWARD = REWARD_ARG ? (() => {
  const [rank, win, points] = REWARD_ARG.split("=")[1].split(",").map(Number);
  return { rank, win, points };
})() : undefined;

const base = BASE === "none" ? null : loadZeroB(BASE);
const cov = (t: ZeroBTable) => Object.keys(t.q).length;
console.log("基础表: " + (base ? BASE + "(" + base.trainedHands + " 手 / " + cov(base) + " 状态)" : "空表"));
const t0 = Date.now();
const t = trainZeroB({ hands: HANDS, seed: SEED, table: base ?? undefined, keyOpts: {}, players: PLAYERS, reward: REWARD });
console.log("回报权重: " + (REWARD ? "名次 " + REWARD.rank + " / 取胜 " + REWARD.win + " / 净收益 " + REWARD.points : "纯净收益(旧)"));
console.log(PLAYERS + " 人自对弈 " + HANDS + " 手: " + ((Date.now() - t0) / 1000).toFixed(1) + "s → 状态 " + cov(t) +
  " / " + t.trainedHands + " 手(状态空间 1200,覆盖率 " + (cov(t) / 1200 * 100).toFixed(1) + "%)");
saveZeroB(t, OUT);
console.log("已保存 " + OUT);
console.log("");
console.log("注意:覆盖率提升 ≠ 更强。用配对评估器验证(约 8 分钟):");
console.log("  node examples/zerob-eval.ts data/zerob.json#EQBfast " + OUT + "#EQBfast 120 6 multi4");
