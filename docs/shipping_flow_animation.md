# 航道与船流动画数据

## 目标

第 9 步把静态航道线和静态船舶点位升级为可推演的动态船流层。当前实现保持主界面结构不变，在地图 SVG 层内新增沿航道路径循环运动的船舶图元。

## 数据层级

### 航道流 RouteOverlay

`routeOverlays` 现在不只是视觉路径，还承载一条宏观船流的运行指标：

- `label`：航道流名称。
- `channelId`：关联的航道状态 ID。
- `originPortId` / `destinationPortId`：起终点港口节点。
- `svgPath`：地图上的航道路径。
- `vesselVolume`：该流向的日船舶量。
- `averageSpeedKnots`：平均航速。
- `delayMinutes`：当前平均延误。
- `carbonEmissionTons`：当前流向估算碳排放量。
- `animationSeconds`：前端动画循环周期，用于让不同航线呈现不同速度。

### 单船点 VesselMarker

`vesselMarkers` 现在代表可沿航道流移动的示例船舶：

- `name` / `imo`：船名和 IMO 编号。
- `flowId`：绑定的航道流 ID。
- `destinationPortId`：目标港口。
- `progressPercent`：当前航程进度种子值。
- `carbonEmissionTonsPerHour`：单船小时碳排估算。
- `animationDelaySeconds`：动画负延迟，用于错开船舶位置，形成连续船流。

## 当前航道流

| 航道流 | 起点 | 终点 | 日流量 | 延误 | 状态 |
| --- | --- | --- | ---: | ---: | --- |
| 西北入口至新加坡主通道 | 槟城港 | 新加坡港 | 720 艘/日 | 8 分钟 | 正常 |
| 苏门答腊侧西行主通道 | 新加坡港 | 巴拉望港 | 610 艘/日 | 6 分钟 | 正常 |
| 巴生港至新加坡东向航线 | 巴生港 | 新加坡港 | 430 艘/日 | 31 分钟 | 拥堵 |
| 杜迈港支线接入航线 | 杜迈港 | 丹戎帕拉帕斯港 | 188 艘/日 | 27 分钟 | 预警 |
| 新加坡分道通航接续区 | 丹戎帕拉帕斯港 | 新加坡港 | 352 艘/日 | 12 分钟 | 预警 |

## UI 接入

- 航道线悬停信息显示起终点、日流量、平均航速、延误和碳排。
- 船舶图元沿对应 SVG 航道循环移动。
- 不同船型使用不同船体颜色，保留统一的蓝色尾迹。
- 左侧“航道通航状态”新增延误分钟显示。

## 后续接口

后续拥堵推演模块可以直接更新 `routeOverlays[].delayMinutes`、`routeOverlays[].vesselVolume` 和 `routeOverlays[].tone`。碳排核算模块可以更新 `routeOverlays[].carbonEmissionTons` 和 `vesselMarkers[].carbonEmissionTonsPerHour`。Godot 无人船验证层通过 `GodotValidationRequest` 读取船舶 ID、起终点、航速、风险事件和调度策略，完成单船航行验证后再用 `GodotValidationResult` 回写验证结果。
