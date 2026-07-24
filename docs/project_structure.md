# 项目结构

```text
马六甲沙盘港口推演/
├── assets/
│   ├── backgrounds/      # 沙盘背景地图与大屏底图
│   ├── icons/            # 港口、天气、告警、调度等图标
│   ├── reference/        # 用户提供的界面参考图和视觉基准图
│   ├── ships/            # 船舶贴图、尾迹、航行动效素材
│   └── ui/               # HUD 面板、按钮、边框、扫描线等 UI 素材
├── data/                 # 港口、航道、船舶、事件、推演场景数据
├── docs/                 # 项目说明、模块设计、操作手册、步骤记录
├── exports/              # 后续导出的演示程序
├── public/
│   └── assets/           # Web 运行时直接访问的视觉资源
├── scenes/
│   ├── simulation/       # 宏观网络推演与微观单船验证场景
│   └── ui/               # 顶栏、侧栏、图表、按钮等界面场景
├── scripts/
│   ├── simulation/       # 船流、拥堵、风险、碳排、调度逻辑
│   └── ui/               # UI 控制、图表刷新、交互逻辑
├── src/
│   ├── assets/           # Web 代码使用的资源清单与参考图坐标
│   └── styles/           # Web 视觉 token 与全局样式
└── tests/                # 后续轻量验证脚本
```

## 已入库素材

- `assets/reference/ui_reference_selected_clean.png`：当前选定的界面/背景视觉参考图。
- `assets/backgrounds/malacca_background_selected.png`：当前选定的沙盘背景候选图。

备注：这两个文件当前来自同一张用户最新确认的图片。后续如果提供更干净的纯背景图，只需要替换 `assets/backgrounds/malacca_background_selected.png`，界面复刻仍以 `assets/reference/ui_reference_selected_clean.png` 为准。
