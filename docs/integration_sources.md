# 对接工程来源

## 无人船航行模拟器

- 工程路径：`/Users/apple/Desktop/航行模拟器`
- 工程类型：Godot 工程
- 对接用途：作为本项目的微观单船/无人船航行验证模块。
- 当前定位：马六甲沙盘项目负责宏观港航网络推演；航行模拟器负责选中船舶、选中航段、避碰风险、单船航行行为等微观验证。

## 后续对接原则

- 不直接破坏或重构原有航行模拟器控制逻辑。
- 先通过独立数据接口传递船舶、航段、风险事件和调度策略。
- 在马六甲项目内保留宏观态势与统计指标。
- 在航行模拟器内验证单船航行、避碰、航速调整和风险航段通过效果。
- 待宏观沙盘界面稳定后，再做双工程之间的数据联动或场景合并。

## 第 28 步接口设计

- 类型入口：`src/types/sandbox.ts` 中的 `GodotIntegrationContract`、`GodotValidationRequest` 和 `GodotValidationResult`。
- 首期桥接：`file-json`，Web 写入 `user://malacca_validation_request.json`，Godot 回写 `user://malacca_validation_result.json`。
- 船舶 ID：Web 使用 `vesselId`，Godot 侧映射到 `player.gd` 的 `ship_agent_id`。
- 起终点：`origin` 和 `destination` 均包含港口 ID、港口名和经纬度。
- 航速：`speedProfile` 传递初始航速、目标航速、安全下限和安全上限。
- 风险事件：`riskEvents` 传递事故封航、极端天气、碰撞风险、港口瘫痪、能源管控和人工事件。
- 验证结果：`GodotValidationResult` 回写是否安全通过、预计耗时、风险等级、推荐航速、抵达状态、平均航速、最小安全间距、碰撞/搁浅次数、延误变化、碳排变化、微观场景加载摘要和结论。

## 样例文件

- Web 发给 Godot：`docs/godot_validation_request.example.json`
- Godot 回给 Web：`docs/godot_validation_result.example.json`
