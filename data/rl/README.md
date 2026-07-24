# RL 公开训练数据

`mpa_vessel_arrivals_monthly.csv` 是项目随附的离线可复现实证样例，包含 1995-01 至
2026-05 的 377 条新加坡月度到港船舶数、总吨位及同月风场特征。到港数据由新加坡海事及港务
管理局（MPA）发布；风场来自 Open-Meteo Historical Weather API 的 ERA5 海面网格，使用
1.22°N、103.75°E 的每日 10 m 最大风速，并按月汇总为 P95。该特征表达月内高风暴露，不是
港口站点实测风速。

- 数据集 ID：`d_d48c5a038904f6da3c603cd854b6c191`
- 集合 ID：`394`
- 原始页面：https://data.gov.sg/collections/394/view
- API：https://data.gov.sg/api/action/datastore_search
- ERA5 文档：https://open-meteo.com/en/docs/historical-weather-api
- 风速参数：`daily=wind_speed_10m_max`、`models=era5`、`cell_selection=sea`
- 本地快照刷新日期：2026-07-24
- 许可：Singapore Open Data Licence
- 刷新命令：`pnpm data:sync:mpa`

这份月度数据只适合验证数据适配、时序切分、算法训练和可复现性，不足以代表泊位级实时
调度。默认样例没有实测服务能力、浪高、能见度和安全事件；压力测试中的这些扰动是文档化
合成值。接入真实港口时，将 `PORT_TRAINING_DATASET_PATH` 指向 CSV 或 JSON，并提供至少
`timestamp`、`arrivals`、`gross_tonnage` 三列；可选字段见 `docs/DATASET_CONTRACT.md`。
