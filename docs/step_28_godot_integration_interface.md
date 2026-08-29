# 第 28 步：Godot 对接方案设计

## 对接目标

Web 沙盘负责宏观态势、拥堵、风险、调度和碳排推演；`/path/to/sailing-simulator` 负责选中单船的微观航行验证。第 28 步先定义稳定数据接口，不改动 Godot 原有控制逻辑。

## 首期桥接方式

- 首期采用 JSON 文件桥接，接口类型为 `file-json`。
- Web 生成验证请求：`user://malacca_validation_request.json`。
- Godot 读取请求后创建或选中船舶，执行单船航行验证。
- Godot 回写验证结果：`user://malacca_validation_result.json`。
- 后续可在不改字段语义的前提下升级为 HTTP 或 WebSocket。

## Web -> Godot 验证请求

字段定义位于 `src/types/sandbox.ts` 的 `GodotValidationRequest`：

- `requestId`：单次验证任务 ID，用于结果回传匹配。
- `vesselId`：Web 船舶 ID，对应 Godot 中的 `ship_agent_id`。
- `vesselName`、`imo`、`category`：船舶识别信息。
- `routeId`、`channelId`：来自 Web 的航线和航道 ID。
- `origin`：起点港口，包含港口 ID、名称和经纬度。
- `destination`：终点港口，包含港口 ID、名称和经纬度。
- `speedProfile`：航速配置，包含初始航速、目标航速、安全下限和安全上限。
- `headingDeg`：初始航向角。
- `progressPercent`：Web 沙盘中船舶当前航段进度。
- `riskEvents`：风险事件列表，支持事故封航、极端天气、碰撞风险、港口瘫痪、能源管控和人工事件。
- `dispatchStrategyIds`：需要 Godot 验证的调度策略 ID。
- `createdAt`：请求生成时间。

## Godot -> Web 验证结果

字段定义位于 `src/types/sandbox.ts` 的 `GodotValidationResult`：

- `requestId`、`vesselId`：回传匹配键。
- `status`：验证状态，支持 `pending`、`running`、`passed`、`failed`、`degraded`。
- `safePass`：是否安全通过。
- `estimatedTravelMinutes`：预计航行耗时。
- `riskLevel`：综合风险等级，支持 `low`、`medium`、`high`、`critical`。
- `recommendedSpeedKnots`：推荐航速。
- `simulatedDurationSeconds`：Godot 实际模拟时长。
- `reachedDestination`：是否抵达终点。
- `averageSpeedKnots`：平均航速。
- `minClearanceMeters`：最小安全间距。
- `collisionCount`：碰撞次数。
- `groundingCount`：搁浅次数。
- `riskEventResolvedCount`：已处理风险事件数。
- `delayDeltaMinutes`：相对 Web 预估的延误变化。
- `carbonDeltaTons`：相对 Web 预估的碳排变化。
- `loadedScene`：Godot 已加载的微观场景摘要，包括航线点、风险区和临时障碍数量。
- `summary`：验证结论文本。

## 与航行模拟器现有能力的映射

- `vesselId` 对应 `player.gd` 中的 `ship_agent_id`。
- `speedProfile.targetKnots` 可映射到单船目标航速或外部油门控制。
- `headingDeg` 可映射到 Godot 船舶航向遥测。
- `riskEvents[].type = collision-risk` 可读取 Godot 船舶碰撞警告和碰撞次数。
- `ShipFleetManager.get_fleet_snapshot()` 已能输出舰队快照，后续适配器可在此基础上回写验证结果。

## 示例文件

- 请求样例：`docs/godot_validation_request.example.json`
- 结果样例：`docs/godot_validation_result.example.json`

## 后续落地建议

第 29 步建议实现 Web 侧 `GodotIntegrationContract` 生成器，把当前选中船舶、航线、风险事件和推荐调度策略导出成 `malacca_validation_request.json`，再补 Godot 侧读取脚本。
