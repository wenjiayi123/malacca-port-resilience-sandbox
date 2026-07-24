# 第 32 步：结果回传机制

本步骤补全 Godot 到 Web 的验证结果字段。Godot 在 `user://malacca_validation_result.json` 中输出结构化结果，Web 类型和微观验证面板可以导入并展示该结果。

## Godot 回传字段

- `safePass`：是否安全通过。
- `estimatedTravelMinutes`：预计航行耗时。
- `riskLevel`：综合风险等级，取值为 `low`、`medium`、`high`、`critical`。
- `recommendedSpeedKnots`：推荐航速。
- `carbonDeltaTons`：碳排变化，负数表示减排。

同时保留第 31 步已有字段，例如 `status`、`minClearanceMeters`、`collisionCount`、`groundingCount`、`loadedScene` 和 `summary`。

## 计算逻辑

- `safePass`：当验证状态为 `passed`，且没有碰撞、搁浅，最小安全间距不低于阈值时为 `true`。
- `riskLevel`：综合验证状态、最小安全间距、风险事件等级、风险事件类型和临时障碍数量计算。
- `recommendedSpeedKnots`：按风险等级在 `minSafeKnots`、`targetKnots` 和 `maxSafeKnots` 之间取推荐值。
- `estimatedTravelMinutes`：按验证航段距离、推荐航速和风险事件附加延误估算。
- `carbonDeltaTons`：沿用目标航速相对初始航速的碳排变化估算。

## Web 展示

微观验证入口新增“导入结果”按钮。用户选择 Godot 生成的 `malacca_validation_result.json` 后，面板会显示：

- 安全通过 / 降级通过 / 未通过。
- 推荐航速。
- 风险等级。
- 预计耗时。
- 碳排变化。
- Godot 原始结果 JSON。

## 当前边界

- Web 浏览器不能直接读取本机 `user://` 目录，当前通过手动选择 JSON 文件导入。
- 下一步可以通过本地桥接进程、HTTP 或 WebSocket 实现 Web 一键写入请求并自动读取结果。
