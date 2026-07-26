# 上海国际港口落地接入

## 当前结论

项目主体和默认启动场景仍是马六甲海峡；本手册只描述如何显式切换到上海接入样例，不改变
仓库的产品定位、默认画面或叙事。

本仓库现在把三类能力分开：

1. `aggregate-v1`：保留 MPA+ERA5 的 377 条月度公开基准、四种 RL + MPC、既有指标和版本化证据。
2. `public-ais-training-package.v1`：处理 371,585 条 Piraeus 原始 AIS 消息，形成 1,440 条分钟记录，用于高频接入和算法规模外部验证。
3. `terminal-operations.v2`：上海或其他真实港口的严格字段、场景、动作证据和失败关闭门禁。

前两项是公开数据离线研究证据；第三项是生产接入合同。没有授权的上海 TOS/VTS/AIS、泊位、
堆场、设备、气象和安全数据时，系统不会显示“上海已生产接入”，也不会把公开基准收益改写成
上海现场 KPI。

## 上海港现实因素与代码映射

上海港是由洋山、外高桥、罗泾等港区及长江口、海铁、水水、公路集疏运共同组成的网络，不应
作为一个只有“到港量和容量”的单点处理。

| 上海港公开事实或运营因素 | `terminal-operations.v2` 字段 | 进入算法的方式 | 相关动作或目标 |
|---|---|---|---|
| 洋山、外高桥、罗泾等港区协同 | `port_id`, `terminal_id`, `transfer_capacity`, `transfer_cost` | 港区选择、跨节点能力和成本门禁 | 多港协同、分流 |
| 泊位利用、岸线和计划资源 | `effective_service_capacity`, `berth_utilization_percent` | 有效能力与排队压力 | 泊位能力重配置、拥堵削峰 |
| 岸桥效率、堆场翻箱和堆场占用 | `quay_crane_moves_per_hour`, `yard_occupancy_percent` | 由港口侧合成为有效服务能力，同时保留原始字段审计 | 吞吐、延误、能力重配置 |
| 外集卡、海铁和水水中转 | `truck_turn_time_minutes`, `rail_transfer_teu`, `water_transfer_teu` | 陆侧和中转压力审计 | 集疏运平衡、恢复 |
| 双向通航、潮窗、引航和拖轮 | `channel_available`, `tide_window_open`, `pilot_available_count`, `tug_available_count` | 通航状态和资源门禁 | 错峰到港、安全优先 |
| 台风、风浪、能见度和流速 | `wind_speed_ms`, `wave_height_m`, `visibility_km`, `current_speed_knots` | 气象海况风险 | 天气鲁棒、安全优先 |
| 危险品和防污染作业限制 | `hazmat_restriction_active`, `safety_incidents` | 安全风险和动作禁用 | 安全优先、人工审批 |
| 岸电、LNG、绿色甲醇和燃料成本 | `shore_power_available`, `shore_power_used`, `fuel_consumption_tons`, `carbon_emissions_tons`, `fuel_price`, `carbon_price` | 能源和碳证据门禁 | 低碳、能源成本 |
| ETA 计划与真实到港偏差 | `planned_eta`, `actual_eta`, `queue_entry_time`, `service_start_time` | 到港偏差、等待和公平性 | 错峰、公平排队、延误最小化 |

当前五算法的在线训练入口采用严格投影：港口侧必须把泊位、岸桥、堆场、闸口、航道、潮窗、
引航和拖轮约束合成为 `effective_service_capacity`；算法直接读取队列/能力、延误、碳、递延
积压、需求趋势和气象风险六维控制状态。所有原始运行字段仍写入适配数据指纹和门禁审计。

公平性、直接能源成本和多港平衡等需要新增奖励维度的目标在当前投影环境中继续禁用，不能用
现有六维奖励近似冒充。`GET /api/rl/contracts/terminal-operations` 返回每个字段、动作和目标的
可用状态及阻断原因。

## 公开事实基线

场景模板只使用可核验的公开背景值，不生成船舶、队列或现场效率：

- 上海市政府披露，上海港 2025 年集装箱吞吐量为 5,506.3 万 TEU，连续 16 年全球第一。
- 2025 年洋山港区完成 2,871 万 TEU，占上海港 52.2%。
- 上海市政府披露洋山泊位综合利用率约 84%，海铁联运箱量为 111.6 万 TEU。
- 上港集团 2024 年年报披露水水中转比例 61.5%，并把岸线、堆场、穿梭巴士、引航拖带、
  高温危险品、岸电和绿色燃料列为实际生产组织因素。
- 上港集团年报明确将台风、热带风暴以及气象、水文条件列为可能导致船舶无法靠泊的运营风险。

来源：

- 上海市政府，2025 年吞吐、自动化、泊位与海铁联运：
  https://www.shanghai.gov.cn/nw4411/20260107/7893a4ab626140ae89988cbd35add6a1.html
- 上海市政府，2025 年洋山港区占比与通航效率：
  https://english.shanghai.gov.cn/en-Latest-WhatsNew/20260107/981624ec9df14b6a9810893afcf1cad8.html
- 上港集团 2024 年年度报告：
  https://www.portshanghai.com.cn/wenku/www/202504/071654076ni7.pdf
- 上海海事局，危险货物、防污染和恶劣天气安全边界：
  https://www.sh.msa.gov.cn/tzgg/106532.jhtml
- 上海市港口岸电建设方案：
  https://www.shanghai.gov.cn/cmsres/f1/f12acea11f73401ebf282614909a2437/44580f5299a16fb46c77765343399a4b.pdf

## 接入步骤

### 1. 准备场景

```bash
VITE_PORT_SCENE_PROFILE=shanghai-international-port
VITE_PORT_DATA_MODE=live
VITE_PORT_DATA_ENDPOINT=/api/operator/shanghai/snapshot
```

上海场景与训练数据独立。场景模板只提供洋山、外高桥、罗泾和小洋山北作业区的拓扑背景；
生产快照应设置 `topologyMode: "replace"`，避免与任何演示拓扑合并。

### 2. 建立字段映射

复制：

```text
config/port-profiles/shanghai-international-port.example.json
```

将 `dataPath` 和 `fieldMappings` 改为授权导出文件，设置：

```bash
PORT_OPERATIONAL_MANIFEST_PATH=/absolute/path/to/shanghai-terminal-operations.manifest.json
```

模板不是上海数据。只有数据来源、单位、质量码、时区、授权和再分发边界均完成审核后，才可把
`evidenceLevel` 从 `synthetic-contract-example` 改为 `operator-authorized`。

### 3. 检查门禁

```bash
curl http://127.0.0.1:5174/api/rl/contracts/terminal-operations
curl http://127.0.0.1:5174/api/rl/datasets
```

`trainingReady=false` 时不得创建上海生产训练声明。清单配置后，异步训练任务会读取映射文件，
生成带清单和源数据摘要的适配指纹，再进入原有四种 RL + MPC 的训练、验证、检查点和留出测试。
训练入口还会逐记录校验 24 项必需字段、带时区时间戳、0/1 状态、非负数值和百分比范围；只在
清单中声明字段但数据行实际缺失时同样失败关闭。

### 4. 接入同源快照

浏览器端不保存生产 Token。授权网关应把 TOS/VTS/AIS/气象数据转换成
`port-digital-twin.snapshot.v1`，并通过同源接口提供。生产快照至少应包含：

- `observedAt`、`source`、`topologyMode: "replace"`；
- 场景/港区/航道拓扑；
- 按稳定 ID 的港口、船舶、气象、指标、风险和事件增量；
- 证据状态、质量码和数据时间。

### 5. 训练、验证和发布

- 训练只读取 Train，验证负责调参与选型，最终测试保持封存。
- 训练时地图不渲染；显式 `/evaluate` 后才回放测试 trace。
- 所有动作先作为建议，生产执行必须经过授权、RBAC、审计和人工确认。
- 发布前运行 `pnpm release:check`；上海数据、Token 和可识别 AIS/TOS/VTS 记录不得提交 Git。

## 大规模公开数据比较

执行：

```bash
pnpm data:sync:infore-ais
pnpm benchmark:public-data
pnpm benchmark:public-data:verify
```

INFORE Piraeus 数据源 DOI 为 `10.5281/zenodo.3754481`，许可为 CC BY-NC-ND 4.0。仓库不再分发
原始压缩包；脚本由使用者从 Zenodo 下载并校验 MD5。比较结果见：

- `reports/public-dataset-credibility-comparison.md`
- `reports/rl-benchmark-balanced-resilience-calibrated-v2.md`

推荐表述：

> 基于覆盖 1995—2026 年、汇总 4,064,858 艘次到港量的 377 个 MPA+ERA5 月度记录，完成
> 21,600 个 RL episodes 与三步 MPC 的严格时间留出基准；另使用 371,585 条原始 Piraeus AIS
> 消息构建 1,440 条分钟级外部验证记录。两个数据集按来源、许可、时间跨度和现场能力缺口分别
> 标注，不将公开代理结果包装为上海港 KPI。

## 小懿形象

训练助理和操作助手继续引用 `public/assets/xiaoyi-ai-port-hero.png` 的小懿原版 Q 版形象。场景
切换不得替换人物身份资产；只允许修复清晰度、布局、无障碍文本和状态联动。
