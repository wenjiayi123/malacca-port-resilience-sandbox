# 控制算法基准说明

当前可声明的能力是：数据校准的离散港口控制环境、四种真实 RL 值函数方法、一个 MPC 控制
理论基线、时间留出评估、检查点和 trace 回放。

不能声明的能力包括：已训练 MAPPO/PPO/SAC、深度 Actor/Critic、GPU 训练、分布式
EnvRunner、生产港口私有数据训练、校准后的概率预测或无人值守生产下发。

详细实现、指标和扩展条件见 [RL_ARCHITECTURE.md](./RL_ARCHITECTURE.md)。生产级深度 RL 若要
接入，必须实现相同 Job API、数据隔离、检查点与评估证据，接入前不得只在 UI 中添加算法名称。
