# 本地演示指南 / Local demo guide

## Web 沙盘

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm demo:check
pnpm demo:web
```

默认演示地址为 <http://127.0.0.1:5174>。`demo:check` 会验证 Node、pnpm、依赖与 Web 构建；
Godot 是可选微观验证子系统，没有配置时不会阻断 Web 沙盘。

桌面启动器不读取终端的环境配置。启动与环境检查脚本会查找 PATH、Homebrew 和本机已有的
Codex 缓存运行环境，并验证 Node.js 至少为 24；也可用 `MALACCA_NODE_BIN` 指定 Node 的绝对路径。
启动日志会显示选中的运行环境。无需重新打包桌面应用，直接重试即可使用修复后的脚本。

## 可选 Godot 桥接

本仓库不包含 Godot 工程或 Web 二进制。若你有兼容工程，请显式设置：

```bash
export GODOT_PROJECT=/absolute/path/to/godot-project
export GODOT_BIN=/absolute/path/to/godot
pnpm demo:godot
```

导出内嵌 Web 版本：

```bash
export GODOT_EXPORT_PRESET="Malacca Web Simulator"
pnpm demo:godot:web
```

导出物写入 `public/godot-simulator/`，并被 Git 忽略。只有完整导出存在时，React 页面才会加载
iframe；否则界面会显示重建说明，避免把缺失二进制伪装成可用联动。

## Demo flow

Run `pnpm demo:web` and open <http://127.0.0.1:5174>. The optional Godot bridge requires explicit
`GODOT_PROJECT` and `GODOT_BIN` paths. Generated Godot binaries remain local and are not part of this source
distribution.
