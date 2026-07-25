# 视觉资产来源与开源发布门禁 / Asset provenance

开源副本包含小懿 AI 原项目的同名身份素材、本项目为发布版绘制的 SVG，以及运行应用后产生的
界面截图；不依赖第三方照片、地图瓦片、商标图形或未知来源的角色图片。

| 文件 | 类型 | 来源 | 发布状态 |
|---|---|---|---|
| `public/assets/backgrounds/malacca-operations-grid.svg` | 沙盘背景 | 项目原创矢量图 | 可按 Apache-2.0 再分发 |
| `public/assets/backgrounds/shanghai-operations-grid.svg` | 上海场景背景 | 项目原创矢量图 | 可按 Apache-2.0 再分发 |
| `public/assets/xiaoyi-ai-port-hero.png` | 小懿操作助手原版形象 | 小懿 AI 原项目同名素材，SHA-256 `620e4f4092d2bbcf9efc1dc002a4164a2453c5aa3b996faa1d04c446d5c093a2` | 随本项目发布 |
| `public/assets/xiaoyi-maritime-officer.svg` | 旧版替代矢量图 | 项目原创矢量图；仅保留历史兼容，不用于界面身份展示 | 可按 Apache-2.0 再分发 |
| `public/assets/xiaoyi-maritime-officer.png` | 旧版替代栅格图 | 同源历史导出；不用于界面身份展示 | 可按 Apache-2.0 再分发 |
| `docs/assets/hero.svg` | GitHub 头图 | 项目原创矢量图 | 可按 Apache-2.0 再分发 |
| `docs/assets/xiaoyi-multi-ui-linkage.jpg` | 小懿多层 UI 联动画面 | 用户从本仓库本地运行页面采集，1570×1342 | 随仓库用于工程展示 |
| `docs/assets/rl-training-complete-evidence.jpg` | 训练完成遥测画面 | 从本仓库本地真实后台任务采集，1280×720 | 随仓库用于工程展示 |
| `docs/assets/sandbox-command-center.jpg` | 港航态势与核心闭环 | 从本仓库本地运行版本采集，1280×720 | 随仓库用于工程展示 |
| `docs/assets/human-review-gate.jpg` | 小懿执行报告与人工门禁 | 从本仓库本地运行版本采集，1280×720 | 随仓库用于工程展示 |

原工作目录中的参考 PNG、软著材料、构建产物、导出包和 Godot Web 二进制不进入独立开源副本。
若以后通过 Release 分发 Godot 构建物，仍需对模型、贴图、字体、音频和插件逐项建立许可清单。

The release copy uses the canonical Xiaoyi AI repository image for the assistant identity. Other release
artwork is project-original, and interface screenshots are captured from this repository. Registration
materials, unrelated reference exports and Godot binaries are intentionally excluded.
