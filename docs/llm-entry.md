# 让 LLM 上场:外部选手接入指南

> 你只需要一个 **OpenAI 兼容的 HTTP 端点**。不用改代码、不用装依赖、不用读源码。

## 0. 先说清楚公平性

引擎只把**你座位该看到的信息**发给你的模型:

- ✅ 发给模型:你自己的手牌(看牌后)、7 张公共池明牌、各家积分与状态、可选动作与费用
- ❌ 绝不发送:别人的手牌、牌堆、别人踢出的暗牌、**以及日志里出现的暗牌 id**(已脱敏成 `[暗牌]`,用例 `RM-01` / `WEB-12` 盯着)
- 服务端是唯一发牌人:模型无法"多要"信息,也无法绕开合法性校验(非法动作 = 判违规)

## 1. 三步上桌

### ① 先免费验证链路(可选但推荐)

```bash
node examples/mock-llm.ts          # 终端 1:本地 mock,不联网、不花钱
node examples/llm-duel.ts --vs=Sam --hands=3     # 终端 2:确认整条链路通
```

### ② 设三个环境变量

```powershell
# PowerShell
$env:LLM_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
$env:LLM_MODEL    = "glm-4-flash"
$env:LLM_API_KEY  = "你的key"
```

```bash
# Git Bash / macOS / Linux
export LLM_ENDPOINT="..." LLM_MODEL="..." LLM_API_KEY="..."
```

| 服务 | endpoint | 模型示例 | 实测延迟 | 备注 |
| --- | --- | --- | --- | --- |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `glm-4-flash` | 285ms | **免费** |
| 通义 | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | `qwen-flash` | 485ms | 有免费额度 |
| DeepSeek | `https://api.deepseek.com/v1/chat/completions` | `deepseek-flash` | 969ms | 便宜、快 |
| SiliconFlow | `https://api.siliconflow.cn/v1/chat/completions` | 任意 | 1145ms | 有免费小模型 |
| 本地 Ollama | `http://127.0.0.1:11434/v1/chat/completions` | `qwen2.5:1.5b` | — | 完全离线、免费 |
| 自建 | 你说了算 | — | — | 只要 OpenAI 兼容即可 |

> OpenAI / Gemini 在部分网络(如国内校园网)不可达;上面几家实测可达。

### ③ 上桌

```bash
node examples/llm-duel.ts --vs=EQB,ZeroB --hands=6 --log=20
# 常用参数:
#   --vs=a,b,c      对手(内置 10 个角色任选,最多 5 个 → 6 人局)
#   --hands=N       打几局
#   --seed=20260101 固定种子(横比时必须一致)
#   --max-tokens=N  输出预算(思考型模型必须给够,见第 3 节)
#   --json-mode=1   强制 JSON 输出(强烈建议)
#   --fallback=fold|call  违规时的兜底动作
```

输出会给出:积分、**动作分布**、违规次数、**token 用量**,并把对局存进 `data/replays/` 可回放。

## 2. 接口契约:模型要回什么

服务端把局面渲染成一段中文文本,末尾附上**可选动作列表**(带真实牌 id)。模型只需回一个 JSON:

```json
{"reason":"我还没看牌,先看牌","action":"VIEW_HAND"}
{"reason":"换入 HEART-A 可组成两对,只花 1 分","action":"EXCHANGE","takeCardId":"HEART-A","giveCardId":"SPADE-9"}
{"reason":"两对带 K,加注施压","action":"RAISE","toMultiplier":2}
```

- 参数必须照抄动作列表里的 id(服务端会逐一校验,不合法就走兜底)
- `reason` 是可选的,写在日志里方便复盘;多写的字段不会导致违规

## 3. 四个已知的坑(我们全踩过,都已修 + 都有回归用例)

| 坑 | 症状 | 怎么避 |
| --- | --- | --- |
| **推理吃光 token** | `finish_reason=length`、正文为空 → 记 `empty` 违规 | 加 `--max-tokens=2000`(思考型模型给到 8000+),或换非思考型模型 |
| **参数嵌进 action** | `{"action":{"takeCardId":…}}` | 已支持按字段形状反推,但仍建议按契约写 |
| **多回字段就违规** | 回了 `reason` 被判违规 | 已修:只比对动作相关字段 |
| **prompt 自相矛盾** | 模型卡在"该听谁的"上反复纠结 | 已修:system 与 user 指令统一 |

> 如果模型总在"想"却不输出,先看日志里的违规类型:`empty` = 预算不够,`illegal` = 动作名或参数不对。

## 4. 成本与速度(实测,6 人局)

| 模型 | 结果 | 速度 | 违规率 | token/10 手 | 花费 |
| --- | --- | --- | --- | --- | --- |
| GLM-4.7-Flash | −104(5 手) | 1.3s/步 | **0%** | 少 | **免费** |
| deepseek-v4-pro(1.6T) | +131(5 手) | 75.7s/步 | 20% | 101k | 贵 |
| deepseek-flash | +67(10 手) | 7.2s/步 | 23% | 51k | 便宜 |
| mock(本地) | — | 30ms/步 | 0% | 0 | 0 |

> 5~10 手的样本**分数全在噪声里**,但违规率与动作分布是稳定的。想认真比,请打 30 手以上。

## 5. 提交成绩(擂台榜)

1. **打 30 手以上**,用同一个种子(`--seed=20260101`)方便横比
2. 把命令、`--max-tokens` / `--json-mode`、**动作分布**、**违规率**、积分结果贴进 PR
3. 附一份 `data/replays/*.json`(约 25 KB,可精确回放)
4. 在下面加一行 👇

| 模型 | 局数 | 结果 | 违规率 | 速度 | 备注 |
| --- | --- | --- | --- | --- | --- |
| GLM-4.7-Flash | 5 | −104 | 0% | 1.3s/步 | 免费,稳但单调 |
| deepseek-v4-pro | 5 | +131 | 20% | 75.7s/步 | 会算换牌收益 |
| deepseek-flash | 10 | +67 | 23% | 7.2s/步 | 思路好,爱长篇分析 |
| *(等你来填)* | | | | | |

## 6. 想自己写一个非 LLM 的选手?

```ts
// 1) src/ai/mybot.ts
import type { Policy } from "../env.ts";
import { enumerateActions } from "../env.ts";
export const makeMyBot = (): Policy => (state, rng) => {
  const acts = enumerateActions(state);        // 当前全部合法动作(含选哪张牌)
  return acts.find((a) => a.type === "CALL") ?? acts[0];
};
```

在 `src/ai/index.ts` 注册后,CLI、Web 座位下拉、擂台、基准全都会自动出现它。详见 [CONTRIBUTING.md](../CONTRIBUTING.md)。
