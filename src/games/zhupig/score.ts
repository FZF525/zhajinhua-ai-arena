// 八门拱猪·星月版 —— 算分器(纯确定性,零 LLM)
// 固定结算顺序(不可重排):① 星月刀 → ② 猪/羊/雪花 → ③ 有效红桃 → ④ 变压器 → ⑤ 水滴9 → ⑥ 原16 → ⑦ 公式
// 红桃 = **HEART 花色**(13 张),与特殊角色互不重叠(星/月是独立花色)→ 无"角色吃掉红桃"的冲突 ✓
import type { ZhupigState, ZhupigConfig, ZpPlay } from "./state.ts";
import { rankLabel, rankValue } from "./state.ts";

export type EntryKind = "pig" | "sheep" | "transformer" | "snow" | "water9" | "star8" | "moon8" | "heart";
export interface ZpEntry {
  kind: EntryKind; order: number; cardId: string; label: string; revealed: boolean;
  invalid: boolean; value: number; heartValue: number; note: string;
}
export interface ZpSeatScore {
  seat: number; name: string; entries: ZpEntry[]; invalidated: string[];
  pig: number; sheep: number; snow: number; heartsEffective: number;
  transformer: number; water9: number;
  allRed: boolean; full16: boolean; personal: number; final: number;
}
export interface ZpScoreResult { perSeat: ZpSeatScore[]; ledger: string[]; ambiguities: string[]; }

const LABEL: Record<EntryKind, string> = {
  pig: "猪", sheep: "羊", transformer: "变压器", snow: "雪花", water9: "水滴9",
  star8: "星星8", moon8: "月牙8", heart: "红桃",
};

export function classifyOf(cfg: ZhupigConfig, p: ZpPlay): EntryKind | null {
  const sp = cfg.specials;
  if (p.card.id === sp.pig.id) return "pig";
  if (p.card.id === sp.sheep.id) return "sheep";
  if (p.card.id === sp.transformer.id) return "transformer";
  if (p.card.id === sp.water9.id) return "water9";
  if (p.card.id === sp.star8.id) return "star8";
  if (p.card.id === sp.moon8.id) return "moon8";
  if (sp.snow.some((s) => s.id === p.card.id)) return "snow";
  if (p.card.suit === "HEART") return "heart";
  return null;
}

export function scoreZhupig(st: ZhupigState): ZpScoreResult {
  const cfg = st.cfg, sp = cfg.specials;
  const ambiguities: string[] = [];
  const ledger: string[] = [];
  const per: ZpSeatScore[] = [];

  for (const s of st.seats) {
    const entries: ZpEntry[] = [];
    s.pile.forEach((p, i) => {
      const kind = classifyOf(cfg, p);
      if (!kind) return;
      entries.push({
        kind, order: i, cardId: p.card.id,
        label: LABEL[kind] + (kind === "heart" ? "(" + rankLabel(p.card.rank) + ")" : ""),
        revealed: p.revealed, invalid: false, value: 0, heartValue: 0, note: "",
      });
    });
    // order 重排为"特殊条目顺序"
    entries.forEach((e, i) => { e.order = i; });
    per.push({ seat: s.seat, name: s.name, entries, invalidated: [], pig: 0, sheep: 0, snow: 0,
      heartsEffective: 0, transformer: 0, water9: 0, allRed: false, full16: false, personal: 0, final: 0 });
  }

  // ── ① 判星8 / 月8 ──
  ledger.push("① 判星月刀");
  for (const sc of per) {
    const hasStar = sc.entries.some((e) => e.kind === "star8");
    const hasMoon = sc.entries.some((e) => e.kind === "moon8");
    const both = hasStar && hasMoon;
    for (const e of sc.entries) {
      if (e.kind !== "star8" && e.kind !== "moon8") continue;
      const conf = e.kind === "star8" ? sp.star8 : sp.moon8;
      e.value = e.revealed ? conf.selfLit : conf.selfDark;   // 自身负分照算
      if (both) { e.note = "同收双8 → 砍效果失效,自身负分照算"; ledger.push("   " + sc.name + " 同收星8+月8 → 砍失效(自身 " + e.value + ")"); continue; }
      const k = e.revealed ? conf.cutLit : conf.cutDark;
      const dir = e.kind === "star8" ? 1 : -1;
      let cut = 0;
      for (let d = 1; d <= k; d++) {
        const t = sc.entries[e.order + dir * d];
        if (!t) { ledger.push("   " + sc.name + " 的" + e.label + " " + (dir > 0 ? "后继" : "前驱") + "不足 " + d + " 个"); break; }
        if (t.invalid) continue;
        if (t.kind === "star8" || t.kind === "moon8") { ledger.push("   " + e.label + " 想砍另一把刀 → 不生效(不连锁)"); continue; }
        t.invalid = true; cut += 1;
        sc.invalidated.push(t.label + "(" + t.cardId + ")");
        ledger.push("   " + sc.name + " 的" + e.label + (e.revealed ? "(亮)" : "") + " 砍掉" + (dir > 0 ? "后继" : "前驱") + " " + t.label);
      }
      if (!cut && !both) e.note = "没有条目被砍";
    }
  }

  // ── ② 猪 / 羊 / 雪花 ──
  ledger.push("② 猪 / 羊 / 雪花");
  for (const sc of per) {
    for (const e of sc.entries) {
      if (e.kind === "pig") { e.value = e.invalid ? 0 : sp.pig.value; sc.pig += e.value; }
      else if (e.kind === "sheep") { e.value = e.invalid ? 0 : sp.sheep.value; sc.sheep += e.value; }
      else if (e.kind === "snow") {
        const def = sp.snow.find((x) => x.id === e.cardId);
        const v = e.invalid || !def ? 0 : (e.revealed ? def.valueLit : def.value);
        if (!def || (def.value === 0 && def.valueLit === 0)) ambiguities.push("雪花 " + e.cardId + " 的分值未定义(规格缺口)→ 按 0 计");
        e.value = v; sc.snow += v;
      } else continue;
      if (e.value !== 0) ledger.push("   " + sc.name + " " + e.label + " " + (e.value > 0 ? "+" : "") + e.value);
    }
  }

  // ── ③ 有效红桃 ──
  ledger.push("③ 有效红桃");
  for (const sc of per) {
    for (const e of sc.entries) {
      if (e.kind !== "heart") continue;
      if (e.invalid) { e.heartValue = 0; e.note = "被砍 → 0 分,且不计入全红/原16"; continue; }
      const r = rankValue(e.cardId.split("-")[1] ?? "");
      const v = sp.hearts[r];
      if (v === undefined) ambiguities.push("红桃 " + e.cardId + " 的分值未定义");
      e.heartValue = v ?? 0; sc.heartsEffective += e.heartValue;
    }
    const validHearts = sc.entries.filter((e) => e.kind === "heart" && !e.invalid).length;
    const totalHearts = sc.entries.filter((e) => e.kind === "heart").length;
    sc.allRed = validHearts === 13;
    ledger.push("   " + sc.name + " 有效红桃 " + sc.heartsEffective + " 分(有效 " + validHearts + "/" + totalHearts + " 张)");
  }

  // ── ④ 变压器 ──
  ledger.push("④ 变压器");
  for (const sc of per) {
    for (const e of sc.entries) {
      if (e.kind !== "transformer") continue;
      if (e.invalid) { ledger.push("   " + sc.name + " 变压器被砍 → 无效,不补偿"); continue; }
      if (sc.heartsEffective > 0) {
        const mul = e.revealed ? sp.transformer.mulLit : sp.transformer.mul;
        sc.transformer = sc.heartsEffective * (mul - 1); e.value = sc.transformer;
        ledger.push("   " + sc.name + " 红桃 " + sc.heartsEffective + " ×" + mul + " → 追加 " + sc.transformer);
      } else {
        const flat = e.revealed ? sp.transformer.flatLit : sp.transformer.flat;
        sc.transformer = flat; e.value = flat;
        ledger.push("   " + sc.name + " 无有效红桃 → 变压器 " + (flat > 0 ? "+" : "") + flat);
      }
    }
  }

  // ── ⑤ 水滴9 ──
  ledger.push("⑤ 水滴9");
  for (const sc of per) {
    const soFar = sc.pig + sc.sheep + sc.snow + sc.heartsEffective + sc.transformer;
    for (const e of sc.entries) {
      if (e.kind !== "water9") continue;
      if (e.invalid) { ledger.push("   " + sc.name + " 水滴被砍 → 无效"); continue; }
      if (soFar !== 0) {
        sc.water9 = soFar / (e.revealed ? 4 : 2) - soFar; e.value = sc.water9;
        ledger.push("   " + sc.name + " 个人分 " + soFar + " ≠ 0 → 水滴" + (e.revealed ? "1/4" : "减半") + "(变动 " + sc.water9 + ")");
        if (!Number.isInteger(sc.water9)) ambiguities.push("水滴减半产生小数(" + sc.water9 + ")—— 取整方式未定义");
      } else {
        sc.water9 = e.revealed ? -100 : -50; e.value = sc.water9;
        ledger.push("   " + sc.name + " 个人分 = 0 → 水滴 " + sc.water9);
      }
    }
  }

  // ── ⑥ 原16 齐全 ──
  ledger.push("⑥ 原16 齐全(13 张红桃 + 猪 + 羊 + 变压器,只认有效条目)");
  for (const sc of per) {
    const valid = (k: EntryKind) => sc.entries.some((e) => e.kind === k && !e.invalid);
    const vh = sc.entries.filter((e) => e.kind === "heart" && !e.invalid).length;
    sc.full16 = vh === 13 && valid("pig") && valid("sheep") && valid("transformer");
    ledger.push("   " + sc.name + ":" + (sc.full16 ? "原16 齐全 → +" + sp.full16Bonus : "不齐(红桃 " + vh + "/13)"));
  }

  // ── ⑦ 汇总 + 公式(+800 在公式之前加入个人分 → 被 ×3 放大)──
  ledger.push("⑦ 汇总与公式(最终 = 个人×" + cfg.formulaMul + " − 其余三家个人和)");
  for (const sc of per) {
    sc.personal = sc.pig + sc.sheep + sc.snow + sc.heartsEffective + sc.transformer + sc.water9
      + (sc.full16 ? sp.full16Bonus : 0) + (sc.allRed && !sc.full16 ? sp.allRedBonus : 0);
    ledger.push("   " + sc.name + " 个人分 = " + sc.personal);
  }
  for (const sc of per) {
    const others = per.filter((x) => x.seat !== sc.seat).reduce((a, x) => a + x.personal, 0);
    sc.final = sc.personal * cfg.formulaMul - others;
    ledger.push("   " + sc.name + " 最终 = " + sc.personal + "×" + cfg.formulaMul + " − " + others + " = " + sc.final);
  }
  ledger.push("   四家总计 " + per.reduce((a, x) => a + x.final, 0) + "(公式恒零和)");

  if (sp.snow.some((s) => s.value === 0 && s.valueLit === 0)) ambiguities.push("雪花 5/10/K 的分值未定(配置仍占位)");
  if (sp.allRedBonus === 0) ambiguities.push("全红奖励值未定(规格只写'不与原16叠加')");
  return { perSeat: per, ledger, ambiguities: [...new Set(ambiguities)] };
}
