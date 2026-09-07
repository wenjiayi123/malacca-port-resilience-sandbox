# 十域强化学习 v2 发布说明

本次发布包含已训练、已激活的十域联合强化学习模型、训练与回归原始工件、模型切换和回退、运行回执，以及面向海事业务的说明。接口合同仍为 `core-operations-rl.v1`；模型版本为 v2，旧算法、模型、历史报告和失败试验保留。

## 证据入口

- [模型结果](../reports/core-operations-rl-champion-v2.md)与[活动指针](../reports/core-operations-active.json)。
- [训练曲线、复现和切换](RL_CONVERGENCE_V2.md)。
- [实际执行回执](../reports/core-operations-runtime-acceptance-v2.json)与[回滚回执](../reports/core-operations-runtime-rollback-v2.json)。
- [本轮最初验收记录](../reports/core-operations-upgrade-acceptance-v2.json)：保留当时两项开发依赖漏洞导致完整发布检查未通过的事实。该历史记录及其引用文件不重写。

本次发布准备将 browserslist 固定到 4.28.7，解决 GHSA-c83g-rgw3-j3cx 和 GHSA-73wf-gq98-2v4g；锁文件及安全覆盖一并进入容器安装和发布包。运行包必须携带活动模型校验所需的训练、评估和服务源文件；新增隔离包加载检查，防止开发目录加载新版而容器因缺文件悄然回退。

[依赖更新证据](../reports/dependency-security-upgrade-v1.json)分别绑定旧环境清单与本次清单。旧运行验收脚本保持原字节，在隔离目录中使用原来的 package.json 和锁文件检查旧报告的全部业务、权限、回执和源码证据；该目录不安装依赖。本次清单另经完整测试、构建和漏洞审计，避免将历史环境哈希直接改写为新值。

## 业务指标与金额

README 的四情景能源成本和碳强度范围取自模型报告 `valueAttribution.fullScenarios[].versusSop`，表示相对仿真中既定作业方案的完整时序对照；与报告中相对旧强化学习策略的范围不同。最低吞吐保持率为 99.484211%。

金额取自执行回执 `core-receipt-b9b89c0244b20ed8` 的同状态、同随机种子、同时间步配对对照，单步为 15 分钟：模型电费从 826.62 减至 561.16 林吉特，差额 265.46 林吉特。按 2026-09-07 查阅的 [Wise 汇率](https://wise.com/gb/currency-converter/myr-to-cny-rate)，固定用 1 林吉特 = 1.66 元人民币作展示折算，得到 440.6636 元，约 441 元。

条件性年化示例使用未四舍五入的金额：`265.46 × 1.66 × 96 × 365 = 15,440,852.544` 元，约 1,544 万元。假设全年每天 24 小时运行，且负荷、节电效果、电价和汇率均保持该单次样本水平。**没有完成全年仿真验证或现场验证，此数不是年度收益预测模型的输出，也不能据此证明投资回报。**

公开月报累计到港量为统计总量，高频 Piraeus AIS 只覆盖独立 24 小时；两者不能合并描述为多年单船现场轨迹。分钟级运营方数据还需重新定义样本时钟和容量单位、校准环境、按源事件隔离训练验证，并完成影子运行。

## 核验与回退

```bash
pnpm install --frozen-lockfile
pnpm release:check
node scripts/release/verifyRuntimeBundle.mjs
node --experimental-strip-types scripts/rl/switchCoreOperationsModel.ts reports/core-operations-rl-champion-v1.json
```

回退命令切换到保留的上一模型；重新切回时指定 v2 报告。`simulation_mode=true`、`live_data_verified=false`、`dispatch_allowed=false`、`production_authority=false` 均保持。检查结论、正式放行及生产下发仍由主管部门、授权人员和独立联锁决定。

本次本地完整 `pnpm release:check` 已通过：99 项测试、代码检查、类型检查、构建、历史证据校验、公开隐私扫描及漏洞审计均通过；依赖审计未发现已知漏洞。隔离复制 Docker 运行文件布局后，新版模型加载及全部绑定源码哈希校验通过。本机没有 Docker 引擎，本次没有声称镜像实际构建或容器运行验收。
