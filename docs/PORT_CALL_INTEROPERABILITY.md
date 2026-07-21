# 港口靠泊事件互操作边界

仓库提供 `port-call-event.v1` 归一化合同及 `POST /api/port-calls/validate` 校验接口，供 TOS、VTS、
PCS、AIS 网关或历史事件包接入。JSON Schema 位于
`docs/schemas/port-call-event.schema.json`。

## 设计映射

| 本项目字段 | 外部语义 | 用途 |
|---|---|---|
| `portCallID` / `vesselVisitReference` | 一次靠港及船舶访问稳定标识 | 关联同一次访问的多类事件 |
| `UNLocationCode` | UN/LOCODE 港口标识 | 切换港口与跨系统匹配 |
| `portCallServiceTypeCode` | 泊位、引航、拖轮、系泊等服务类型 | 将事件分派给对应资源模型 |
| `eventTypeCode` | 到达、离开、开始、结束 | 建立事件时序 |
| `eventClassifierCode` | 预计、请求、计划、实际 | 禁止把计划时间误当实际标签 |
| `eventDateTime` | 带时区的 ISO 8601 时间 | 排序、切分和延误计算 |
| `facility` | 泊位、锚地、引航点、码头 | 资源和空间映射 |
| `source` / `quality` | 来源、记录号、采集时间、质量 | 证据链和审计 |

字段命名和事件分类与 DCSA Port Call 数据交换的主要概念保持可映射；服务交换可作为 IALA
S-211 适配器的输入边界；申报类字段可由 IMO Maritime Single Window 网关在外部转换。本项目
没有执行这些组织的官方一致性测试，因此不得宣称 DCSA、IALA 或 IMO 合规。

## 接入顺序

1. 上游保留原始事件，不覆盖计划值和实际值。
2. 适配器转换为 `port-call-event.v1`，补齐来源与质量码。
3. 调用校验接口；422 表示合同不通过，禁止静默丢字段。
4. 以 `UNLocationCode`/稳定 `port_id` 生成训练表；同一港口同一采样时刻不得重复。
5. 训练表仍遵循 `DATASET_CONTRACT.md` 的 Train/Validation/Test 时间边界。

生产环境还应实现身份认证、消息签名、幂等键、重放保护、审计留存及港口自己的数据保留策略。
