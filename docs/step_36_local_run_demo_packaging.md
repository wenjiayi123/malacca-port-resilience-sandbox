# 第 36 步：本地运行与演示打包

本步骤把当前系统整理为可本地演示的运行方式：Web 主系统本地启动，Godot 子系统保留工程版，不在本阶段导出 Godot 可执行文件。后续可在此基础上封装为桌面演示包。

## 本地演示结构

- Web 主系统：`/Users/apple/Desktop/马六甲沙盘港口推演`
- Web 本地地址：`http://127.0.0.1:5180/`
- Godot 子系统工程版：`/Users/apple/Desktop/航行模拟器`
- Godot 默认可执行路径：`/Users/apple/Downloads/Godot.app/Contents/MacOS/Godot`
- Web 静态构建输出：`dist/`
- 演示导出目录：`exports/`

## 新增命令

```bash
pnpm demo:web
```

启动 Web 主系统。如果 `5180` 端口已经有服务，会直接提示当前访问地址。

```bash
pnpm demo:check
```

检查 Node、pnpm、Web 依赖、Godot 工程版路径、Godot 可执行文件和 Web 构建状态。默认会执行一次 `pnpm build`。

```bash
pnpm demo:godot
```

打开 `/Users/apple/Desktop/航行模拟器` 的 Godot 工程版，便于现场查看微观航行验证工程、场景和脚本。

```bash
pnpm demo:bundle
```

生成一个时间戳命名的 Web 静态演示目录，例如：

```text
exports/malacca-web-demo-20260706-184500/
```

该目录包含 Web 静态构建、说明文档和演示清单。Godot 子系统仍以工程版路径引用，不复制或导出 Godot 工程。

## 推荐现场操作

1. 在 Web 工程目录执行 `pnpm demo:check`。
2. 执行 `pnpm demo:web`。
3. 打开 `http://127.0.0.1:5180/`。
4. 底部切换 `沙盘推演`，点击 `正常、拥堵、封航、天气、低碳` 演示案例。
5. 如需展示微观验证工程，执行 `pnpm demo:godot` 打开 Godot 工程版。

## 桌面演示包后续方案

后续桌面演示包建议分三层：

1. Web 壳层

- 使用 Web 静态构建目录 `dist/` 作为主界面资源。
- 可用 Tauri、Electron 或 macOS 原生 WebView 封装成本地桌面入口。
- 桌面壳负责打开主界面、固定窗口尺寸和显示演示菜单。

2. 本地桥接层

- 桌面壳或本地 Node 服务负责把 Web 生成的单船验证请求写入 Godot 的 `user://malacca_validation_request.json`。
- 读取 Godot 回写的 `user://malacca_validation_result.json` 后推送给 Web。

3. Godot 微观验证层

- 当前阶段保留 `/Users/apple/Desktop/航行模拟器` 工程版，便于继续开发和现场查看。
- 后续稳定后，可选择导出 Godot 子系统为独立可执行文件，再由桌面壳按需启动。

## 当前边界

- 本步骤不修改 Godot 工程逻辑。
- 本步骤不强制打包桌面应用，只准备本地运行脚本和 Web 静态演示目录。
- Godot 工程版继续作为微观验证子系统的真实来源。
