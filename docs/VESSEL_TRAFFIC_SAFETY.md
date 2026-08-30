# 船舶交通安全与多源态势门禁

系统现可对船舶自动识别系统、雷达、船舶交通服务与光电/红外观测做身份分组、新鲜度检查、精度加权融合和源间冲突检测，并以最近会遇距离（DCPA）和到达最近会遇点时间（TCPA）生成船舶对风险。`POST /api/vessel-traffic/assess` 接受结构化观测数组。

模块遵守两个关键边界：

- 不用单一源或相互冲突的“稀少信息”作出权威避碰判断，此类船舶对标记为 `INSUFFICIENT_DATA`。
- 即使 DCPA/TCPA 进入警告或紧急阈值，输出也只是 `VTS_OPERATOR_REVIEW`；不产生舵令、不触发自动操船，不代替船长、驾驶台或船舶交通服务操作员。

这与 [IMO 船舶交通服务指南 A.1158(32)](https://www.imo.org/en/ourwork/safety/pages/vesseltrafficservices.aspx) 的安全、效率、环境保护与参与船舶协作边界保持一致；也遵循 [IMO COLREGs Rule 7](https://www.imo.org/en/about/conventions/pages/colreg.aspx) 不应依据稀少信息做假设的原则。它未经任何国家船舶交通服务机构认证，不得宣称为值班系统或 COLREGs 决策系统。

现场交付还需雷达标定、覆盖区与盲区验收、航道/分道通航制几何、船型动态域标定、警报疲劳测试、值班工作流、语音通信与现场演练。
