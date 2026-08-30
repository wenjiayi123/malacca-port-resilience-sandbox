# 真实港口数据只读影子接入

## 边界

本模块补齐了可交付的读取型接入门禁，不伪造运营方授权、现场传感数据或生产控制权。系统只在六类数据源同时通过授权、字段、单位、时区、新鲜度、顺序、重放与签名检查后，才原子释放只读影子快照。

六类源为：船舶自动识别系统、码头操作系统、船舶交通服务、安全监管、能源与碳计量、集疏运与水水中转。它们合成完整的 37 字段 `terminal-operations.v2` 记录，每个字段附带源系统、源记录、快照、序列、观测时间、单位和摘要血缘。

## 部署

1. 将 `config/port-profiles/operator-data-source.example.json` 复制到仓库外的受控目录。替换全部待确认项，取得数据所有者的只读影子授权，并把 `evidenceLevel` 改为 `operator-authorized`。
2. 按 `docs/schemas/operator-data-source-manifest.schema.json` 审核六个源的字段映射、单位、时区、责任人和授权期。
3. 为每个适配器创建独立的高强度密钥，通过密钥管理系统注入 `PORT_OPERATOR_SIGNING_KEYS_JSON`，不得写入仓库或浏览器 `VITE_*` 变量。
4. 配置 `PORT_OPERATOR_SOURCE_MANIFEST_PATH` 和 `PORT_OPERATOR_INTEGRATION_STATE_FILE`，生产服务建议使用专用只写运行目录。
5. 数据源通过 `POST /api/operator-integration/snapshots` 发送 `operator-snapshot.v1`；状态与只读快照分别由 `GET /api/operator-integration/status` 和 `GET /api/operator-integration/shadow-snapshot` 读取。

## 签名与重放保护

1. 对 `payload` 做键名递归排序的规范 JSON 序列化，计算 SHA-256，填入 `payload_sha256`。
2. 对除 `signature` 外的整个信封做同样的规范 JSON 序列化。
3. 使用该适配器独立密钥计算 HMAC-SHA-256，以小写十六进制写入 `signature`。
4. `snapshot_id` 必须唯一，`sequence` 必须按适配器严格递增。相同快照和摘要可幂等重试，冲突摘要或序列回退会被拒绝。

## 存储与故障边界

持久化文件只保留数据血缘、签名结果、时间、序列和摘要，不保留原始运营载荷。进程重启后必须由六个源重发新鲜快照，防止用历史摘要冒充当前态。任一源过期、缺失或时间不对齐时，快照端点返回 409 且不释放任何运营数值。

## 验证

```bash
node --experimental-strip-types --experimental-specifier-resolution=node scripts/integration/runOperatorDataReadiness.ts
node --experimental-strip-types --experimental-specifier-resolution=node scripts/integration/verifyOperatorDataReadiness.ts
```

自动化证据只使用受控测试夹具，结果在 `reports/operator-data-readiness-v1.json` 中明确标记 `connectedToRealPort=false` 和 `siteDeliveryReady=false`。真实现场仍需身份角色绑定、独立运行技术联锁、规定时长影子运行、回退演练与运营方验收。
