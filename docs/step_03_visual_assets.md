# 第 3 步：视觉资源整理

## 已完成

- 创建 Web 公共素材目录：`public/assets`
- 复制当前选定背景图到：`public/assets/backgrounds/malacca_background_selected.png`
- 复制当前视觉参考图到：`public/assets/reference/ui_reference_selected_clean.png`
- 创建预留目录：`public/assets/ui`、`public/assets/icons`、`public/assets/ships`
- 创建公共素材清单：`public/assets/asset-manifest.json`
- 创建代码资源清单：`src/assets/visualAssets.ts`
- 创建设计变量：`src/styles/tokens.css`
- 更新全局样式：`src/styles/global.css`
- 添加视觉资源说明：`docs/visual_assets.md`

## 当前策略

- `assets/` 保留原始素材和归档素材。
- `public/assets/` 存放浏览器运行时直接访问的素材。
- `src/assets/` 存放代码使用的资源路径、画布尺寸和参考区域坐标。
- `src/styles/tokens.css` 存放 HUD 视觉系统的颜色、边框、阴影和背景变量。

## 下一步

第 4 步开始复刻主界面布局：顶部标题栏、左侧面板、右侧面板、底部导航、中央地图区域和开始推演按钮。
