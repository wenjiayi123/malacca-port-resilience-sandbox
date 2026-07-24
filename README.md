<p align="center">
  <img src="docs/assets/hero.svg" alt="Malacca Port Resilience Sandbox" width="100%" />
</p>

<p align="center">
  <a href="#港航网络韧性数字孪生沙盘--malacca-port-resilience-sandbox">双语说明 / Bilingual guide</a> ·
  <a href="docs/DATASET_CONTRACT.md">数据契约 / Data contract</a> ·
  <a href="docs/RL_ARCHITECTURE.md">算法架构 / RL architecture</a> ·
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
  <strong>研发作者：</strong>温家懿 · <strong>Research Author:</strong> Wen Jiayi
</p>

<table>
  <tr>
    <th align="center">公开月度记录<br /><sub>PUBLIC RECORDS</sub></th>
    <th align="center">统一策略矩阵<br /><sub>CONTROL MATRIX</sub></th>
    <th align="center">模型延误<br /><sub>MODEL DELAY</sub></th>
    <th align="center">模型拥堵<br /><sub>MODEL CONGESTION</sub></th>
    <th align="center">吞吐保持<br /><sub>THROUGHPUT RETENTION</sub></th>
  </tr>
  <tr>
    <td align="center"><strong>377</strong><br />MPA + ERA5</td>
    <td align="center"><strong>4 RL + MPC</strong><br />3 seeds / sealed test</td>
    <td align="center"><strong>−66.00%</strong><br />MPC vs hold-plan</td>
    <td align="center"><strong>−66.27%</strong><br />closed-loop replay</td>
    <td align="center"><strong>99.03%</strong><br />deferred backlog 4.97%</td>
  </tr>
</table>

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
| 声明门禁 / Claim gate | 吞吐、期望安全风险、延误、拥堵、跨种子稳定性、递延积压6/6通过<br><sub>Throughput, expected safety risk, delay, congestion, cross-seed stability, and deferred backlog: 6/6 passed</sub> |

验证选出的Expected SARSA在封存闭环回放中暴露出跨种子不稳定，系统因此不把它包装为业务收益；稳定的MPC对照在同一测试段实现模型延误降低66.00%、拥堵降低66.27%、吞吐保持99.03%、期望安全违规率3.67%，最终递延积压为平均月到港量的4.97%。完整五算法结果、负向结果和源码指纹均保存在[`reports/rl-benchmark-balanced-resilience.md`](reports/rl-benchmark-balanced-resilience.md)。

The validation-selected Expected SARSA policy becomes unstable across seeds on sealed closed-loop replay and is therefore rejected as a business-benefit claim. On the same test segment, the stable MPC comparator reduces modelled delay by 66.00% and congestion by 66.27%, retains 99.03% throughput, records 3.67% expected safety violation, and ends with deferred backlog equal to 4.97% of mean monthly arrivals. The [versioned benchmark report](reports/rl-benchmark-balanced-resilience.md) preserves full five-method results, negative findings, and source fingerprints rather than a cherry-picked headline.

## 系统画面 / Product surfaces

| 港航态势与核心闭环 / Maritime situation and core loop | 小懿执行报告与人工门禁 / Xiaoyi report and human gate |
|---|---|
| ![港航态势与核心闭环](docs/assets/sandbox-command-center.jpg) | ![小懿执行报告与人工门禁](docs/assets/human-review-gate.jpg) |

## 架构 / Architecture

```mermaid
flowchart LR
  subgraph Evidence["证据与数据层 / Evidence and data"]
    MPA["MPA月度公开统计 / monthly statistics"]
    WX["Open-Meteo气象海况 / metocean"]
    AUTH["授权AIS/TOS/VTS适配器 / authorized adapters"]
    CONTRACT["CSV/JSON与port-call-event.v1"]
  end
  subgraph Core["推演与控制核心 / Simulation and control"]
    STATE["港航网络状态 / network state"]
    EVENT["事件注入与传播 / event propagation"]
    JOB["异步headless训练 / asynchronous training"]
    BASE["4 RL + 1 MPC"]
    HOLDOUT["验证选优 / validation selection + sealed test"]
    CKPT["SHA-256检查点 / checkpoint"]
  end
  subgraph Governance["交互与治理 / Interaction and governance"]
    UI["React数字孪生沙盘 / digital-twin UI"]
    XEXEC["小懿白名单执行器 / allowlisted executor"]
    XADV["小懿RL顾问 / RL advisor"]
    REVIEW["执行报告与人工确认 / report and human review"]
    REPLAY["测试trace回放 / sealed-test replay"]
  end
  Evidence --> STATE --> EVENT --> JOB --> BASE --> HOLDOUT --> CKPT
  STATE --> UI
  CKPT --> REPLAY --> UI
  XADV --> JOB
  XEXEC --> UI --> REVIEW
```

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

字段、单位、时区、缺失值和多港口选择规则见 [`docs/DATASET_CONTRACT.md`](docs/DATASET_CONTRACT.md)。<br>
See [`docs/DATASET_CONTRACT.md`](docs/DATASET_CONTRACT.md) for fields, units, time zones, missing values, and multi-port selection.

## 快速开始 / Quick start

要求 Node.js 24+ 与 pnpm 11+。<br>
Requires Node.js 24+ and pnpm 11+.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm release:check
pnpm dev
```

打开 <http://127.0.0.1:5174>。进入“沙盘推演”，打开“训练中心”，先完成训练，再运行训练后策略
测试或检查点推理。<br>
Open <http://127.0.0.1:5174>, enter the sandbox, open the training centre, complete training, and only then run post-training policy evaluation or checkpoint inference.

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
GET    /api/rl/datasets
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

## 复现、发布与安全 / Reproduction, release, and security

```bash
pnpm lint          # ESLint + TypeScript规则 / rules
pnpm test          # 数据隔离、更新、恢复与安全 / isolation, updates, recovery, safety
pnpm benchmark:rl  # 3种子离线回放 / three-seed offline replay and evidence
pnpm benchmark:rl:verify # 数据/代码哈希与全算法指标 / hashes and full-method metrics
pnpm build         # 严格类型检查与生产构建 / strict types and production build
pnpm release:check # 门禁、密钥、资产与工作流 / gates, secrets, assets, workflows
pnpm audit --audit-level=moderate
```

发布标签工作流会构建静态应用、生成 SPDX SBOM 和发布包；仓库公开后再执行 GitHub provenance
attestation、CodeQL 与 OSSF Scorecard。安全边界见 [`SECURITY.md`](SECURITY.md)，模型限制见
[`docs/MODEL_CARD.md`](docs/MODEL_CARD.md)。

Release-tag workflows build the static application, SPDX SBOM, and release bundle. GitHub provenance attestation, CodeQL, and OSSF Scorecard run after public release. See [`SECURITY.md`](SECURITY.md) for security boundaries and [`docs/MODEL_CARD.md`](docs/MODEL_CARD.md) for model limitations.

## 明确不包含 / Explicit exclusions

- 未提供港口生产账号、实时 AIS/TOS/VTS 数据或控制权限；<br>
  *No production port accounts, live AIS/TOS/VTS data, or control authority.*
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
data/rl/                     MPA月度公开快照 / reproducible monthly public snapshot
tests/                       算法、隔离、恢复、合同与安全 / algorithms, isolation, recovery, contracts
reports/                     带证据等级的RL报告 / evidence-labelled offline RL reports
docs/                        模型卡、数据契约与审计 / model card, data, interoperability, audit
public/assets/               项目原创SVG资产 / project-original SVG assets
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
