# 第 37 步：Godot Web 内嵌微观仿真视窗

本步骤把 `/Users/apple/Desktop/航行模拟器` 从“工程版打开展示”升级为“Web 主沙盘内嵌运行展示”：React 页面可以在沙盘推演模块中直接召出 Godot Web 仿真视窗，让宏观港航网络推演和微观单船航行验证出现在同一个演示界面里。

## 新增能力

- 在 Godot 工程中新增 Web 导出预设：`Malacca Web Simulator`。
- 将 Godot Web 导出到 Web 项目的 `public/godot-simulator/`。
- Web 沙盘推演模块新增浮动仿真视窗，默认检测 `/godot-simulator/index.html` 是否可用。
- 视窗支持刷新、独立打开和关闭。
- 生成 Godot 验证请求或加载联动演示案例时，会自动打开仿真视窗。
- 微观验证面板新增“仿真视窗”按钮，用于现场随时召回内嵌运行画面。

## 新增命令

```bash
pnpm demo:godot:web
```

该命令会调用：

```text
/Users/apple/Downloads/Godot.app/Contents/MacOS/Godot
```

并从以下工程导出 Web 版本：

```text
/Users/apple/Desktop/航行模拟器
```

导出结果位于：

```text
public/godot-simulator/index.html
public/godot-simulator/index.js
public/godot-simulator/index.pck
public/godot-simulator/index.wasm
```

## 推荐现场展示流程

1. 执行 `pnpm demo:godot:web`，生成或刷新 Godot Web 导出物。
2. 执行 `pnpm demo:web`，启动 Web 主沙盘。
3. 打开 `http://127.0.0.1:5180/`。
4. 切换到底部 `沙盘推演`。
5. 点击任一联动演示案例，或选择船舶后点击 `生成参数`。
6. 页面右侧地图区域会出现 Godot 微观仿真视窗。

## 当前边界

- 当前已完成“网页内嵌运行展示”，比单独打开 Godot 工程更适合现场演示。
- 当前 Web 仍通过既有 JSON 请求和导入结果面板表达业务联动。
- 下一步可把 Web 请求通过浏览器消息或 Godot JavaScriptBridge 直接传入内嵌 Godot 运行时，再把结果自动回传给 Web。
