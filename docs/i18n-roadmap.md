# 多语言界面:交接说明 / i18n handoff

> 状态:**设计已定、服务端实现已验证(在分支 `i18n-wip`)、main 已回退**。
> 这份文档把「为什么这样做、坑在哪、还差什么、怎么验收」交出去,让有缘人接着干。

## 0. 先读这个

**术语表是地基**:[`docs/glossary.zh-en.md`](glossary.zh-en.md) —— 12 档牌型 + 8 花色 + 4 色系 + 11 动作的中英对照与定义。
不动术语表就翻界面,一定翻错 —— 这个变体有多个传统扑克**不存在**的牌型与动作。

## 1. 现状

| 部分 | 状态 |
| --- | --- |
| 术语表 | ✔ 已在 main |
| 服务端 i18n(模块 + 目录 + `?lang=` + 6 条守卫 + 1 条 E2E 冒烟) | ✔ 已实现,**起服务实测通过**,在分支 `i18n-wip` |
| 前端文案(按钮/标题/提示) | ✗ 未做(约 215 处) |
| 英文 LLM prompt | ✗ 未做(**有风险,见 §5**) |
| `spec.md` 全文英文 | ✗ 未做(建议最后) |

```bash
# 把已完成的服务端部分拿回来看看(不要直接 merge,先读 diff)
git checkout i18n-wip -- src/i18n.ts src/locales src/format.ts src/evaluator.ts src/cards.ts web/view.ts web/server.ts test/i18n.test.ts
```

## 2. 架构:**只有格式化层需要目录,引擎不用改**

这是本次调研最重要的结论 —— 工程量比想象小得多:

```
引擎(GameState / GameEvent)     ← 已经结构化(kind + 座位 + 金额),一行不用改 ✓
   ↓
格式化层(evaluator / cards / format / view) ← 【只有这一层有中文】换成 t(locale, key) ✓
   ↓
前端(app.js / index.html)        ← 约 215 处文案,独立一趟
```

三层的分工:

| 层 | 文件 | 处数 | 做法 |
| --- | --- | --- | --- |
| 牌型名(12) | `src/evaluator.ts` | 12 | `categoryLabel(cat, locale)`;`describe(v, locale)` |
| 花色/色系 | `src/cards.ts` | 12 | `suitName()` / `familyName()` |
| 事件日志(23 模板) | `src/format.ts` | 62 | 全部模板进目录,`describeEvent(e, { locale })` |
| 面板/视角 | `web/view.ts` | ~10 | `buildView(..., { locale })`(该文件中文本体都在注释里,代码几乎不用动)|
| 前端 | `web/public/*` | **215** | 见 §4 |

## 3. 关键决策(别重新发明)

1. **`en` 是唯一目标语言** —— 翻译瓶颈是**术语精度**,不是语言数量;五国语言各翻一半,英文玩家第一天就会把「同色顺」当成顺子 ✗
2. **颜色词不能当色系名** ✗ —— 中文「黑」= ♠+♣,英文 `black suit` 会被读成**黑桃** → 用 **Coal / Blood / Frost / Solar**,并在 UI 悬停显示「= ♠ + ♣」
3. **档位阶梯要常驻展示** —— 英文玩家会默认德州顺序(四条 > 同花),而本变体是 **同花(9) > 四条(8)** ✗,且 **同色顺(10)** 与**同花顺(12)** 只差一个词
4. **协议值一律不翻**:牌 id(`SPADE-10`)、动作名(`FOLD`/`CALL`/`KICK`)、配置键(`allowDebt`)、`reason` 码(`hand_end`/`kicker_took`)
5. **AI 角色名不翻**:Baozi / Yeon / May / Brian / Sam / Lucas / EQB / ZeroB —— 只翻**风格标签**(保守 → Conservative)与类型
6. **缺键回退中文**(`t()` 里实现):允许渐进翻译,但**守卫测试会拦住未翻译的英文条目**

## 4. 还没做的前端一趟(约 215 处)

| 文件 | 处数 | 内容 |
| --- | --- | --- |
| `web/public/app.js` | 156 | 动态提示、错误文案、状态行、结算面板 |
| `web/public/index.html` | 59 | 静态标签、按钮、表头 |

建议做法:

1. 新增 `web/public/i18n.js`:客户端目录(**复用服务端同一套 key** —— `tier.*` / `suit.*` / `event.*`),加一个 `T(key, params)`
2. 右上角加语言下拉,存 localStorage,**每次请求带 `?lang=`**(服务端已支持)
3. 替换全部字面量;**HTML 里用 `data-i18n="key"` 属性**,启动时统一填充(比手写 `innerHTML` 安全)
4. 加一条**前端字幕守卫**:扫描 `app.js` / `index.html`,除目录文件外不得出现裸中文(思路同现有的 `HTML-07` 语法闸门)

## 5. ⚠️ 英文 LLM prompt:必须重新验证,不能直接翻

`src/ai/remote.ts` 里有 43 处中文 prompt ✓(不是界面文案 ✗)。**prompt 措辞会直接改变模型行为** ✓ —— 实测证据:

```
加了一句「闷牌禁止 FOLD + 指名道姓的反例」
→ GLM 的弃牌率从 100% 降到 28~50%,而且不再需要代码兜底
```

所以英文 prompt 翻完必须重新跑这两条断言:

* `RM-12` 闷牌时返回 FOLD 必须被换成免费看牌(代码兜底,与语言无关)
* `RM-13` 类型对但参数抄错 → 修补成最优变体,而不是兜底弃牌

并且建议补一条:**英文 prompt 下,模型不得 100% 弃牌**(单局 6 次决策里 FOLD ≤ 4 次)。

## 6. 验收标准(服务端已完成的部分,6 条守卫)

这 6 条在 `i18n-wip` 的 `test/i18n.test.ts` 里,搬回来就能用:

| 用例 | 断言 | 防什么 |
| --- | --- | --- |
| `I18N-01` | 中英目录**键集完全一致** | 漏翻 ✗ |
| `I18N-02` | 英文目录里**不得残留中文** | 「翻一半」✗ |
| `I18N-03` | 12 个牌型名与术语表一致(`Five of a Kind` / `Colour Straight` / `Straight Flush`) | 术语漂移 ✗ |
| `I18N-04` | 事件日志支持英文,且**默认仍是中文**;脱敏文案也要跟着语言(`[hidden]`) | 破坏既有行为 / 英文界面蹦中文 ✗ |
| `I18N-05` | `buildView(state, true, { locale: "en" })` 的 JSON 里**零中文字符** | 整条渲染链漏翻 ✗ |
| `I18N-06` | `resolveLocale`:`en-US → en`,`fr → zh`,缺键回退中文 | 语言判定 / 渐进翻译 ✗ |
| `E2E-SRV-01` | **真起 `web/server.ts`**,走一遍 新开一场 → 查询 → 推进 → 存档 → 读档 → `?lang=en` | 只有真跑才暴露的服务端错误 ✗(见 §8) |

## 7. 怎么手工验证

```bash
cd zhajinhua
node web/server.ts
# 中文(默认)
curl -s "http://127.0.0.1:8787/api/state" | head -c 400
# 英文(服务端内容会变英文;前端按钮此刻还是中文 —— 这就是 §4 要补的原因)
curl -s "http://127.0.0.1:8787/api/state?lang=en" | head -c 400
```

## 8. 为什么 main 上回退了

作者报告「参数显示」有问题,于是把 i18n 整份回退到已验证的 `ec3c4cb`(本地 == 远端),只在 main 保留术语表 ✓

**原因就是这次 i18n 改动** ✗ —— 把 `localeOf(req, url)` 塞进了**没有 `req` 参数的辅助函数**(`viewWithAgents` / `stepOnce`):

```ts
// 出错版本(i18n-wip 初版)
function viewWithAgents(reveal = true, god = false) {          // ← 参数里没有 req
  const v = buildView(game, reveal, { ..., locale: localeOf(req, url) });  // ← 引用未定义的 req ✗
}
```

开局时 `newGame → viewWithAgents()` 立刻抛 `ReferenceError: req is not defined` ✓
而前端把**任何**开局失败都渲染成「参数有问题,没有开局」✗ —— 所以看起来像参数问题 ✓
(顺带:界面最好把原始错误放得更显眼,别让人以为是自己填错了参数 ✓)

**已在分支上修好** ✓:`locale` 改成**显式形参**(每个请求解析一次,显式往下传 ✓),并补了 `E2E-SRV-01` 起服务冒烟 ✓

**为什么全套 139 条测试没抓到** ✗:测试全是库级调用,没有一个真的启动 HTTP 服务 ✓
—— 这就是那条测试存在的意义 ✓ **改服务端之后,先跑它** ✓
## 9. 参考

* 术语表:[`docs/glossary.zh-en.md`](glossary.zh-en.md)
* 外部 AI 接入(含 prompt 相关):[`docs/llm-entry.md`](llm-entry.md)
* 踩坑史(方法学):[`docs/lessons.md`](lessons.md) —— 「静默替换失败」「测试与实际产物不一致」这两条对 i18n 尤其相关