# 视觉资产来源与开源发布门禁 / Asset provenance

开源副本只包含本项目为发布版绘制的 SVG、同源 PNG 导出，以及运行应用后产生的界面截图。它们
与代码一同按 Apache-2.0 发布，不依赖第三方照片、地图瓦片、商标图形或未知来源的角色图片。

| 文件 | 类型 | 来源 | 发布状态 |
|---|---|---|---|
| `public/assets/backgrounds/malacca-operations-grid.svg` | 沙盘背景 | 项目原创矢量图 | 可按 Apache-2.0 再分发 |
| `public/assets/backgrounds/shanghai-operations-grid.svg` | 上海场景背景 | 项目原创矢量图 | 可按 Apache-2.0 再分发 |
| `public/assets/xiaoyi-maritime-officer.svg` | 小懿操作助手形象 | 项目原创矢量图 | 可按 Apache-2.0 再分发 |
| `public/assets/xiaoyi-maritime-officer.png` | 小懿操作助手 Q 版导出 | 同源形象的栅格导出 | 可按 Apache-2.0 再分发 |
| `docs/assets/hero.svg` | GitHub 头图 | 项目原创矢量图 | 可按 Apache-2.0 再分发 |
| `docs/assets/*.jpg` | 应用截图 | 从本仓库本地运行版本采集 | 可按 Apache-2.0 再分发 |

原工作目录中的参考 PNG、软著材料、构建产物、导出包和 Godot Web 二进制不进入独立开源副本。
若以后通过 Release 分发 Godot 构建物，仍需对模型、贴图、字体、音频和插件逐项建立许可清单。

The release copy contains only project-original SVG artwork and screenshots captured from this repository.
Historical reference images, registration materials, exports and Godot binaries are intentionally excluded.
