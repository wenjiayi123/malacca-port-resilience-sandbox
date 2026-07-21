# RL 公开训练数据

`mpa_vessel_arrivals_monthly.csv` 是项目随附的离线可复现实证样例，包含 1995-01 至
2026-05 的 377 条新加坡月度到港船舶数与总吨位。原始数据由新加坡海事及港务管理局（MPA）
发布，来自 data.gov.sg 的 `Vessel Arrivals (>75 GT) Total, Monthly` 数据集。

- 数据集 ID：`d_d48c5a038904f6da3c603cd854b6c191`
- 集合 ID：`394`
- 原始页面：https://data.gov.sg/collections/394/view
- API：https://data.gov.sg/api/action/datastore_search
- 本地快照提取日期：2026-07-20
- 许可：Singapore Open Data Licence
- 刷新命令：`pnpm data:sync:mpa`

这份月度数据只适合验证数据适配、时序切分、算法训练和可复现性，不足以代表泊位级实时
调度。接入真实港口时，将 `PORT_TRAINING_DATASET_PATH` 指向 CSV 或 JSON，并提供至少
`timestamp`、`arrivals`、`gross_tonnage` 三列；可选字段见 `docs/DATASET_CONTRACT.md`。
