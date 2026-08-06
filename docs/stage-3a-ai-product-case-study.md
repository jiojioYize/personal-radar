# Personal Radar Stage 3A：AI 产品案例

最后更新：2026-08-06

## 文档定位

本文只从 AI 产品经理视角记录 Stage 3A：用户问题、产品假设、AI 与
确定性系统的边界、关键取舍、评估方案、阶段证据与复盘。Stage 1、
Stage 2 和 Stage 2.5 仅作为已经完成的产品背景，不在这里追溯其过程。

技术架构、数据模型、失败语义和验收门槛以
[`stage-3-agent-engine.md`](stage-3-agent-engine.md) 为准。本文解释这些
设计为什么是产品决策，并严格区分“计划”“本地验证”“云端影子观察”和
“正式验收”，避免把尚未发生的结果写成成果。

当前状态：Stage 3A 正在隔离的非发布影子分支中实施。尚未启动真实模型
调用、定时云端影子、公开网站更新、PushPlus 推送或生产切换。

## 产品背景

Personal Radar 帮助单个用户持续发现真正可复用、近期仍有效、具备明确
使用路径和信任边界的 AI Agent skills 与 rules。

现有生产流程已经验证了内容质量，但智能生成仍依赖 Codex Automation、
Windows forwarder、本地定时任务和一台持续可用的个人电脑。Stage 3A
不是新增一个推荐品类，而是解决一个产品可持续性问题：

> 能否把已经验证的内容生产方法迁移成可靠的托管 AI 产品，同时不丢失
> 证据、质量和失败边界？

期望用户结果是：每日结果质量至少可以与当前生产基线比较，而内容生成和
故障恢复不再依赖个人电脑。

## 阶段目标与非目标

### 阶段目标

证明一个 single-user、托管、多角色的 AI 内容引擎能够独立完成来源采集、
精确 artifact 验证、质量判断、运行恢复和影子结果生成，并把质量、成本与
风险控制在明确边界内。

### 第一版非目标

- 不更新公开网站，不发送 PushPlus；
- 不在影子证据充分前替换现有生产链路；
- 不增加账号、订阅、计费或多用户个性化；
- 不重新设计公开网站；
- 不以增加每日推荐数量为目标；
- 不引入通用自主智能体框架；
- 不把历史 Quality v2.1 数字评分恢复为当前选品规则。

这一范围把第一轮实验集中在最高风险假设上：托管引擎能否复现已经验证的
内容质量合同。

## 核心产品假设

1. **托管可靠性假设：** durable orchestration 与持久化运行状态可以消除
   对个人电脑的依赖，同时不增加重复执行或部分写入。
2. **角色分工假设：** 独立调用 primary、specialist、adjudicator 和 editor，
   比把所有任务放进一个有上下文记忆的大 prompt 更容易保持 Harness v2
   的质量与可审计性。
3. **确定性护栏假设：** 身份、历史过滤、角色路由、预算、幂等和最终校验
   应由代码负责，让模型只处理真正需要语义理解与判断的部分。
4. **有界发现假设：** 候选补充目标可以控制研究成本，但不应把正常的内容
   稀缺误判成系统失败。
5. **影子验证假设：** 与当前生产结果进行非发布配对观察，可以在切换生产
   前暴露质量、成本和可靠性问题。

这些仍是产品假设；固定样例测试只能证明合同可执行，真实结论需要手动和
定时云端影子数据。

## AI、代码、基础设施与人的职责

| 责任方 | 负责内容 | 产品原因 |
| --- | --- | --- |
| 确定性代码 | 来源计划、候选身份、历史与 review 过滤、来源完成条件、角色路由、分歧检测、Schema、预算、幂等和最终校验 | 这些规则需要可复现、可测试，不能依赖模型临场发挥。 |
| 模型角色 | 理解受限的一手证据、判断能力与可用性、解决限定范围的身份争议、完成定性推荐判断 | 这些任务需要语义理解和综合判断，纯规则难以可靠完成。 |
| Cloudflare Workflows 与 D1 | 持久编排、重试边界、跨运行事实、租约、不可变证据、事故和恢复 | 可靠性是系统属性，不应依赖模型记住之前做过什么。 |
| 人工评审 | 批准模型策略、复核影子结果、判断重大产品变化并授权切换 | 影子通过提供决策证据，但不自动获得发布权限。 |

模型因此是产品系统中受到约束的判断组件，不是调度器，也不是事实来源。

## 关键产品决策

### 1. 先做完全不发布的云端影子

Stage 3A 第一版没有生产 KV、PushPlus token、ingest key 或 forwarder
依赖，现有生产链路持续运行。

产品取舍：模型和编排同时迁移会产生相关性风险。影子运行可以积累真实证据，
同时把用户影响和回滚复杂度降到最低。

### 2. 迁移领域合同，而不是照搬本地运行方式

Stage 3A 保留 Harness v2 角色、定性决策、exact-artifact 历史、reader
contract、失败与 no-update 区分、no-backfill 政策；但不会把现有
Automation prompt 整体托管为一次模型调用。

产品取舍：原 prompt 同时包含已验证的产品规则和本地运行假设。拆开两者，
才能避免把原型实现误当成产品定义。

### 3. 把“来源完成”与“候选产出”分开

来源完成根据采集结果判断：一个 registry、至少两个当日 official 来源、
至少一个 community 来源。不能根据最终候选分别来自哪些 lane 反推来源
是否成功。

产品取舍：来源可以正确完成但没有产生适合的新 artifact。把低产出误判为
基础设施失败，会同时污染质量指标和恢复逻辑。

### 4. 把五个 eligible candidates 定义为补充目标

每次从 8–12 个初始候选开始；少于五个 eligible 时才继续补充；最多三轮、
累计二十个。完整来源采集后若只剩 0–4 个，仍验证并判断全部剩余候选，
记录 `coverageStatus: exhausted_below_target`。

产品取舍：五个控制继续搜索的成本，不是推荐配额，也不是 Stage 3A 的有效性
下限。正常稀缺日不应成为系统失败，但来源/API 失败仍必须 fail-closed。
当前生产继续保留既有五候选下限，除非影子证据支持单独迁移。

### 5. 不混淆候选上限与推荐上限

8–12 和累计二十是研究成本边界。Stage 3A 不继承旧 forwarder 的六项限制，
editor 可以在 v3 Schema 上限内保留所有通过验证的 `recommend`。

产品取舍：若把研究广度、内容质量和展示数量混成一个限制，基础设施约束就会
悄悄改变编辑结果。

### 6. 以 exact artifact 作为推荐和证据单位

同一个 artifact 被多个来源发现只占一个候选位置，但保留所有佐证；同一
repository 内的 sibling skills 仍是不同 artifact。

产品取舍：repository 热度或仓库级去重对于 skill 推荐过于粗糙。artifact
级身份能改善新颖性、可追溯性和纠错能力。

### 7. 用不可变来源状态固定证据

系统先记录 repository tree SHA 与文件 blob SHA，再按 blob SHA 获取正文，
并校验大小、编码、UTF-8、内容哈希和身份后创建 verification case。

产品取舍：如果只跟随默认分支，discovery 和 verification 之间的源文件可能
变化，使模型结论无法重现。不可变证据提高了审计和回归能力。

### 8. 按角色选择模型，而不是全流程只选一个模型

API 方向确定为 OpenAI Responses，首轮待验证策略为：

| 角色 | 初始策略 | 产品理由 |
| --- | --- | --- |
| primary | `gpt-5.6-terra` / low | 每个 eligible artifact 都调用，优先平衡准确率和单位成本。 |
| specialist | `gpt-5.6-terra` / medium | 只处理迁移、身份变化和仓库状态风险，允许增加推理。 |
| adjudicator | `gpt-5.6-sol` / medium | 仅处理实质分歧；错误放行成本高于少量旗舰调用成本。 |
| editor | `gpt-5.6-terra` / medium | 需要证据纪律、双语表达和 reader contract，但不默认支付旗舰溢价。 |

候选提取仍以确定性 collector/parser 为主；Luna 只保留给未来经过评估的
受限元数据修复，不把模型重新引入可以由代码稳定完成的筛选规则。

产品取舍：模型选型是任务风险、调用频率、延迟与成本之间的组合配置，而不是
一次模型榜单选择。全部使用 Sol 会让高频 primary 成本扩大；全部使用 Luna
又会把身份 false positive 风险押在最低成本档。当前策略只是实验基线，不是
验收结论。

### 9. 把“证据未准备好”与“候选不合格”分开

在实现 primary 请求时发现：精确 `SKILL.md` 已持久化，但仓库 archived、
disabled、更新时间和 license 元数据没有进入验证包。系统已补齐这条证据链，
并把超过 64 KiB 的模型输入标记为 `EVIDENCE_REQUIRES_REDUCTION`。

产品取舍：缺字段、输入过大、请求合同错误属于系统准备或恢复问题，不能转写为
`reject`、`defer` 或候选移除。这能防止严格代码护栏制造“正常内容被拒绝”的
假象。

### 10. 在发送前占用幂等调用槽

primary 请求由不可变 evidence、prompt、Schema 和模型策略生成稳定 hash。
D1 对同一 case/role/attempt 只允许一个调用槽，写入前重新计算 hash；Workflow
恢复时可重放同一预留，但不同请求不能覆盖原槽位。

产品取舍：这一步先解决“是否应该发出这次调用”，再解决真实网络发送。它减少
重复扣费与难以解释的多版本证据，也为后续 ambiguous delivery 恢复提供边界。

## 当前待验证的用户旅程

```text
每日影子机会
-> 冻结来源计划和预算
-> 完成所需来源采集
-> 把线索解析成 exact artifacts
-> 构建并过滤候选池
-> 获取不可变的一手证据
-> 独立调用验证角色
-> 由代码协调分歧
-> 产生定性质量决策
-> 校验并渲染影子结果
-> 与现有生产基线比较
-> 人工复核并形成产品结论
```

Stage 3A 第一版中的任何一步都不执行发布。

## 评估框架

### 主要结果指标

每个有效配对影子运行中，经人工认可且身份与信任边界正确的有用推荐数量。

它比“推荐数量”更适合作为结果指标：如果身份、可用性或安全性变差，结果更多
并不代表产品更好。

### 质量护栏

- 已确认的来源身份 false positive 为零；
- 所有 final eligible candidates 都有 primary verification；
- 所有触发条件都得到 specialist/adjudicator 处理；
- 未解决身份进入质量判断的数量为零；
- 系统失败被表达为 `no_update` 的数量为零；
- 影子对网站、生产 KV 或 PushPlus 的写入为零；
- evidence link、Schema、UTF-8 和 reader copy 缺陷为零。

### 产品与运营指标

- 各来源 lane 的 exact-artifact yield 与 eligible rate；
- replenishment 发生率和 below-target coverage rate；
- recommend/defer/reject 分布；
- specialist 触发准确性和 adjudication 解决率；
- 人工对身份与推荐判断的一致率；
- 相比生产基线新增的有用发现；
- 运行完成率、延迟、重试和恢复成功率；
- 各角色 token、搜索调用和估算成本；
- 每个有效运行成本、每个获人工认可推荐的成本。

生产与影子的 exact item overlap 仅是诊断指标：两个系统可能发现不同但同样
有效的 artifact。

## 下一项产品实验：模型策略验证

当前策略已完成 fixture 级请求合同测试，但还没有真实 API 观察证据。在真实
日常影子前，使用固定 Harness v2 cases 比较 role-specific model policies。

### 需要回答的问题

- 哪个 primary 模型/推理策略能以可持续成本达到身份准确性要求？
- specialist 和 adjudicator 使用更强模型带来的准确性提升，是否值得新增
  成本和延迟？
- 较低成本的 editor 能否保持证据纪律、双语实用性和 reader contract？
- 哪些失败只是格式错误、适合一次 repair，哪些是模型能力不足？

### 实验方法

1. 每次比较冻结 prompt、Schema、evidence packet 和 reasoning policy。
2. 回放 current、migrated、invalid、missing、ambiguous、disagreement 和
   below-target 固定样例。
3. 按角色记录 semantic validity、身份正确率、repair rate、延迟、token
   与估算成本。
4. 任何更便宜的策略只要削弱硬质量护栏，就不进入下一阶段。
5. 模型 ID 和 policy hash 作为版本化配置记录，不成为永久产品语义。
6. 固定样例通过后再进行手动云端影子，定时计划仍保持关闭。

证据状态：模型与价格依据为当前官方资料；请求结构、Schema、成本估算和预发送
幂等为 `fixture-tested`；真实模型质量、延迟、token 与实际费用仍为 `planned`，
不能写成 `shadow-observed` 或 `accepted`。

## 主要风险与控制

| 风险 | 产品影响 | 当前控制 |
| --- | --- | --- |
| 模型自信地验证了错误 artifact | 产生误导或不安全推荐 | exact immutable evidence、严格结构输出、确定性身份校验、specialist/adjudicator 路由 |
| 规则拒绝正常稀缺日 | 丢失有用内容并产生错误失败指标 | 五个只是补充目标；有效 below-target 仍继续 |
| 候选不足时放松质量规则 | 为满足数量而降低质量 | 来源和质量门槛不随数量下降 |
| 重试悄悄放大成本 | 运行费用失控 | 角色尝试上限、请求哈希、ambiguous delivery 停止、软硬预算 |
| 影子影响生产 | 用户体验回退 | 独立配置、D1、凭据、route、schedule 和 publication block |
| 模型或 prompt 变化污染比较 | 验收结论失真 | 策略版本化；重大变化后重置配对观察窗口 |
| 来源文本包含 prompt injection | 模型或编排器执行来源指令 | 来源一律视为 untrusted data，不执行，使用角色模板与受限 evidence packet |

## 当前实施证据

以下属于 repository-tested checkpoints，不是 live-cloud acceptance：

| 检查点 | 已证明的产品能力 | Commit |
| --- | --- | --- |
| Shadow run 与 source plan 基础 | 隔离非发布边界、持久 run identity、确定性来源计划 | `codex/stage-3a-shadow` 上的早期 Stage 3A commits |
| Candidate signal 与 GitHub resolution | 以有界恢复把目录/榜单线索转换成可审计 exact artifact | `5a325ba`、`7edf7f9`、`9abf85d`、`d93804b` |
| Global candidate pool | 分离来源覆盖、候选成本、历史过滤和 below-target 有效性，并保存完整轨迹 | `6f14c77` |
| Immutable artifact evidence | 按 blob SHA 获取受限正文，并以事务创建关联 verification case | `8317335` |

截至 2026-08-06，全仓 137 项测试通过，隔离 Stage 3A Wrangler dry-run
通过，execution 与 publication 均关闭。这些结果证明本地合同和构建有效，
尚不能证明模型质量或云端运行可靠性。

## 作品集与面试表达

### 一句话版本

我正在把一个依赖本地自动化的 AI 推荐工作流迁移为托管、可观察的多角色
内容引擎，通过确定性护栏和影子实验同时管理模型质量、成本与生产风险。

### STAR 表达骨架

- **Situation：** 内容质量已经验证，但生成依赖 desktop Automation、
  local forwarder 和个人电脑。
- **Task：** 在不中断线上产品、不降低证据质量的前提下设计托管替代方案。
- **Action：** 分离领域规则与运行时；明确 AI/代码/人的职责；引入持久状态
  与幂等；重定义候选数量语义；固定不可变证据；设计配对影子验收。
- **Evidence so far：** fixture contracts、事务回滚与重放测试、隔离构建检查，
  且现有生产投递保持不变。
- **Next evidence：** role-based model evaluation、手动云端运行、定时配对观察
  和基于数据的 cutover proposal。

### English summary

I am migrating a locally automated AI recommendation workflow into a hosted,
observable multi-role content engine, using deterministic guardrails and
shadow evaluation to manage model quality, cost, and production risk.

## 更新规则

只有 Stage 3A 出现有产品意义的决策、实验、结果或学习时才更新本文；具体实现
细节留在技术文档。每个新结论都必须标记为：

- **planned：** 已批准但尚无执行证据；
- **fixture-tested：** 通过本地确定性或 mock 测试；
- **shadow-observed：** 来自隔离云端影子；
- **accepted：** 通过既定门槛和人工复核。

不要用后来的结果改写历史假设。若证据改变了方向，应保留失败假设和真实取舍。
