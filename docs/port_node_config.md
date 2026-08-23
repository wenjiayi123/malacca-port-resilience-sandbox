# 马六甲港口节点配置

## 目标

第 8 步把地图上的港口标记从视觉点位升级为可参与推演的数据节点。每个节点同时服务于三个层面：

- 可视化层：地图标记、右侧关键节点监控、拥堵状态展示。
- 宏观推演层：港口排队、等待、吞吐、泊位利用率、碳强度和韧性权重。
- 微观验证层：后续将选定港口、航道和船舶参数传递给 `/path/to/sailing-simulator` 做单船航行验证。

## 当前节点

当前场景配置了 8 个核心港口节点：

| ID | 港口 | 国家 | 等级 | 关联航道 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `penang` | 槟城港 | Malaysia | major | `malacca-main`, `westbound-lane` | 正常 |
| `port-klang` | 巴生港 | Malaysia | major | `malacca-main`, `phillip-channel` | 正常 |
| `singapore` | 新加坡港 | Singapore | major | `phillip-channel`, `singapore-east-west` | 拥堵 |
| `tanjung-pelepas` | 丹戎帕拉帕斯港 | Malaysia | major | `singapore-east-west`, `phillip-channel` | 正常 |
| `batam` | 巴淡岛 | Indonesia | secondary | `singapore-east-west` | 正常 |
| `dumai` | 杜迈港 | Indonesia | secondary | `dumai-channel`, `westbound-lane` | 正常 |
| `belawan` | 巴拉望港 | Indonesia | secondary | `malacca-main`, `westbound-lane` | 正常 |
| `kuantan` | 关丹港 | Malaysia | secondary | `eastbound-lane` | 正常 |

## 字段口径

- `position`：当前大屏地图上的百分比坐标，用于 UI 定位。
- `geo`：港口经纬度，用于后续真实地理计算、AIS 数据映射和 Godot 坐标换算。
- `connectedChannelIds`：港口连接的航道 ID，用于拥堵传播和航道分流策略。
- `vesselCount`：当前监测船舶数。
- `congestionPercent`：港口节点拥堵度。
- `berthUtilizationPercent`：泊位利用率。
- `queueVessels`：等待靠泊或等待进出港的排队船舶数。
- `averageWaitingHours`：平均等待时间，单位小时。
- `dailyThroughputMillionTons`：日吞吐量，单位百万吨。
- `berthCount`：可用泊位数量。
- `anchorageCount`：关联锚地数量。
- `carbonIntensityKgPerTon`：单位货物碳强度，单位 kg/t。
- `resilienceWeight`：韧性评估权重，越高表示该节点对网络韧性影响越大。

## 数据说明

当前数值是沙盘推演初始种子数据，用于支撑前端界面、算法原型和后续模块联调；它们不是实时港口生产数据。后续可以替换为 AIS、港口运营系统、公开统计数据或自研仿真引擎输出。

## UI 接入

- 地图港口标记的悬停信息已经包含经纬度、船舶数、排队数、平均等待、吞吐、碳强度、泊位利用率和韧性权重。
- 右侧“关键节点监控”已经改为展示节点、船舶、排队和状态。
- 新加坡港保留为高拥堵样例节点，用于后续低碳调度和港口分流策略演示。
