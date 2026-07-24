# 视觉资源整理

## 资源分层

```text
assets/
├── backgrounds/      # 原始/归档背景图
├── reference/        # 原始/归档参考图
├── icons/            # 原始图标素材
├── ships/            # 原始船舶素材
└── ui/               # 原始 UI 素材

public/assets/
├── backgrounds/      # 浏览器直接访问的背景图
├── reference/        # 浏览器直接访问的参考图
├── icons/            # 浏览器直接访问的图标
├── ships/            # 浏览器直接访问的船舶素材
├── ui/               # 浏览器直接访问的 UI 素材
└── asset-manifest.json

src/assets/
└── visualAssets.ts   # 代码中使用的资源路径和参考图坐标基准

src/styles/
├── tokens.css        # 颜色、阴影、边框、背景图等设计变量
└── global.css        # 全局样式与当前骨架页面样式
```

## 当前选定素材

- 当前主背景：`/assets/backgrounds/malacca_background_clean.png`
- 视觉参考图：`/assets/reference/ui_reference_selected_clean.png`

当前主背景来自用户在第 5 步上传的新图，尺寸为 `1535 x 1024`，用于实际沙盘底图。视觉参考图保留第 1 步确认的完整 UI 截图，尺寸为 `1536 x 1024`，用于对齐 HUD 面板、按钮和模块位置。

## 参考图布局基准

参考图被拆成五个逻辑区域，坐标记录在 `src/assets/visualAssets.ts`：

- 顶部状态栏：`topBar`
- 左侧信息栏：`leftRail`
- 中央地图区域：`centerMap`
- 右侧监测栏：`rightRail`
- 底部控制区：`bottomControl`

第 4 步复刻主界面时，优先按这些区域建立响应式布局。
