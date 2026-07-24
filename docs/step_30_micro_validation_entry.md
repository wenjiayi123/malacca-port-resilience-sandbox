# 第 30 步：微观验证入口

## 功能目标

在 Web 沙盘中新增“进入单船验证”入口。用户点击某艘船或某条航段后，Web 会基于第 28 步定义的 `GodotValidationRequest` 生成给 Godot 的验证参数。

## 交互入口

- 船舶点击：地图上的动态船舶可点击，直接选中该船作为验证对象。
- 航段点击：地图上的航段可点击，系统会选取该航段上预计延误最高的代表船作为验证对象。
- 底部“沙盘推演”模块新增“微观验证入口”卡片。
- 点击“进入单船验证”后，页面生成并展示 Godot 请求 JSON 预览。

## 生成参数

生成的 `GodotValidationRequest` 包括：

- 船舶 ID、船名、IMO 编号和船型。
- 航线 ID、航道 ID、起点港口和终点港口。
- 当前航速、目标航速、安全航速上下限。
- 航向角和航段进度。
- 从航道状态、天气、目的港拥堵和风险预警派生的风险事件。
- 当前推荐调度策略 ID。
- 请求生成时间。

## 风险事件派生

- 航道拥堵或高延误：生成 `channel-closure` 或 `collision-risk`。
- 风浪、风速或能见度约束：生成 `extreme-weather`。
- 目的港高拥堵：生成 `port-paralysis`。
- 当前最高等级风险预警：生成 `manual-event` 或 `extreme-weather`。

## 当前边界

- 第 30 步只在 Web 内生成参数和预览。
- 暂未直接写入 Godot 的 `user://malacca_validation_request.json`。
- 下一步可实现本地文件导出或 Web 与 Godot 桥接进程对接。
