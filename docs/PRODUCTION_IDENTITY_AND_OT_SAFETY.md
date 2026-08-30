# 生产身份、审批与运行技术安全门禁

原有仿真控制环的双人审批、幂等回执、回退和 SHA-256 审计链仍完整保留，且只影响仿真态。新增的 `production-release-policy-decision.v1` 是独立生产政策决策点，解决“由请求体自行填写审批人 ID 和角色”不能作为生产身份证据的问题。

`POST /api/production-authority/evaluate` 要求一个完整证据包：

1. 决策 ID、创建者、动作、决策摘要和输入快照摘要。
2. 身份提供方以 Ed25519 签发的两份短时效审批断言，分别含运行操作员和安全官角色，强制人类主体、多因素认证、AAL2/AAL3、不同主体与会话、创建与审批职责分离，并绑定决策/快照/动作。
3. 由独立安全联锁设备以不同 Ed25519 信任根签发的 30 秒内新鲜回执，包含急停、通信、维护旁路和 `safeToProceed` 状态。
4. 当前变更窗口、站点验收编号、回退方案和独立安全验证编号。

信任包只存放公钥，私钥必须留在身份提供方或独立联锁设备中。策略评估不依赖来源网段或前端声明的角色，与 [NIST SP 800-207 Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final) 的按主体、资源与请求逐次认证授权原则一致；将独立联锁、急停、通信和维护状态置于数字决策之外，对应 [NIST SP 800-82 Rev. 3](https://csrc.nist.gov/pubs/sp/800/82/r3/final) 对运行技术性能、可靠性和安全特性的约束。

即使软件政策全部通过，当前端点也只返回 `releaseCandidateReady=true`；`physicalDispatchAdapterInstalled=false`、`dispatchAllowed=false`和 `productionAuthority=false` 不变。现场还需身份系统连接、公钥轮换/吊销、网络分区、硬联锁和急停验收、故障注入、回退演练与变更委员会批准，才能另行实现物理执行适配器。
