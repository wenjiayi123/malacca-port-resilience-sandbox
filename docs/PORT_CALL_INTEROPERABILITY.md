# 港口靠泊事件互操作边界

仓库提供 `port-call-event.v1` 归一化合同及 `POST /api/port-calls/validate` 校验接口，供码头操作系统、船舶交通服务、港口社区系统、船舶自动识别系统网关或历史事件包接入。其上新增 `port-community-message.v1` 签名信封，通过 `POST /api/port-community/messages` 处理靠港事件、五类机关放行状态与回执。

JSON Schema 位于 `docs/schemas/port-call-event.schema.json` 和 `docs/schemas/port-community-message.schema.json`。

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

字段命名和计划/请求/预计/实际时间分类与 [DCSA Port Call 2.0](https://dcsa.org/standards/port-call/documentation-port-call) 的主要概念保持可映射；服务事件可投影为 [IALA S-211](https://www.iala.int/technical/data-modelling/iala-s-200-development-status/s-211/) 适配器的输入；海关、边检、卫生、安保和港口放行保留为权威机关的外生回执，可由 [IMO Maritime Single Window](https://www.imo.org/en/ourwork/facilitation/pages/maritimesinglewindow-default.aspx) 网关转换。港口代码校验五位形式，现场还必须绑定 [UNECE UN/LOCODE](https://unece.org/trade/uncefact/unlocode) 当期参考表。

项目只提供显式投影与边界，没有执行这些组织的官方一致性测试，因此不宣称 DCSA、IALA、IMO Maritime Single Window 或 UN/LOCODE 合规。

## 接入顺序

1. 上游保留原始事件，不覆盖计划值和实际值。
2. 适配器转换为 `port-call-event.v1`，补齐来源与质量码。
3. 将消息放入规范 JSON 序列化的 HMAC-SHA-256 信封，绑定发送者角色、接收者、会话、关联、幂等键、发送时间与载荷摘要。
4. 调用接入接口；422 表示合同、授权、签名、时效、角色权威或重放检查不通过，禁止静默丢字段。
5. 五类放行只能由对应机关角色签发；系统不会自动补齐、升格或把放行回执转成调度权。
6. 以 `UNLocationCode`/稳定 `port_id` 生成训练表；同一港口同一采样时刻不得重复，仍遵循 `DATASET_CONTRACT.md` 的 Train/Validation/Test 时间边界。

本地网关已实现消息签名、角色绑定、幂等键、重放保护和内存审计链。生产环境仍需由交易双方交换证书，连接实际国家 Maritime Single Window/港口社区系统，完成官方一致性测试、当期 UN/LOCODE 参考数据绑定、持久化审计与双方验收。`siteInteroperabilityAccepted` 因此默认为 `false`。
