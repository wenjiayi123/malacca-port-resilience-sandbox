# 港口训练数据集合同

## 最小字段

训练器接受 CSV 或 JSON。JSON 可以是记录数组，也可以是包含 `records` 或 `data` 数组的对象。

| 语义 | 首选字段 | 支持别名 | 单位 | 必填 |
|---|---|---|---|---|
| 港口标识 | `port_id` | `portId`, `unlocode`, `port_code`, `terminal_id` | 稳定 ID/UNLOCODE | 多港口文件必填 |
| 时间 | `timestamp` | `datetime`, `date`, `time`, `month`, `period` | ISO 8601 或可字典排序的年月 | 是 |
| 到港需求 | `arrivals` | `arrival_count`, `vessel_arrivals`, `number_of_vessels`, `vessels` | 艘/采样周期 | 是 |
| 总吨位 | `gross_tonnage` | `grossTonnage`, `tonnage`, `gross_tons` | 数据源原始 GT 标度 | 是 |
| 服务能力 | `capacity` | `service_capacity`, `port_capacity`, `berth_capacity` | 艘/采样周期 | 建议 |
| 风速 | `wind_speed_ms` | `windSpeedMs`, `wind_speed` | m/s | 否 |
| 浪高 | `wave_height_m` | `waveHeightM`, `wave_height` | m | 否 |
| 能见度 | `visibility_km` | `visibilityKm`, `visibility` | km | 否 |
| 安全事件 | `safety_incidents` | `safetyIncidents`, `incident_count` | 件/采样周期 | 否 |

缺少服务能力时，参考实现只使用**训练段**到港量第 75 百分位的 96% 作为容量代理，使高需求四分位
能够形成拥堵。该代理只用于公开数据复现；生产训练应提供实测泊位/航道服务能力。

## 港口选择、时间与切分

- 记录先按 `port_id`、`timestamp` 升序排序；同一港口重复时间戳会直接拒绝。
- 单一港口可省略 `port_id`；多港口文件必须设置 `PORT_TRAINING_PORT_ID`，禁止把不同港口拼成一条时序。
- 所选港口至少需要 20 条有效记录。
- 前约 70% 为训练段，中间约 15% 为验证段，最后约 15% 为最终测试段，验证和测试各至少 4 条。
- Q 值、Dyna 模型和 MPC 需求偏差只读取训练段；最优算法只由验证段选择。
- 验证段内部再按时间分为调参前段和算法选择后段；默认每种 RL 比较 3 组学习率/折扣因子候选。
- 最终测试段只在训练完成后的显式 `/evaluate` 调用中读取，不参与选优。
- 高频数据应使用一致时区，并避免夏令时重复时间戳。

## 港口生产数据建议

泊位级使用至少应提供：到港时间、服务开始/结束时间、排队长度、泊位可用能力、船型/吨位、
计划与实际 ETA、天气海况、安全事件和执行动作。一个文件可以合并多个港口，但需先在上游按
稳定港口 ID 对齐采样周期；参考适配器要求显式选择，不猜测要训练哪个港口。

## 接入

```bash
PORT_TRAINING_DATASET_PATH=/absolute/path/to/port_training.csv PORT_TRAINING_PORT_ID=SGSIN pnpm dev
```

启动后先检查：

```bash
curl http://127.0.0.1:5174/api/rl/datasets
```

返回记录数、训练/验证/测试时间范围与 SHA-256 截断指纹。训练检查点保存同一指纹与港口 ID，用于防止结果
与数据版本混淆。

响应还包含容量、风速、浪高、能见度、完整气象向量与安全字段覆盖率、容量来源模式以及验证/测试
到港均值相对训练段的漂移。`weatherCoveragePercent` 只有在风、浪、能见度三项同一记录均存在时
才计入，避免把单一再分析风场误写为完整海况。容量
为 `empirical-proxy` 或漂移显著时不禁止研究训练，但 `operationalClaimAllowed=false`，必须在部署评审中显式处理，不能把代理容量
误写为港口实测能力。

## 许可与隐私

对外发布数据前确认再分发许可。不要提交 MMSI/IMO 与商业事件的可重识别组合、客户合同、
生产 Token、保安区位置或未经授权的 AIS 原始轨迹。建议在港口内网完成聚合，只把匿名训练特征
交给本项目。

## `terminal-operations.v2` 严格清单

泊位级接入不再只依赖上表的九个聚合字段。设置 `PORT_OPERATIONAL_MANIFEST_PATH` 后，训练任务
先读取 `terminal-operations.v2` 清单，并验证港区/码头、泊位堆场、岸桥闸口、ETA、通航潮窗、
引拖、气象海况、安全危险品、岸电燃料与跨港转移字段。任何必需字段或映射缺失时，任务失败关闭。
清单通过后仍会逐记录检查 24 项训练必需字段、带时区时间戳、0/1 状态、非负数值和百分比范围，
防止“清单写了但数据没有”的空壳接入。

示例和 Schema：

- `config/port-profiles/shanghai-international-port.example.json`
- `docs/schemas/terminal-operations-manifest.schema.json`
- `docs/SHANGHAI_PORT_LANDING.md`

当前控制算法读取严格投影后的六维聚合状态。港口侧应按经审核的业务规则，把泊位、岸桥、
堆场、闸口、航道、潮窗、引航和拖轮约束合成为 `effective_service_capacity`；适配器不会擅自
发明这些因果系数。原始运行字段仍进入适配文件和数据指纹，供审计与后续扩展直接奖励维度。

`fair-queueing`、`energy-cost-control` 和 `multi-port-coordination` 仍需要直接公平性、能源成本和
跨港平衡奖励，当前聚合投影不支持时保持禁用。字段齐全不等于动作可以自动生产执行，生产操作
仍需 RBAC、审计、港口授权和人工确认。

## 大规模公开 AIS 包

`pnpm data:sync:infore-ais` 从 Zenodo 下载并校验 DOI `10.5281/zenodo.3754481` 的 Piraeus
单接收站 AIS 数据。仓库不再分发 CC BY-NC-ND 4.0 原始压缩包。脚本处理 371,585 条原始消息，
输出 1,440 条一分钟船流密度记录到 `.runtime/public-datasets/`。

该包的 `arrivals` 是活跃船舶密度代理，`gross_tonnage` 只是使非碳控制奖励保持中性的尺度值；
它没有实测 GT、泊位能力、天气、安全或动作结果。公开比较明确把碳与安全权重设为 0，并禁止
现场收益声明。完整边界见 `reports/public-dataset-credibility-comparison.md`。
