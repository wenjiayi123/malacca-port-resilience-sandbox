<p align="center">
  <img src="docs/assets/hero.svg" alt="Malacca Port Resilience Sandbox" width="100%" />
</p>

<p align="center">
  <a href="#港航网络韧性数字孪生沙盘--malacca-port-resilience-sandbox">双语说明 / Bilingual guide</a> ·
  <a href="docs/SHANGHAI_PORT_LANDING.md">上海港接入 / Shanghai landing</a> ·
  <a href="docs/DATASET_CONTRACT.md">数据契约 / Data contract</a> ·
  <a href="docs/RL_ARCHITECTURE.md">算法架构 / RL architecture</a> ·
  <a href="docs/CORE_OPERATIONS_RL_V1.md">十域RL / Core RL v1</a> ·
  <a href="docs/PORT_BUSINESS_RL_V3.md">全业务RL / Business RL v3</a> ·
  <a href="docs/MODEL_CARD.md">模型卡 / Model card</a> ·
  <a href="SECURITY.md">安全策略 / Security</a>
</p>

<p align="center">
  <a href="https://github.com/wenjiayi123/malacca-port-resilience-sandbox/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/wenjiayi123/malacca-port-resilience-sandbox/actions/workflows/ci.yml/badge.svg" /></a>
  <img alt="Node 24" src="https://img.shields.io/badge/Node-24-339933?logo=nodedotjs&logoColor=white" />
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-4c8bf5" />
  <img alt="Status" src="https://img.shields.io/badge/status-research%20benchmark-19b5a5" />
</p>

<p align="center">
  <strong>独立研发者：</strong>温家懿 · <strong>Independent Developer:</strong> Wen Jiayi
</p>

<table>
  <tr>
    <th align="center">长期需求证据<br /><sub>LONG-HORIZON DEMAND</sub></th>
    <th align="center">高频轨迹证据<br /><sub>HIGH-FREQUENCY AIS</sub></th>
    <th align="center">真实训练规模<br /><sub>TRAINING WORKLOAD</sub></th>
    <th align="center">保守压力诊断<br /><sub>CALIBRATED STRESS</sub></th>
    <th align="center">声明门禁<br /><sub>CLAIM GATE</sub></th>
  </tr>
  <tr>
    <td align="center"><strong>4,064,858</strong><br />累计到港艘次 / 377月</td>
    <td align="center"><strong>371,585</strong><br />AIS messages / 1,440 min</td>
    <td align="center"><strong>21,600</strong><br />RL episodes / 3×3 protocol</td>
    <td align="center"><strong>0.344h → 0.110h</strong><br />吞吐保持 99.715%</td>
    <td align="center"><strong>相对百分比禁用</strong><br />small-denominator blocked</td>
  </tr>
</table>

> **业务价值 / Business value：** 面向港航拥堵治理与韧性决策，项目以 MPA
> `Vessel Arrivals (>75 GT) and Shipping Tonnage` 与 Open-Meteo ERA5 构建
> **31 年、377 个月、统计口径累计 4,064,858 艘次**的长期需求证据，以 Zenodo/INFORE
> `10.5281/zenodo.3754481` 完成 **371,585 条原始 AIS 消息、1,440 个分钟窗口**的高频接入验证，
> 并对四种 RL 与三步 MPC 执行 **21,600 episodes** 的时序隔离评测。封存测试会阻止不稳定策略
> 被包装成收益；保守压力诊断只报告延误绝对减少 **14.0 分钟**、拥堵绝对减少
> **0.967 个百分点**及 **99.715% 吞吐保持**。`terminal-operations.v2` 进一步固化
> **37 项港口运行字段**与失败关闭门禁，为授权 TOS/VTS/AIS 数据替换接入真实港口提供边界。

<p align="center">
  <sub><strong>证据边界 / Evidence scope:</strong> 公开聚合数据驱动的离线模型回放；不是“韧性准确率”、VTS/TOS实测KPI或自动生产下发证明。</sub>
</p>

# 港航网络韧性数字孪生沙盘 / Malacca Port Resilience Sandbox

面向港口群、关键航道与船舶流的<strong>证据感知型数字孪生研究栈</strong>。项目把宏观沙盘推演、受控事件
编排、公开数据网关、可替换港口数据契约、五基线控制实验、严格时间留出评估、可恢复检查点与
人工审批闭环放进同一套 React + TypeScript + Node 系统。

An <strong>evidence-aware digital-twin research stack</strong> for port clusters, critical waterways, and vessel flows. It unifies macro network simulation, controlled-event orchestration, public-data gateways, replaceable port-data contracts, five-method control experiments, strict chronological holdout evaluation, recoverable checkpoints, and human approval in one React + TypeScript + Node system.

它不是一张只播放动画的大屏：训练进度来自服务器实际完成的 episode、环境步与参数更新；
训练阶段不渲染策略效果；只有任务完成后，显式评估接口才读取封存测试段并返回可回放 trace。

This is not an animation-only dashboard. Training progress comes from completed server-side episodes, environment steps, and parameter updates. Training does not render policy outcomes; only an explicit post-completion evaluation may read the sealed test segment and return a replayable trace.

> [!IMPORTANT]
> 本项目用于研究、教学和工程验证，不是 VTS/TOS、ECDIS、船舶导航设备或自动生产下发系统。
> 公开统计、模型估算、授权接口、历史回放和合成场景始终分开标识。
>
> This repository supports research, teaching, and engineering verification. It is not a VTS/TOS, ECDIS, navigation device, or autonomous production dispatcher. Public statistics, model estimates, authorized interfaces, historical replay, and synthetic scenarios remain explicitly separated.

<p align="center">
  <img src="docs/assets/sandbox-command-center.jpg" alt="港航态势、事件注入、策略回放与人工控制闭环" width="100%" />
</p>

<p align="center">
  <sub><strong>港航态势与核心闭环：</strong>马六甲港航网络、拥堵传播、事件注入、策略回放与人工控制
  位于同一业务画面；公开统计、情景船舶和授权实时数据使用不同状态标识。<br />
  <strong>Maritime command loop:</strong> network state, congestion propagation, event injection,
  policy replay, and human control share one operational surface with explicit evidence modes.</sub>
</p>

## 可运行实时闭环 / Executable operational loop

当前 `v1.1.0-local-candidate` 在既有四种 RL + MPC 训练证据之外，新增后端权威的连续运行链：

```text
MPA/ERA5/公开AIS参考
→ 固定种子实时模拟器
→ 逐字段质量与血缘
→ 数字孪生状态
→ 训练段校准预测
→ FCFS/SOP/运筹/MPC/可选RL检查点
→ 软件安全投影
→ 双人审批
→ 幂等模拟执行器
→ 设备回执与新状态KPI
→ 异常门禁
→ SHA-256审计回放
```

底部“证据与闭环”页面可逐按钮查看实时遥测、物理守恒、预测模型、五类运行控制候选、数据血缘、
安全治理、小懿运行交班、模型历史、审计链和现场适配器。小懿交班严格读取同一后端快照；未配置或
无法连接真实小懿模型时只显示可审计状态底稿并明确降级，不把规则文本冒充模型回答。默认每 5 秒推进一个 15 分钟业务步；同一 seed 和 tick
可复现。数据失联或模拟器停止时，推荐与执行均失败关闭。完整数据卡、工程假设和现场替换边界见
[`OPERATIONAL_SIMULATOR_DATA_CARD.md`](docs/OPERATIONAL_SIMULATOR_DATA_CARD.md)，逐按钮验收见
[`TESTING.md`](docs/TESTING.md)。

The `v1.1.0-local-candidate` adds a backend-owned, continuously changing operational loop while preserving
all historical RL artifacts. It is a public-data-calibrated real-time simulation with real model inference,
constraint projection, dual approval, idempotent simulated execution, receipts, rollback, and a verified
hash chain. It is not a live-port or production-control claim.

```text
simulation_mode=true · live_data_verified=false · dispatch_allowed=false · production_authority=false
```

### 顶级系统对标补齐 / Production-hardening gates

在不改写原有算法、检查点、基准、回放、失败实验和仿真闭环的前提下，工程层新增八个可独立验证的生产前置门禁。每个门禁都分开“软件已实现”与“现场外部证据已取得”：

| 领域 | 已补齐的软件能力 | 默认仍关闭的现场门禁 |
|---|---|---|
| 真实港口数据 | 六源清单、HMAC/SHA-256、字段/单位/时效/顺序/重放检查、37 字段原子影子快照 | 运营方授权、六个实时源、独立计量验收 |
| 港口社区互操作 | 签名消息、会话/关联/幂等、权威放行角色、DCSA/IALA/IMO 投影边界 | 交易方证书、官方一致性、Maritime Single Window/港口社区系统连接 |
| 船舶交通安全 | AIS/雷达/船舶交通服务/光电融合、源冲突、DCPA/TCPA、稀少信息失败关闭 | 雷达标定、航道几何、船舶交通服务值班与告警验收 |
| 身份与运行技术安全 | Ed25519 身份绑定审批、多因素认证、职责分离、独立急停/通信/旁路联锁 | 身份提供方、安全联锁设备和经验收的物理执行适配器 |
| 孪生忠实度 | 潮位/富余水深/下沉量、泊位互斥、岸桥事件、堆场守恒、能碳积分 | 水深/潮位/实船/设备实测标定、硬件在环和运营方模型验收 |
| 算法保证 | 锁定最终测试、置信下界、离线策略评估、分布偏移、奖励投机、安全盾/急停/回退 | 授权影子运行、运营方验收、生产金丝雀 |
| 24×7 可靠性 | 原子状态、上一代恢复、哈希日志、并发代数、fencing token、RPO/RTO/SLO 门禁 | 多副本/多故障域、隔离恢复演练、30 天可用性实测 |
| 现场验收 | 30 天基线 + 720 小时影子、五类独立 KPI、FAT/SAT/UAT/灾备/网络安全/安全、五方签字 | 实际 KPI 抽取、见证测试、培训/值班/演练与运营方签字 |

第一版统一证据保持不变；纳入十域强化学习冠军与配对反事实运行验收的追加证据见 [`top-tier-hardening-evidence-v2.md`](reports/top-tier-hardening-evidence-v2.md)。分领域合同、限制和验证命令从 [`REAL_PORT_DATA_INTEGRATION.md`](docs/REAL_PORT_DATA_INTEGRATION.md) 开始。在现场证据未提供前，项目仍是可复现研究/工程验证系统，不是真实港口生产系统。

### 全核心业务强化学习闭环 v1 / Core-operations RL v1

`core-operations-rl.v1` 是当前主强化学习运行链，原有算法、检查点、报告和失败实验全部保留。它使用同一个 47 维权威快照张量，同时输出十个独立且可安全回退的动作头：到港节奏、泊位岸桥、堆场闸口、水平运输、航道引拖、岸电储能、冷藏箱与楼宇柔性负荷、设备维护、海铁水水联运、扰动恢复。十个动作头共有 30 个有界选项；主管机关放行、避碰、紧急停止、身份审批和物理下发继续由外部权威与确定性联锁掌控，不交给强化学习。

正式训练比较因子化线性 Q 与因子化线性 Dyna-Q、两组超参数、五个随机种子和 180/360 两级课程。验证集选出的 `factorized-linear-dyna-q / curriculum-360` 通过未参与调参的时序封存测试：综合奖励改善百分之九十五置信下界 0.02377，平均等待减少下界 0.081238 小时，能源成本指数降低下界 0.600716%，峰值负载降低下界 1.326549 个百分点，碳强度降低下界 1.684997%，维护积压降低下界 0.058512，恢复积压降低下界 34.830831 个工程船舶当量；最低吞吐保持率 98.827313%，最低冷藏箱服务保持率 99.6%，十个动作域均实际参与，安全替换率和硬约束违规均为 0。

当前后端可从同一模拟器快照生成十域联合计划，经逐域低一致性弃权、确定性安全投影和两个本地测试角色模拟审批后，真实改变独立沙盘状态并返回幂等执行回执、回滚结果和审计哈希。运行回执还从同一状态、同一随机种子、同一时刻分别推进“继续当前计划”和“执行新强化学习计划”，单列可归因于新计划的沙盘差值；运行控制服务也会自动把准入的联合策略映射为强化学习候选。完整训练候选、五个冠军策略、源文件指纹和价值边界见 [`core-operations-rl-champion-v1.md`](reports/core-operations-rl-champion-v1.md)，设计与接口见 [`CORE_OPERATIONS_RL_V1.md`](docs/CORE_OPERATIONS_RL_V1.md)。这些差值是同记录、同扰动下相对保守标准作业程序的公开数据锚定工程仿真结果，不是马六甲现场关键绩效指标或财务节省。

<p align="center">
  <img src="docs/assets/core-operations-rl-business-value.svg" alt="47维状态、十个强化学习动作头、安全弃权、双岗审批和配对反事实业务价值证据" width="100%" />
</p>

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/assets/core-operations-rl-value-projection.png" alt="十域强化学习联合计划与业务价值投影实机截图" width="100%" />
      <br /><sub><strong>选择性参与：</strong>每个动作头独立给出置信度；低一致性域保持原计划，不为追求“全动作”牺牲安全。</sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/assets/core-operations-rl-counterfactual-receipt.png" alt="十域强化学习执行与配对反事实回执实机截图" width="100%" />
      <br /><sub><strong>可归因回执：</strong>同状态、同随机种子、同一时刻比较新计划与继续当前计划，并保留审批、回滚和审计入口。</sub>
    </td>
  </tr>
</table>

> **本次实机闭环 / Runtime receipt：** 在公开数据校准的 `channel-congestion` 沙盘状态中，冠军策略只让 3/10 个高置信动作域参与，其余域保持计划；配对回执记录排队船舶 −0.57、平均延误 −3 分钟、区间能耗 −126.75 kWh、峰值负荷 −23.4、区间成本 −43.09、区间碳排 −0.074 t、服务履约 +0.9。该回执证明强化学习计划在独立沙盘执行器中改变了业务状态，**不等同于现场因果收益**；生产权威仍关闭。

### 港口全业务强化学习 v3 / Port-business RL v3

保留的 `port-business-rl.v3` 单动作证据链，在完全保留原四种强化学习、模型预测控制、检查点和监管韧性模型的基础上，将泊位—岸桥、堆场—闸口、航道潮窗与引拖、岸电能碳、海铁水水联运、邻港协同、扰动恢复和服务公平性纳入同一可训练闭环。策略实际读取 33 维观测、选择 11 个有界建议动作，并使用 10 项奖励分量；航道、潮窗、危险品、资源容量和一周期冷却由确定性动作屏蔽器控制。它继续作为历史对照，不再是覆盖所有核心功能的主运行策略。

公开数据锚点仍是新加坡海事及港务管理局月度到港/总吨位与 ERA5 风场。缺失的泊位、岸桥、堆场、闸口、引拖、岸电和转运字段均逐字段标为 `engineering-derived`，不会冒充马六甲现场测量。生成的 1,508 条时间记录按 70% / 15% / 15% 时序隔离；四种线性时序差分算法、两组超参数、五个随机种子和 260/520 两级课程均执行真实参数更新。

验证选择的 `linear-dyna-q / curriculum-520` 通过封存测试：奖励改善 95% 下界 0.0489，有实质延误场景队列降低下界 1.93 艘，碳强度降低下界 0.139%，公平性差距降低下界 0.165 个百分点，最低吞吐保持率 99.754%，硬约束违规为 0。完整候选、冠军权重、数据指纹和生产禁用边界见 [`port-business-rl-champion-v3.md`](reports/port-business-rl-champion-v3.md)；设计、替换 Schema、非强化学习职责和运行接口见 [`PORT_BUSINESS_RL_V3.md`](docs/PORT_BUSINESS_RL_V3.md)。上述结果是公开数据锚定的离线仿真价值，不是现场 KPI。

### 海事/海关检查延误韧性 / Regulatory-delay resilience

系统现将海事检查、海关单证/查验等待、官方放行和放行后积压恢复建成连续状态链。主管机关的选查、
结论与放行始终是外生信号；策略只能优化检查准备度和放行后的恢复资源，不获得监管或生产控制权。
原五类运行动作及历史训练证据保持不变，另增 12 维观测、9 种补充动作和独立 Q-learning 训练层。

预声明压力场景的 v1 候选因能耗、碳排和安全退化被阻断并保留；v2 经优势投影后，在 57 条冻结测试
记录上实现 7.4679% 场景成本降低、15.8095% 能耗降低和 15.8119% 碳排降低，同时监管延误、恢复
服务和安全不退化。结果属于离线场景证据，不是现场 KPI。详见
[`REGULATORY_RESILIENCE.md`](docs/REGULATORY_RESILIENCE.md)及
[`regulatory-resilience-v2.md`](reports/regulatory-resilience-v2.md)。

## 为什么这个项目值得关注 / Why this project matters

- <strong>从态势到证据闭环</strong>：港口、航道、船舶、拥堵、延误、碳排与韧性状态共同进入事件推演，
  结果保留数据模式、时间、算法、检查点和人工确认信息。<br>
  *Ports, channels, vessels, congestion, delay, carbon, and resilience enter one event simulation, whose result retains data mode, time, algorithm, checkpoint, and human confirmation.*
- <strong>可审计的五基线实验</strong>：Q-Learning、SARSA、Expected SARSA、Dyna-Q 与 MPC 共享状态、动作、
  奖励、训练段和评估段；MPC 被明确标为控制理论基线，不伪装成 RL。<br>
  *Q-Learning, SARSA, Expected SARSA, Dyna-Q, and MPC share state, action, reward, training, and evaluation contracts; MPC is identified as control theory, not disguised as RL.*
- <strong>防止未来信息泄漏</strong>：默认 377 条 MPA 月度记录与 ERA5 风场按时间 70%/15%/15% 切分；容量代理只用训练段
  校准，验证前段调超参数、后段选算法，最终测试段保持封存。<br>
  *The 377 MPA monthly records and ERA5 forcing use a 70/15/15 temporal split. Capacity proxies fit on train only; the first validation segment tunes and the second selects; final test remains sealed.*
- <strong>训练与展示解耦</strong>：训练过程为 headless；测试完成后才由真实留出轨迹驱动地图回放。<br>
  *Training is headless; only completed holdout traces drive map replay.*
- <strong>受控的小懿联动</strong>：白名单界面执行器与 RL 参数顾问是两个独立层；自动步骤完成后生成执行
  报告，最终由人工确认或归档异常。<br>
  *The allowlisted Xiaoyi UI executor and RL advisor are separate layers. Automation produces an execution report, followed by human confirmation or exception archiving.*
- <strong>可替换港口而非写死港口</strong>：CSV/JSON 字段合同、港口选择、单位和质量规则独立于算法实现。<br>
  *CSV/JSON contracts, port selection, units, and quality rules are independent of algorithm code.*
- <strong>面向发布的工程边界</strong>：只读静态服务、Bearer 门禁、强 Token 校验、请求上限、限流、探针、
  结构化日志、SHA-256 检查点、容器非 root 运行与固定 SHA 的供应链工作流。<br>
  *Read-only static delivery, Bearer gates, strong-token checks, request bounds, rate limits, probes, structured logs, SHA-256 checkpoints, non-root containers, and SHA-pinned supply-chain workflows.*

## 固定韧性基准 / Pinned resilience benchmark

| 协议项 / Protocol | 固定设置 / Pinned setting |
|---|---|
| 数据 / Data | MPA月度到港统计 + ERA5风场，共377条，1995-01至2026-05<br><sub>377 MPA monthly-arrival + ERA5 forcing records, 1995-01 to 2026-05</sub> |
| 时间隔离 / Temporal isolation | 263 train / 57 validation / 57 sealed test，不随机打乱<br><sub>No randomized order</sub> |
| RL调参 / RL tuning | 每候选600 episodes、3组超参数、3个随机种子<br><sub>600 episodes per candidate, three parameter sets, three seeds</sub> |
| 方法 / Methods | Q-Learning、SARSA、Expected SARSA、Dyna-Q、三步MPC |
| 选型规则 / Selection | 验证前段调参、验证后段选型，最终测试不参与选择<br><sub>Tune on early validation, select on late validation; final test never selects</sub> |
| 保守动作上限 / Action envelope | 单步错峰≤2%、分流≤1%、短时能力增益≤2%<br><sub>Defer ≤2%, divert ≤1%, temporary capacity uplift ≤2%</sub> |
| 稳健性 / Robustness | 3个随机种子用于RL；确定性MPC改用3个连续封存时间块验证<br><sub>Three RL seeds; three chronological blocks for deterministic MPC</sub> |
| 声明门禁 / Claim gate | 绝对压力诊断8/8通过；相对下降百分比因小分母被禁止<br><sub>Absolute diagnostic 8/8; relative reduction claim blocked</sub> |

常态封存回放没有形成可测的基线延误或拥堵，MPC 在 96.49% 时段保持原计划，因此系统不制造
“常态收益”。在明确标注的温和压力诊断（到港 +5%、临时能力 −2%）中，三步 MPC 将代理延误从
0.344h 降至 0.110h、有效拥堵压力从 1.435% 降至 0.468%，同时保持 99.715% 吞吐、3.734%
逐步期望安全风险和 21.053% 非保持动作率。由于基线负担很小，相对变化会被放大到约 68%，
声明门禁明确禁止引用该百分比。完整五方法结果、绝对前后值、三时间块诊断和源码指纹见
[保守校准 v2 报告](reports/rl-benchmark-balanced-resilience-calibrated-v2.md)；原
[66% 报告](reports/rl-benchmark-balanced-resilience.md)仅作为校准前历史对照保留。

<p align="center">
  <img src="docs/assets/rl-training-complete-evidence.jpg" alt="真实训练完成后的服务器遥测、时间切分与检查点画面" width="100%" />
</p>

<p align="center">
  <sub><strong>真实任务完成态：</strong>服务器任务返回 7,200 episodes、173,348 环境步、
  389,032 次参数更新、263/57/57 时间切分和 <code>checkpoint.json</code>；训练阶段不渲染策略效果，
  最终测试仍需显式启动。<br />
  <strong>Completed backend job:</strong> the server reports episodes, environment steps, updates,
  temporal isolation, and a checkpoint artifact; sealed-test replay remains explicit.</sub>
</p>

The normal sealed replay has no measurable baseline burden, so MPC holds plan for 96.49% of steps and
no normal-operation benefit is claimed. Under the explicitly bounded +5% arrival / −2% capacity stress
diagnostic, MPC changes proxy delay from 0.344h to 0.110h and effective congestion pressure from 1.435%
to 0.468%, with 99.715% throughput retention, 3.734% expected stepwise safety risk, and a 21.053%
non-hold action rate. The resulting relative percentage is blocked because the baseline denominator is
too small. See the [calibrated v2 evidence](reports/rl-benchmark-balanced-resilience-calibrated-v2.md);
the [legacy 66% report](reports/rl-benchmark-balanced-resilience.md) remains available only for audit.

## 上海港落地合同与大数据外部验证 / Shanghai landing and scale validation

马六甲海峡始终是仓库的默认主场景、产品叙事和启动配置；上海只作为显式启用的可迁移接入样例，
不会改变项目主体。

项目新增 `terminal-operations.v2` 严格清单，覆盖港区/码头、泊位、堆场、岸桥、闸口、海铁与
水水中转、ETA、航道潮窗、引拖、气象海况、安全危险品、岸电燃料与跨港转移。上海场景可用
`VITE_PORT_SCENE_PROFILE=shanghai-international-port` 启动；未配置授权同源快照时保持失败关闭，
不会用新加坡公开遥测填充上海画面。完整字段映射、官方事实来源和接入步骤见
[上海港落地手册](docs/SHANGHAI_PORT_LANDING.md)。

The `terminal-operations.v2` manifest covers terminals, berths, yards, quay cranes, gates, rail/water
transfers, ETA, navigation/tidal windows, pilots, tugs, metocean conditions, safety/hazmat controls,
shore power, fuels, and inter-port transfer evidence. The Shanghai scene starts fail-closed until an
authorized same-origin snapshot and data manifest are configured. Malacca remains the default product
scene; Shanghai is an opt-in portability example only.

第二个公开基准处理了 **371,585 条** Piraeus 原始 AIS 消息，形成 **1,440 条**分钟级记录，并用
相同的 Q-Learning、SARSA、Expected SARSA、Dyna-Q 与 MPC 做三随机种子时间留出比较。该数据只
覆盖 24 小时且没有实测泊位能力、GT、天气、安全和动作结果，因此作为高频接入/训练规模证据，
不替代 31 年 MPA 官方月报主证据，也不支持上海现场收益声明。来源、许可、负向结果和选择结论
保存在[公开数据可信度比较](reports/public-dataset-credibility-comparison.md)。

The second public benchmark processes **371,585 raw Piraeus AIS messages** into **1,440 minute-level
records** and runs the same five methods with three seeds and chronological holdout. Its 24-hour
coverage makes it scale evidence, not a Shanghai field KPI or a replacement for the long-horizon MPA
benchmark.

## 工程证据索引 / Engineering evidence index

| 画面 / Surface | 可见工程能力 / Visible engineering capability | 证据锚点 / Evidence anchor |
|---|---|---|
| 多层 UI + 小懿联动 | 沙盘、训练矩阵、参数顾问、白名单动作执行器 | [`XiaoyiSystemAssistant.tsx`](src/components/XiaoyiSystemAssistant.tsx)、[`xiaoyiRlAdvisorAdapter.ts`](src/integrations/xiaoyiRlAdvisorAdapter.ts) |
| 训练完成遥测 | episode、环境步、更新数、时间切分、Checkpoint | [`rlTrainingJobs.ts`](server/rlTrainingJobs.ts)、[`rlTrainingEngine.ts`](server/rlTrainingEngine.ts) |
| 核心闭环与人工门禁 | 事件传播、策略回放、执行报告、最终人工确认 | [`public_evidence_rl_operation.md`](docs/public_evidence_rl_operation.md)、[`MODEL_CARD.md`](docs/MODEL_CARD.md) |

## 架构 / Architecture

```mermaid
flowchart TB
  subgraph Evidence["证据与数据层 / Evidence and data"]
    direction LR
    MPA["MPA月度公开统计<br/>monthly statistics"]
    WX["Open-Meteo气象海况<br/>metocean"]
    AUTH["授权AIS/TOS/VTS<br/>authorized adapters"]
    CONTRACT["CSV/JSON<br/>port-call-event.v1"]
  end
  subgraph Core["推演与控制核心 / Simulation and control"]
    direction LR
    STATE["港航网络状态<br/>network state"]
    EVENT["事件注入与传播<br/>event propagation"]
    JOB["异步无渲染训练<br/>headless training"]
    BASE["4 RL + 1 MPC"]
    HOLDOUT["验证选优与封存测试<br/>validation + sealed test"]
    CKPT["SHA-256检查点<br/>checkpoint"]
  end
  subgraph Governance["交互与治理 / Interaction and governance"]
    direction LR
    XADV["小懿RL顾问<br/>RL advisor"]
    XEXEC["小懿白名单执行器<br/>allowlisted executor"]
    UI["React数字孪生沙盘<br/>digital-twin UI"]
    REPLAY["封存测试轨迹回放<br/>sealed-test replay"]
    REVIEW["执行报告与人工确认<br/>report + human review"]
  end
  MPA --> STATE
  WX --> STATE
  AUTH --> CONTRACT --> STATE
  STATE --> EVENT --> JOB --> BASE --> HOLDOUT --> CKPT
  STATE --> UI
  CKPT --> REPLAY --> UI
  XADV --> JOB
  XEXEC --> UI --> REVIEW
```

<p align="center">
  <img src="docs/assets/xiaoyi-multi-ui-linkage.jpg" alt="马六甲沙盘完整界面、训练中心、小懿训练顾问与系统联动助手同屏" width="100%" />
</p>

<p align="center">
  <sub><strong>小懿多层 UI 联动完整截图：</strong>主沙盘、五方法训练矩阵、小懿 RL 参数顾问与白名单页面执行器
  同屏工作；原版小懿形象保持不变，训练结论仍以服务器任务、检查点和版本化报告为准。<br />
  <strong>Xiaoyi multi-surface linkage:</strong> the sandbox, five-method matrix, RL advisor, and
  allowlisted executor operate together while evidence remains anchored to backend artifacts.</sub>
</p>

## 五种统一基线 / Five comparable methods

| 方法 / Method | 分类 / Class | 仓库内实际行为 / Actual behavior | 可审计遥测 / Auditable telemetry |
|---|---|---|---|
| Q-Learning | RL | 离策略 Bellman 最优价值更新<br><sub>Off-policy Bellman optimal-value update</sub> | episode、环境步、参数更新、Q表<br><sub>episodes, steps, updates, Q table</sub> |
| SARSA | RL | 在策略下一动作价值更新<br><sub>On-policy next-action value update</sub> | episode、环境步、参数更新、Q表<br><sub>episodes, steps, updates, Q table</sub> |
| Expected SARSA | RL | 探索策略下的期望价值更新<br><sub>Expected value under the exploration policy</sub> | episode、环境步、参数更新、Q表<br><sub>episodes, steps, updates, Q table</sub> |
| Dyna-Q | RL | 真实交互更新与已学习转移模型规划回放<br><sub>Real interaction plus learned-model planning replay</sub> | 环境步、真实更新、规划更新、Q表<br><sub>steps, real/planning updates, Q table</sub> |
| MPC | 控制理论 / control theory | 训练段需求模型辨识与三步滚动时域枚举<br><sub>Train-only demand identification and three-step receding-horizon enumeration</sub> | 辨识误差、模型参数、控制动作<br><sub>identification error, model parameters, controls</sub> |

任务会运行/辨识全部五种方法。每种 RL 默认在验证前段比较 3 组超参数，验证后段选出的候选策略成为默认测试策略，但界面允许操作员在相同
最终测试段上切换其余方法进行可比评估。仓库不声称已实现 PPO、SAC、MAPPO 或深度神经策略。

Each job trains or identifies all five methods. Every RL method compares three hyperparameter sets on early validation; the candidate selected on late validation becomes the default test policy, while the UI can evaluate other methods on the same final segment. The repository does not claim PPO, SAC, MAPPO, or a deep-neural policy.

奖励函数同时约束延误、拥堵、碳指数、安全、韧性和吞吐服务率。错峰需求进入递延积压并在后续
时段释放，分流、扩容和递延均有干预成本，避免通过“丢掉需求”制造接近 100% 的虚高改善。

The objective jointly constrains delay, congestion, carbon index, safety, resilience, and throughput service. Shifted demand becomes deferred backlog released in later periods; diversion, capacity expansion, and deferral all carry intervention cost, preventing near-100% “improvement” by silently dropping demand.

## 数据证据与替换合同 / Data evidence and replacement contract

默认离线快照包含新加坡海事及港务管理局发布的 <strong>Vessel Arrivals (>75 GT), Monthly</strong> 数据：

- 377 条 MPA 月度记录按月对齐 ERA5 海面网格高风暴露特征，时间范围 `1995-01` 至 `2026-05`；<br>
  *377 MPA monthly records aligned to ERA5 sea-grid high-wind exposure, from `1995-01` to `2026-05`.*
- 公开来源与提取信息记录在 [`data/rl/README.md`](data/rl/README.md)；<br>
  *Public provenance and extraction details are recorded in [`data/rl/README.md`](data/rl/README.md).*
- 适用于时序切分、数据适配、算法复现和接口验证；<br>
  *Suitable for temporal splits, adapter tests, algorithm reproduction, and interface verification.*
- 不足以证明泊位级、分钟级或实时调度效果。<br>
  *Insufficient to establish berth-level, minute-level, or real-time dispatch performance.*

运行时可读取 MPA/data.gov.sg 与 Open-Meteo；未配置授权 AIS 接口时，地图船位会明确标为场景代表
船，不冒充实时 AIS。替换其他港口数据只需设置：

At runtime, the system can read MPA/data.gov.sg and Open-Meteo. Without an authorized AIS interface, map vessels are explicitly labelled scenario representatives rather than live AIS. To replace the port dataset, set:

```bash
PORT_TRAINING_DATASET_PATH=/absolute/path/to/port_training.csv
PORT_TRAINING_PORT_ID=SGSIN
```

中央地图同时提供“可复现实况模拟”和“卫星实时定位”。后者使用 MapTiler Satellite 瓦片与
服务端 AISStream 区域订阅；只有瓦片成功加载、WebSocket 已连接且存在五分钟内新鲜船位时才标记
为实时。缺少 MapTiler 凭据时会显示带署名的 EOX Sentinel-2 cloudless 2025 合成影像，并用
Mapterhorn DEM 生成三维地貌、用 OpenFreeMap 保留地名道路；界面明确标注影像是 2025 合成层而
非实时拍摄。默认使用清晰真彩色、无雾化显示，并以 1.5 倍高程增强地貌辨识度。EOX 公共影像只
用于非商业演示，商业部署需使用有相应许可的影像源。缺少 AIS 凭据时严格显示零个真实船位，不拿
模拟船位冒充实时目标。
配置、密钥隔离、署名与验收步骤见
[`docs/LIVE_SATELLITE_MAP.md`](docs/LIVE_SATELLITE_MAP.md)。

The central display has reproducible-simulation and satellite-live modes. Satellite-live combines MapTiler
Satellite tiles with a server-side AISStream regional subscription and is labelled live only when the tiles load,
the stream is connected, and fresh positions exist within five minutes. Without MapTiler credentials, an
an attributed EOX Sentinel-2 2025 composite remains visible on Mapterhorn 3D terrain, while the UI explicitly
separates imagery time from live AIS status. The public EOX fallback is for non-commercial demos. See
[`docs/LIVE_SATELLITE_MAP.md`](docs/LIVE_SATELLITE_MAP.md) for setup and truth gates.

字段、单位、时区、缺失值和多港口选择规则见 [`docs/DATASET_CONTRACT.md`](docs/DATASET_CONTRACT.md)。<br>
See [`docs/DATASET_CONTRACT.md`](docs/DATASET_CONTRACT.md) for fields, units, time zones, missing values, and multi-port selection.

## 快速开始 / Quick start

要求 Node.js 24+。一键脚本会依次使用已安装的 pnpm、Corepack 或 npx，因此不要求全局安装
pnpm；缺少 `node_modules` 时会按锁文件自动安装依赖并打开浏览器。<br>
Requires Node.js 24+. The launcher uses an installed pnpm, Corepack, or npx in that order, so a global
pnpm installation is not required. It installs locked dependencies when needed and opens the browser.

```bash
bash scripts/demo/start_web_demo.sh
```

用于完整复现发布校验的命令：<br>
For a complete release-gate reproduction:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm release:check
```

一键脚本默认打开 <http://127.0.0.1:5174>。先进入“证据与闭环”验收实时模拟、预测、审批、执行、回执与审计；
如需 RL 检查点推理，再进入“沙盘推演”→“训练中心”，完成训练后显式运行封存测试。<br>
The launcher opens <http://127.0.0.1:5174>. Start with **Evidence & Loop** to verify telemetry, forecasting,
approval, execution, receipts, and audit. For RL checkpoint inference, complete training first and then
explicitly run sealed-test evaluation.

生产式本机运行使用独立 Node 服务：<br>
For a production-shaped local runtime, use the standalone Node service:

```bash
pnpm build
pnpm start
```

监听非回环地址时，系统会失败关闭，除非 `PORT_API_TOKEN` 是不少于 32 个字符的非占位随机密钥。<br>
Remote binding fails closed unless `PORT_API_TOKEN` is a non-placeholder random secret of at least 32 characters.

```bash
docker build -t malacca-port-sandbox .
export PORT_API_TOKEN="$(openssl rand -hex 32)"
docker run --rm -p 4173:4173 \
  -e PORT_API_TOKEN \
  -v malacca-rl:/app/runtime \
  malacca-port-sandbox
```

## API 面 / API surface

```text
GET    /healthz
GET    /readyz
GET    /api/openapi.json
GET    /api/public-data/snapshot
GET    /api/operations/contracts/telemetry
GET    /api/operations/snapshot
GET    /api/operations/recommendations
GET    /api/operations/handoff
GET    /api/operations/models
GET    /api/operations/decisions
POST   /api/operations/decisions
POST   /api/operations/decisions/:decisionId/approve
POST   /api/operations/decisions/:decisionId/execute
POST   /api/operations/decisions/:decisionId/rollback
POST   /api/operations/scenarios
POST   /api/operations/simulator/control
GET    /api/operations/audit
GET    /api/rl/datasets
GET    /api/rl/contracts/terminal-operations
GET    /api/rl/jobs
POST   /api/rl/jobs
GET    /api/rl/jobs/:jobId
DELETE /api/rl/jobs/:jobId
GET    /api/rl/jobs/:jobId/checkpoint
POST   /api/rl/jobs/:jobId/evaluate
POST   /api/rl/inference
POST   /api/port-calls/validate
POST   /api/xiaoyi/rl-advisor
```

OpenAPI 是接口发现入口；更严格的数据合同与互操作边界分别记录在
[`DATASET_CONTRACT.md`](docs/DATASET_CONTRACT.md) 和
[`PORT_CALL_INTEROPERABILITY.md`](docs/PORT_CALL_INTEROPERABILITY.md)。字段对齐不代表 DCSA、
IALA 或 IMO 合规认证。

OpenAPI is the interface-discovery entry. Stricter data and interoperability boundaries are documented in [`DATASET_CONTRACT.md`](docs/DATASET_CONTRACT.md) and [`PORT_CALL_INTEROPERABILITY.md`](docs/PORT_CALL_INTEROPERABILITY.md). Field alignment is not DCSA, IALA, or IMO compliance certification.

## 复现与安全 / Reproduction and security

```bash
pnpm lint          # ESLint + TypeScript规则 / rules
pnpm test          # 数据隔离、更新、恢复与安全 / isolation, updates, recovery, safety
pnpm benchmark:rl  # 3种子离线回放 / three-seed offline replay
pnpm benchmark:rl:verify # 数据/代码哈希与全算法指标 / hashes and full-method metrics
pnpm data:sync:infore-ais # 下载并校验公开AIS包 / fetch and verify public AIS package
pnpm benchmark:public-data # 公开大数据五方法比较 / large-public-data five-method comparison
pnpm benchmark:public-data:verify # 校验数据来源、许可与结果 / verify provenance and results
pnpm acceptance:operations # 生成闭环测试报告 / generate the workflow test report
pnpm acceptance:operations:verify # 校验报告与源码哈希 / verify the report and source hashes
pnpm build         # 严格类型检查与生产构建 / strict types and production build
pnpm security:audit # 中高危依赖漏洞门禁 / dependency vulnerability gate
```

版本标签工作流会构建静态应用、生成 SPDX SBOM 和安装包；GitHub Actions 同时运行 provenance
attestation、CodeQL 与 OSSF Scorecard。安全说明见 [`SECURITY.md`](SECURITY.md)，模型限制见
[`docs/MODEL_CARD.md`](docs/MODEL_CARD.md)。

Version-tag workflows build the static application, SPDX SBOM, and distribution bundle. GitHub Actions also run provenance attestation, CodeQL, and OSSF Scorecard. See [`SECURITY.md`](SECURITY.md) for security information and [`docs/MODEL_CARD.md`](docs/MODEL_CARD.md) for model limitations.

<p align="center">
  <img src="docs/assets/human-review-gate.jpg" alt="小懿执行报告、异常归档与最终人工确认门禁" width="100%" />
</p>

<p align="center">
  <sub><strong>执行报告与人工门禁：</strong>小懿完成白名单步骤后生成可复核报告，异常可归档，
  最终策略应用仍由人工确认，不将界面联动等同于无人值守生产控制。<br />
  <strong>Human-governed execution:</strong> allowlisted steps produce a reviewable report;
  exceptions are archived and final application remains human-confirmed.</sub>
</p>

## 明确不包含 / Explicit exclusions

- 未提供港口生产账号、实时 AIS/TOS/VTS 数据或控制权限；<br>
  *No production port accounts, live AIS/TOS/VTS data, or control authority.*
- 仓库提供授权实时 AIS 接入代码，但不包含第三方账户或密钥；卫星实时模式需要使用者自行配置
  MapTiler 与 AISStream 凭据；<br>
  *The repository includes the authorized live-AIS adapter but no third-party account or secret; satellite-live
  mode requires operator-supplied MapTiler and AISStream credentials.*
- 未提供安全认证、调度 SLA、海上避碰认证或无人值守决策；<br>
  *No safety certification, dispatch SLA, collision-avoidance certification, or unattended decision authority.*
- 碳排、拥堵、延误和韧性指标包含模型估算，不等同于现场实测标签；<br>
  *Carbon, congestion, delay, and resilience include model estimates, not measured site labels.*
- `reports/` 会透明保存全部五种方法的留出结果及核心代码指纹，不能只挑单次最好结果冒充结论；<br>
  *`reports/` retains all five methods’ holdout results and core-code fingerprints; one best run cannot stand in for the conclusion.*
- Godot Web 二进制因体积与独立资产许可不进入源码仓库，仅保留接口与重建说明；<br>
  *Godot Web binaries are excluded because of size and separate asset licensing; contracts and rebuild instructions remain.*
- 外部小懿服务不可用时使用确定性规则顾问，并在界面明确显示，不伪装成大模型在线结果。<br>
  *When external Xiaoyi is unavailable, the UI explicitly identifies the deterministic rule advisor rather than presenting it as an online LLM.*

## 项目结构 / Repository map

```text
src/                         React沙盘、状态机、小懿与回放 / sandbox, state, Xiaoyi, replay
server/                      数据网关、训练、检查点与服务 / gateway, jobs, checkpoints, server
shared/                      遥测、运行、目标函数稳定合同 / stable telemetry and control contracts
data/rl/                     MPA月度公开快照 / reproducible monthly public snapshot
tests/                       算法、隔离、恢复、合同与安全 / algorithms, isolation, recovery, contracts
reports/                     带证据等级的RL报告 / evidence-labelled offline RL reports
docs/                        模型卡、数据契约与审计 / model card, data, interoperability, audit
public/assets/               小懿原版形象与项目视觉资产 / canonical Xiaoyi and project visuals
.github/                     CI、安全与发布工作流 / CI, security, release workflows
```

## 贡献与引用 / Contributing and citation

贡献前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)、[`GOVERNANCE.md`](GOVERNANCE.md) 与
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。算法变更必须提供固定种子、数据指纹、切分说明、
实际更新遥测和可复现测试。学术或工程材料可使用 [`CITATION.cff`](CITATION.cff) 引用。

Read [`CONTRIBUTING.md`](CONTRIBUTING.md), [`GOVERNANCE.md`](GOVERNANCE.md), and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) before contributing. Algorithm changes must provide pinned seeds, a data fingerprint, split semantics, actual update telemetry, and reproducible tests. Cite academic or engineering use through [`CITATION.cff`](CITATION.cff).

## 许可证 / License

代码与项目原创矢量资产使用 Apache-2.0；公开数据与运行时提供方仍保留各自条款，详见 [`NOTICE`](NOTICE) 与 [`docs/ASSET_PROVENANCE.md`](docs/ASSET_PROVENANCE.md)。<br>
Code and project-original vector assets are released under Apache-2.0. Public datasets and runtime providers retain their own terms; see [`NOTICE`](NOTICE) and [`docs/ASSET_PROVENANCE.md`](docs/ASSET_PROVENANCE.md).
