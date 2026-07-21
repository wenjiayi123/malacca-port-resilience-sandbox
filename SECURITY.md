# 安全策略

## 报告漏洞

请通过 GitHub Security Advisory 私下报告安全问题，不要在公开 Issue 中发布 Token、港口地址、
生产接口响应或可利用细节。维护者确认后会给出修复与披露时间表。

## 支持范围

安全更新针对当前 `main` 分支。演示导出包、软著材料和外部 Godot 工程不在本仓库安全支持范围内。

## 部署注意

- 所有 AIS/TOS/VTS、AI 和训练服务凭据只能放在环境变量或密钥管理系统中。
- 独立服务监听 `127.0.0.1` 时可不设令牌；监听其他地址时会拒绝启动，除非配置 `PORT_API_TOKEN`。
- 生产反向代理仍应启用 TLS、身份提供方/RBAC、审计留存和网络访问控制；内置 Bearer Token 是最小门槛，不是完整 IAM。
- 浏览器端 Token 输入只适合本地调试；生产环境应由服务器端网关持有凭据。
- `/api/observability/metrics`、任务列表、检查点和策略接口在设置 Token 后均受保护；`/healthz`、`/readyz`、RL health 与 OpenAPI 保持探针可读。
- `POST /api/rl/inference` 的输出必须经过容量、安全和人工确认约束，禁止直接驱动生产设备。
- Open-Meteo 与公开统计不能替代航海通告、雷达、ECDIS 或港口生产系统。
