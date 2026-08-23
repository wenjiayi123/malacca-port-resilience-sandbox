# 本地端到端功能验证

## 启动

```bash
cd /path/to/malacca-port-resilience-sandbox
pnpm demo:web
```

等待终端显示 `[URL] http://127.0.0.1:5174/`，浏览器访问
<http://127.0.0.1:5174/>。保持终端开启，验收结束按 `Control+C` 停止。

## UI 测试路径

1. 底部点击“证据与闭环”。顶部应同时显示“公开数据校准实时模拟”“模型真实推理输出”
   “待切换现场数据源”。
2. “实时遥测”：等待 5 秒，确认 `tick`、时标、队列、吞吐、能耗等连续变化；各数据域无空卡。
3. “数字孪生”：确认流量守恒、堆场容量、SOC、变压器、因果能耗五项检查全部通过。
4. “预测模型”：确认预测点来自后端，显示训练/验证行数、RMSE、模型 SHA-256 和边界说明。
5. “策略闭环”：对照 FCFS、港口 SOP、运筹枚举、MPC；RL 没有已完成检查点动作时必须显示阻断。
6. 任选可用策略，依次点击“创建待审批决策”→“双人审批”→“模拟执行并取回执”；确认显示
   输入/数据/模型哈希、安全投影、回执和 KPI 差值。需要时点击“回滚”。
7. “数据血缘”：检查字段来源、质量码、置信度、时标和 `trace_id`。
8. “安全治理”：注入“数据失联”，确认出现失败关闭门禁且不能创建决策；切回“正常运行”。
   点击“停止并验证失败关闭”，确认推荐/执行被阻断，再点击“启动模拟器”。
   点击“小懿运行解释与交班”，确认报告引用当前快照和 `trace_id`；若模型未连接，必须明确显示
   `not-configured` 或 `unavailable`，且不出现伪造模型回答。
9. “模型版本”：确认当前预测模型、校准后固定基准、旧报告/失败候选并列且旧证据没有被覆盖。
10. “审计回放”：确认 `verified=true`，创建、审批、执行、回滚和异常注入记录组成 SHA-256 链。
11. “现场适配”：确认 AIS、TOS、VTS、PLC/SCADA、EMS/BMS/BA 只需替换适配器和标定参数。
12. 回到“态势总览”，在中央地图切换“可复现实况模拟”与“卫星实时定位”。未配置凭据时，后者必须
    显示严格失败关闭、0 个真实船位和具体缺失项；配置后必须同时显示卫星瓦片已加载、AIS connected、
    五分钟内真实船位数、最新时间和接收延迟。点击船舶检查 MMSI、经纬度、航速、航向和定位质量。

## API 闭环

```bash
curl -fsS http://127.0.0.1:5174/api/operations/snapshot
curl -fsS http://127.0.0.1:5174/api/operations/recommendations
curl -fsS http://127.0.0.1:5174/api/operations/handoff
curl -fsS http://127.0.0.1:5174/api/operations/audit
curl -fsS http://127.0.0.1:5174/api/geospatial/live
```

写接口需要 `Content-Type: application/json`；执行接口还必须提供至少 8 个字符的
`Idempotency-Key`。远程监听时所有非公开 API 还需要强 Bearer Token。

## 自动测试

```bash
pnpm release:check
```

监管延误策略可单独复现与验真：

```bash
pnpm benchmark:regulatory
pnpm benchmark:regulatory:verify
```

页面验收路径为“证据与闭环 → 监管韧性”。依次切换常态监管链、海事集中检查、海关单证/查验滞留、
双重检查与放行恢复，确认检查队列、恢复队列、监管延误和增量能耗随后端响应变化；同时确认页面保持
`official_release_exogenous=true`、`dispatch_allowed=false`、`production_authority=false`。

该命令执行 lint、25+ 项测试、TypeScript/Vite 构建、固定 RL 报告校验、公开数据报告校验、
依赖漏洞审计、敏感信息扫描、资产来源检查和工作流检查。本地通过不等于真实港口或生产控制验证通过。

可单独运行 `pnpm acceptance:operations && pnpm acceptance:operations:verify`，生成并校验
`reports/operational-closure-acceptance-v1.json`；报告包含源码 SHA-256、预测训练/验证边界、
五控制器候选、双人审批、幂等回执、回滚、失败关闭和审计链证据。
