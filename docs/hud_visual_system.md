# HUD 视觉系统

## 设计目标

本项目主界面采用深海蓝科技大屏风格，重点服务港航网络态势、推演控制和风险监测。视觉系统要求信息密度高、层级清晰、状态颜色明确，避免把关键数据做成装饰性元素。

## 核心样式文件

- `src/styles/tokens.css`：全局颜色、阴影、边框、按钮和面板变量。
- `src/styles/global.css`：当前大屏界面布局与 HUD 控件样式。

## 通用视觉规则

- 面板统一使用 `hud-panel`，包含高亮边角、标题条、内部网格纹理和蓝色发光边框。
- 指标统一使用 `kpi-card`，用于顶部核心指标条。
- 模块按钮统一使用 `module-button`，当前模块使用 `module-button--active`。
- 主推演按钮使用 `run-button`，作为底部唯一强主操作。
- 状态文字统一使用 `status-badge`，并通过 `status-badge--ok`、`status-badge--warning`、`status-badge--danger` 表达状态。
- 文本状态色保留 `tone-ok`、`tone-warning`、`tone-danger`，用于数字、百分比或非徽标文字。

## 状态色语义

- `ok`：正常、可通行、低风险。
- `warning`：关注、预警、中等风险。
- `danger`：拥堵、故障、高风险。

## 后续使用原则

- 新增面板优先复用 `hud-panel`。
- 新增操作按钮优先复用 `module-button` 或 `run-button`。
- 新增表格状态优先使用 `status-badge`。
- 图表容器沿用蓝色边框、深色底、细网格线和高亮主曲线。
- 不把动态数据写死到背景图里，背景只承担地图和氛围层。
