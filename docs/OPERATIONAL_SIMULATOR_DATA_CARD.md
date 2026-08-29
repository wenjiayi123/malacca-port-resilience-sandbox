# 港口运行实时模拟器数据卡

## 结论与真实性边界

`port-operations.telemetry.v1` 是本项目面向未来现场适配器的稳定运行合同。当前所有连续值均来自
公开数据校准的历史/实时模拟、物理状态机或工程派生，不是马六甲、新加坡、上海或任何港口的
现场实测遥测。系统固定保持：

```text
simulation_mode=true
live_data_verified=false
dispatch_allowed=false
production_authority=false
```

马六甲是产品场景；新加坡 MPA 月度统计、Open-Meteo/ERA5 和 Piraeus AIS 样本属于跨港公开数据
参考。它们用于校准到港量、天气/海况包络和高频接入规模，不得改写成马六甲现场数据。

## 公开数据与用途

| 来源 | 本地证据 | 当前用途 | 不能支持的声明 |
|---|---|---|---|
| MPA/data.gov.sg `Vessel Arrivals (>75 GT), Monthly` | `data/rl/mpa_vessel_arrivals_monthly.csv`，377 月 | 到港强度、时间趋势、预测模型训练/验证 | 泊位级实时到港、现场吞吐收益 |
| Open-Meteo/ERA5 与 Marine API | 既有训练数据中的风速及运行适配器来源登记 | 风、浪、流、能见度工程过程的公开模型包络 | 航海导航、港区传感器实测 |
| Zenodo/INFORE Piraeus AIS | `reports/public-dataset-credibility-comparison.json` | 371,585 原始消息、1,440 分钟窗口的高频接入证据 | 马六甲/上海船位或港口作业 KPI |
| IMO GHG Study 2020 | 运行快照 `calibration.datasets` 与碳字段 `source_id` | 燃料/碳核算方法边界 | 核证减排、集团财务收益 |

## 工程模拟假设

- 15 分钟业务步长，默认 5 秒墙钟推进一个业务步；`PORT_SIMULATOR_SEED=240520` 可复现。
- 到港流量含日周期、周周期、公开月度趋势和有界确定性扰动。
- 队列满足 `queue(t)=queue(t-1)+arrivals-diverted-serviced-control_relief`。
- 有效能力同时受航道、潮窗、天气、岸桥可用率、堆场饱和度和动作安全包络限制。
- 吞吐进入堆场库存，闸口/铁路/驳船形成出流；堆场占用强制限制在 0–100%。
- 设备负荷由岸桥、场桥/AGV、箱流和楼宇负荷形成；吞吐增加会提高作业能耗。
- 储能容量 12 MWh，功率限制 ±3 MW，SOC 15–95%，并计算效率、温度、SOH 微量衰减。
- 主变压器容量 18 MW；越界会触发 `control_envelope_breaches`，不会静默继续下发。
- 电价为明确标注的工程分时日历；没有把需求响应或市场收益冒充真实结算。

## 逐字段元数据

所有 `operationalTelemetry` 字段均携带：`value`、`unit`、`event_time`、`ingest_time`、
`source_type`、`source_id`、`quality_status`、`confidence`、`is_measured`、`is_simulated`、
`is_derived`、`site_id`、`asset_id`、`schema_version` 和 `trace_id`。JSON Schema 位于
`docs/schemas/port-operations-telemetry.schema.json`。

## 异常与失败关闭

支持正常、高峰、封航、设备故障、极端天气、航道拥堵/传感器漂移、堆场饱和和数据失联。
数据失联时逐字段值变为 `null`、质量码变为 `offline`、完整率降为 0，策略推荐和执行 API 返回
门禁错误；停止模拟器也会阻断新推荐和已审批动作执行。

## 现场替换合同

| 适配器槽 | 当前实现 | 现场替换 |
|---|---|---|
| AIS | 公开研究分布校准船流状态机 | 授权 AIS/NMEA/IALA 适配器 |
| TOS | MPA 月度到港校准作业守恒模拟器 | 船期、泊位、箱流、作业任务适配器 |
| VTS | 潮窗、航道、引拖工程状态机 | VTS、引航、拖轮和通航计划适配器 |
| PLC/SCADA | 设备状态机、维护与故障引擎 | 岸桥、场桥、AGV、闸口和传感器适配器 |
| EMS/BMS/BA | 负荷、岸电、储能、光伏和楼宇模型 | 电表、EMS、BMS、BA 适配器 |

生产启用仍需现场字段映射、单位/时区确认、设备拓扑、实测标定、影子运行、双人审批身份源、
设备联锁和回滚演练。代码不会因为提供一个非空 URL 就自动开启生产权限。

中央地图另有隔离的 `geospatial-live-map.v1` 接口，可在配置 MapTiler 和 AISStream 密钥后显示卫星
瓦片与授权实时 AIS。该接口使用五分钟新鲜度门禁，并始终保持 `navigation_authority=false`、
`dispatch_allowed=false`、`production_authority=false`。详见 `docs/LIVE_SATELLITE_MAP.md`。

## 小懿运行解释边界

`/api/operations/handoff` 先由 `operations-grounded-explainer.v1` 从同一快照生成状态摘要、阈值预警、
策略候选、交班门禁和 `trace_id`。该底稿明确 `model_used=false`。只有配置 `XIAOYI_AI_ENDPOINT` 且
真实 `/api/chat` 调用成功、返回非空回答时，响应才会标记 `xiaoyi_model.status=connected` 和
`model_used=true`；未配置、超时、错误或空回答全部失败关闭到状态底稿，不伪装成生成模型结果。
