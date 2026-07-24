# 第 31 步：Godot 单船验证场景

本步骤在 `/Users/apple/Desktop/航行模拟器` 中完成，不破坏原有驾驶、舰队和 HUD 逻辑，只扩展 `MalaccaValidationBridge` 的外部验证能力。

## 已实现能力

- 根据 Web 的 `GodotValidationRequest.vesselId` 查找或生成验证船舶。
- 根据 `origin`、`destination`、`progressPercent` 和 `headingDeg` 加载船舶初始位置与航向。
- 根据 `speedProfile.targetKnots` 和 `speedProfile.maxSafeKnots` 下发验证航速。
- 根据起终点在 `ShipRouteSystem` 中生成单船验证航段。
- 在 `GeneratedMalaccaValidationScene` 下生成验证起点、验证终点和风险区标记。
- 根据 `riskEvents` 生成微观验证要素：
  - `channel-closure`：生成临时封航阻断盒。
  - `collision-risk`：生成临时礁石障碍。
  - `port-paralysis`：在目的港进港方向生成阻断区。
  - `extreme-weather`：危险级事件生成禁航盒，其他级别只生成风险区可视化。
  - `energy-control` 和人工事件：默认作为风险区可视化，不强行生成物理障碍。
- 验证窗口内持续统计最小安全间距、碰撞次数、搁浅次数、航速、风险处理数量、预计耗时、风险等级、推荐航速、延误变化和碳排变化。
- 结果 JSON 新增 `loadedScene` 摘要，记录航线点、风险区和临时障碍数量。

## 保护边界

- 不修改 `player.gd`。
- 不修改原有船舶控制、转向、动画和输入逻辑。
- 不永久修改 `ShipNavigationObstacles`；验证开始前快照原障碍配置，验证结束后自动恢复。
- 不改 Web 页面交互，只让 Web 类型兼容 Godot 新增的结果摘要。

## 对接文件

- Godot 桥接脚本：`/Users/apple/Desktop/航行模拟器/scripts/integration/malacca_validation_bridge.gd`
- Godot 桥接说明：`/Users/apple/Desktop/航行模拟器/docs/malacca_validation_bridge.md`
- Web 请求样例：`/Users/apple/Desktop/马六甲沙盘港口推演/docs/godot_validation_request.example.json`
- Web 结果样例：`/Users/apple/Desktop/马六甲沙盘港口推演/docs/godot_validation_result.example.json`

## 下一步建议

第 32 步可以实现 Web 侧文件写入与结果读取：把当前预览的 `GodotValidationRequest` 写入 Godot 的 `user://malacca_validation_request.json`，并把 `user://malacca_validation_result.json` 读取回 Web 面板展示。
