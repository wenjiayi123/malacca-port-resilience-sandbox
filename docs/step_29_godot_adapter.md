# 第 29 步：Godot 模拟器检查与适配

## 已检查的 Godot 工程结构

- 工程路径：`/Users/apple/Desktop/航行模拟器`
- 主场景：`main.tscn`
- 主船控制脚本：`player.gd`
- 舰队管理脚本：`scripts/rl/ship_fleet_manager.gd`
- 航线系统：`scripts/world/ship_route_system.gd`
- 障碍物系统：`scripts/world/ship_navigation_obstacles.gd`
- 场景控制：`scripts/world/ship_scenario_controller.gd`

## 新增能力

在 Godot 工程中新增 `res://scripts/integration/malacca_validation_bridge.gd`，并在主场景根节点下新增 `Main/MalaccaValidationBridge`。

该桥接层负责：

- 读取 Web 生成的 `user://malacca_validation_request.json`。
- 接收船舶 ID、起终点、航速、航向、风险事件和调度策略。
- 通过现有 `ShipFleetManager` 查找或生成验证船。
- 将 Web 的 `vesselId` 映射到 Godot 的 `ship_agent_id`。
- 调用现有 `set_ship_navigation_spawn()`、`set_ship_agent_command()`、`configure_route()` 等公开方法。
- 写回 `user://malacca_validation_result.json`。

## 不破坏原逻辑的边界

- 未修改 `player.gd`。
- 未修改 `ShipFleetManager`。
- 未修改船舶驾驶、转向、动画、碰撞或 HUD 逻辑。
- 桥接节点无请求文件时静默，不影响原场景启动和操作。

## 验证结果

- `Godot --check-only --quit` 通过。
- `Godot --headless --quit-after 3` 通过。
- 使用第 28 步请求样例做 JSON 烟测，通过并生成最终结果：
  - `status`: `passed`
  - `simulatedDurationSeconds`: `2.04`
  - `collisionCount`: `0`
  - `groundingCount`: `0`
  - `riskEventResolvedCount`: `1`

当前仍存在主场景原有资源 UID 警告：`ship_weather_time_controller.gd` 的 UID 无效，Godot 会回退到文本路径加载；本次桥接适配没有引入新的运行时报错。
