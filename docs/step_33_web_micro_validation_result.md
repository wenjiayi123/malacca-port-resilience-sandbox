# 第 33 步：Web 展示微观验证结果

本步骤把 Godot 的 `malacca_validation_result.json` 接入 Web 主系统。用户导入 Godot 结果后，Web 不再只显示原始 JSON，而是同步更新风险、AI 建议、调度策略和单船报告。

## 已实现能力

- 微观验证面板支持导入 Godot 输出的结果 JSON。
- 导入后生成单船报告，展示：
  - 安全通过 / 降级通过 / 未通过。
  - 风险等级。
  - 推荐航速。
  - 预计耗时。
  - 碳排变化。
- 右侧“风险预警”列表插入“微观验证”风险项，颜色跟随 Godot 的 `riskLevel`。
- “规则 AI 决策建议”读取 Godot 结果，更新风险判断、调度建议和碳排优化建议。
- “调度优化”模块读取 Godot 推荐航速和风险等级，动态加权低速航行、改道绕行和错峰到港策略。
- 调度优化摘要在存在 Godot 结果时优先显示微观调度建议。

## 数据流

1. Web 生成 `GodotValidationRequest`。
2. Godot 读取请求并输出 `GodotValidationResult`。
3. Web 导入 `malacca_validation_result.json`。
4. Web 根据 `safePass`、`riskLevel`、`recommendedSpeedKnots`、`estimatedTravelMinutes` 和 `carbonDeltaTons` 更新主系统展示。

## 当前边界

- 当前仍是浏览器文件导入模式，Web 不能直接读取 Godot 的 `user://` 目录。
- 下一步可以增加本地桥接进程，实现 Web 一键写请求、一键读取或自动轮询结果。
