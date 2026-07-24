# 第 10 步：态势总览首页指标

## 完成内容

- 完成态势总览首页 5 项核心指标：实时船舶总数、今日过境船舶、吞吐量、碳排放、网络韧性指数。
- 扩展 `MetricCard` 数据结构，新增指标口径、变化状态和状态色字段。
- 将顶部 KPI 区升级为带图标、主数值、单位、指标说明和趋势状态的总览卡片。
- 将吞吐量、碳排放和网络韧性指数作为首页首屏重点指标呈现。
- 更新 `README.md` 当前阶段和下一步说明。
- 更新 `docs/data_model.md` 中首页指标字段说明。

## 涉及文件

- `src/types/sandbox.ts`
- `src/data/malaccaScenario.ts`
- `src/App.tsx`
- `src/styles/global.css`
- `docs/data_model.md`
- `README.md`

## 下一步

第 11 步建议做“左侧港航网络总览”，完成小地图、港口数量、航道数量、锚地数量和船舶总数等展示。
