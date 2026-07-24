# 第 9 步：航道与船流动画数据

## 完成内容

- 扩展 `RouteOverlay`，新增航线名称、关联航道、起终点港口、船舶流量、平均航速、延误、碳排和动画周期。
- 扩展 `VesselMarker`，新增船名、IMO 编号、绑定航道流、目标港口、进度、单船小时碳排和动画延迟。
- 补齐 5 条马六甲核心航道流数据。
- 补齐 7 艘示例动态船舶数据。
- 将地图船舶从固定 HTML 点位改为 SVG `animateMotion` 动态船流。
- 左侧“航道通航状态”新增延误分钟显示。
- 新增 `shippingFlowMetrics` 导出，便于后续拥堵推演和碳排核算模块复用。

## 涉及文件

- `src/types/sandbox.ts`
- `src/data/malaccaScenario.ts`
- `src/App.tsx`
- `src/styles/global.css`
- `docs/data_model.md`
- `docs/shipping_flow_animation.md`

## 下一步

第 10 步已调整为“态势总览首页指标”，先完成实时船舶总数、今日过境船舶、吞吐量、碳排放和网络韧性指数的首页展示。
