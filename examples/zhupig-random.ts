// 八门拱猪·星月版 —— 随机局跑批(不含 LLM,纯确定性引擎的自检 + 分布)
//
// 用途:① 验证每局不变量与零和 ② 看分数的真实分布(公式把 +800 放大 3 倍,尾部会很肥)
//       ③ 统计特殊牌的真实出现频率(哪里最容易爆分)
// 用法:node examples/zhupig-random.ts [局数=1000]
import { createRng } from "../src/rng.ts";
import { CLASSIC_ZHUPIG } from "../src/games/zhupig/state.ts";
import { dealZhupig, legalZhupig, playZhupig, declareShow, checkZhupigInvariants, isSpecialId } from "../src/games/zhupig/rules.ts";
import { scoreZhupig } from "../src/games/zhupig/score.ts";

const N = Number(process.argv[2] ?? "1000");
const NAMES = ["A", "B", "C", "D"];
const rng = createRng(20261025);

const fins: number[] = [];
const personals: number[] = [];
const ambiguities = new Set<string>();
let countFull16 = 0, countAllRed = 0, countPigCut = 0, countTransCut = 0, countDouble8 = 0;
let countStar = 0, countMoon = 0, countWaterZero = 0, countLit = 0;
let totalTricks = 0, badInvariants = 0, badZeroSum = 0;
const maxFin: Array<{ fin: number; why: string }> = [];

for (let g = 0; g < N; g++) {
  const st = dealZhupig(CLASSIC_ZHUPIG, NAMES, 100000 + g);
  // 开局随机亮牌:每张特殊牌 50% 概率亮出
  for (const s of st.seats) {
    const lit = s.hand.filter((c) => isSpecialId(st.cfg, c) && rng.next() < 0.5).map((c) => c.id);
    declareShow(st, s.seat, lit);
    countLit += lit.length;
  }
  let guard = 0;
  while (!st.over && guard++ < 500) {
    const seat = st.turn;
    const legal = legalZhupig(st, seat);
    const pick = legal[Math.floor(rng.next() * legal.length)];
    const r = playZhupig(st, seat, pick.id);
    if (!r.ok) throw new Error("非法出牌: " + r.error);
  }
  totalTricks += st.trickNo - 1;
  if (checkZhupigInvariants(st).length) badInvariants += 1;
  const sc = scoreZhupig(st);
  sc.ambiguities.forEach((a) => ambiguities.add(a));
  const sum = sc.perSeat.reduce((a, x) => a + x.final, 0);
  if (Math.abs(sum) > 1e-9) badZeroSum += 1;
  for (const p of sc.perSeat) {
    fins.push(p.final);
    personals.push(p.personal);
    if (p.full16) countFull16 += 1;
    if (p.allRed) countAllRed += 1;
    if (p.entries.some((e) => e.kind === "pig" && e.invalid)) countPigCut += 1;
    if (p.entries.some((e) => e.kind === "transformer" && e.invalid)) countTransCut += 1;
    if (p.entries.some((e) => e.kind === "star8") && p.entries.some((e) => e.kind === "moon8")) countDouble8 += 1;
    if (p.entries.some((e) => e.kind === "star8")) countStar += 1;
    if (p.entries.some((e) => e.kind === "moon8")) countMoon += 1;
    if (p.entries.some((e) => e.kind === "water9" && Math.round(e.value) === -50)) countWaterZero += 1;
  }
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, a.length - 1)); };
const q = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
fins.sort((a, b) => a - b);

console.log("=== 八门拱猪·星月版 随机局跑批 · " + N + " 局(每局 4 人,共 " + fins.length + " 份个人成绩) ===");
console.log("  自检:不变量异常 " + badInvariants + " 局 · 零和异常 " + badZeroSum + " 局 · 平均每局 " + (totalTricks / N).toFixed(1) + " 轮");
console.log("  未定项(应为空): " + (ambiguities.size ? [...ambiguities].join(" / ") : "无 ✓"));
console.log("");
console.log("  本局个人分(公式前): 均值 " + mean(personals).toFixed(1) + " · 标准差 " + sd(personals).toFixed(1));
console.log("  最终得分(公式后)  : 均值 " + mean(fins).toFixed(1) + " · 标准差 " + sd(fins).toFixed(1));
console.log("  最终得分分位: 最小 " + fins[0].toFixed(0) + " · P25 " + q(fins, 0.25).toFixed(0) + " · 中位 " + q(fins, 0.5).toFixed(0) + " · P75 " + q(fins, 0.75).toFixed(0) + " · 最大 " + fins[fins.length - 1].toFixed(0));
console.log("");
console.log("  特殊事件频率(以「人次」计 / 共 " + fins.length + " 人次):");
console.log("    原16 齐全      " + countFull16 + " (" + (countFull16 / fins.length * 100).toFixed(1) + "%)");
console.log("    全红           " + countAllRed + " (" + (countAllRed / fins.length * 100).toFixed(1) + "%)");
console.log("    猪被砍         " + countPigCut + " (" + (countPigCut / fins.length * 100).toFixed(1) + "%)");
console.log("    变压器被砍     " + countTransCut + " (" + (countTransCut / fins.length * 100).toFixed(1) + "%)");
console.log("    星月双8同收    " + countDouble8 + " (" + (countDouble8 / fins.length * 100).toFixed(1) + "%)");
console.log("    收到星星8      " + countStar + " · 收到月牙8 " + countMoon);
console.log("    水滴 0 分情形  " + countWaterZero);
console.log("    本人亮出的特殊牌总数: " + countLit + "(平均每人次 " + (countLit / fins.length).toFixed(2) + " 张)");
