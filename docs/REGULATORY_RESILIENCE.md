# 海事与海关检查延误韧性 / Regulatory-delay resilience

## 业务问题

船舶被海事主管机关检查、滞留，或货物因单证与海关查验等待放行后，影响不会在“检查结束”时消失：

```text
主管机关选查/结论（外生）
→ 船舶或货物监管等待
→ 泊位、堆场、岸桥与窗口错配
→ 官方放行（外生）
→ 恢复队列与积压消化
→ 延误、能耗、碳排和成本变化
```

系统只优化两类可控动作：检查材料与作业准备度，以及官方放行后的恢复资源优先级。系统不能选择
检查对象、修改检查结论或提前放行。

## 增量策略与旧策略保护

- 原有 `hold-plan`、`eco-speed`、`arrival-window`、`port-diversion`、`capacity-control` 五类港口动作保持不变。
- 新增 12 维监管观测和 9 种“准备度 × 放行后恢复”补充动作，作为独立 Q-learning 策略层。
- 情景覆盖常态、海事集中检查、海关单证/查验滞留、双重检查与放行恢复。
- `simulation_mode=true`、`live_data_verified=false`、`dispatch_allowed=false`、`production_authority=false`。

## 训练、失败与业务价值

协议使用 MPA 月度记录派生的预声明监管压力变量，按时间切分训练/验证/冻结测试；3 个随机种子各训练
2,500 episodes。检查选择、检查结果和官方放行过程不受动作控制。最终测试只有在验证集完成选型后才解封。

| 候选 | 结果 | 关键证据 |
|---|---|---|
| v1 无优势门控 | `blocked_candidate_preserved` | 虽有 36.3423% 场景成本改善，但能耗、碳排和安全退化，因此阻断并保留 |
| v2 优势投影 | `qualified_offline` | 冻结测试场景成本降低 7.4679%，能耗降低 15.8095%，碳排降低 15.8119%；监管延误、恢复服务与安全均不退化 |

v2 的逐行配对 bootstrap 成本改善估计为 8.8096%，95% 区间 7.8169%–9.7889%，共 57 条冻结测试记录。
这些是离线预声明压力场景结果，不是现场 KPI、实际节省或自动调度授权。

## 可复现证据

```bash
pnpm benchmark:regulatory
pnpm benchmark:regulatory:verify
pnpm test
pnpm release:check
```

- 机器证据：[`regulatory-resilience-v1.json`](../reports/regulatory-resilience-v1.json)、[`regulatory-resilience-v2.json`](../reports/regulatory-resilience-v2.json)
- 人读报告：[`regulatory-resilience-v1.md`](../reports/regulatory-resilience-v1.md)、[`regulatory-resilience-v2.md`](../reports/regulatory-resilience-v2.md)
- 旧闭环兼容声明：[`operational-closure-regulatory-extension-v1.json`](../reports/operational-closure-regulatory-extension-v1.json)
- 前端入口：`证据与闭环 → 监管韧性`

## 官方业务依据

- [IMO — Port State Control](https://www.imo.org/en/ourwork/iiis/pages/port%20state%20control.aspx)：缺陷可能导致船舶被延误或滞留。
- [Royal Malaysian Customs — Pre-Arrival Processing](https://www.customs.gov.my/en/business/facilitation/pre-arrival-processing-pap)：需实物查验的申报不具备立即放行条件，放行由海关决定。
- [Singapore Customs — Import procedures](https://www.customs.gov.sg/businesses/importing-goods/import-procedures/apply-customs-import-permit/)：货物清关受获批许可及其条件约束。

## 面试表达

“我没有让算法替代海事或海关权力，而是把检查选择、检查结论和官方放行建模为外生事件；算法只优化
检查准备和放行后的恢复。原五类策略完全保留，新增策略经过冻结测试、失败候选留档和安全/服务不退化
门禁后，才以 `qualified_offline` 状态进入研究系统。”
