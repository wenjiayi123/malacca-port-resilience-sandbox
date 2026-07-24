# 第 5 步：沙盘背景层优化

## 已完成

- 使用用户新上传的清洁版马六甲海峡地图作为当前主背景。
- 新背景已保存到：
  - `assets/backgrounds/malacca_background_clean.png`
  - `public/assets/backgrounds/malacca_background_clean.png`
- 保留旧图：
  - `assets/backgrounds/malacca_background_selected.png`
  - `public/assets/backgrounds/malacca_background_selected.png`
- 更新 CSS 背景变量：`src/styles/tokens.css`
- 更新代码资源索引：`src/assets/visualAssets.ts`
- 更新公共资源清单：`public/assets/asset-manifest.json`
- 更新视觉资源说明：`docs/visual_assets.md`

## 背景层策略

- 当前主背景只承载地图、海峡、航线光效和基础科技边框。
- 港口标签、国家标签、船舶点位、航道状态、图例、左右面板和底部控制台都由 Web UI 独立绘制。
- 这样可以避免把 UI 信息烘死在图片里，后续推演数据变化时可以动态刷新。

## 当前背景尺寸

- 清洁背景图：`1535 x 1024`
- UI 参考图：`1536 x 1024`

两者宽度相差 1 像素，Web 端使用 `background-size: cover` 适配，不影响全屏展示。
