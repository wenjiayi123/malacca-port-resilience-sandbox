import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  approveOperationalDecision,
  createOperationalDecision,
  executeOperationalDecision,
  fetchOperationalAudit,
  fetchOperationalModels,
  fetchOperationalRecommendations,
  fetchOperationsSnapshot,
  fetchXiaoyiOperationalHandoff,
  injectOperationalScenario,
  rollbackOperationalDecision,
  setOperationalSimulatorRunning,
  type AuditTrail,
  type ModelRegistry,
  type OperationalControllerId,
  type OperationalDecision,
  type OperationalRecommendationResponse,
  type OperationalScenarioId,
  type PortOperationsSnapshot,
  type XiaoyiOperationalHandoff,
} from '../integrations/operationsControlAdapter';
import type { TelemetryField } from '../../shared/portTelemetryContract';

interface OperationalEvidenceCenterProps {
  authToken?: string;
}

type EvidenceTabId = 'live' | 'twin' | 'forecast' | 'decision' | 'lineage' | 'governance' | 'models' | 'audit' | 'adapters';

const tabs: Array<{ id: EvidenceTabId; label: string }> = [
  { id: 'live', label: '实时遥测' },
  { id: 'twin', label: '数字孪生' },
  { id: 'forecast', label: '预测模型' },
  { id: 'decision', label: '策略闭环' },
  { id: 'lineage', label: '数据血缘' },
  { id: 'governance', label: '安全治理' },
  { id: 'models', label: '模型版本' },
  { id: 'audit', label: '审计回放' },
  { id: 'adapters', label: '现场适配' },
];

const scenarioLabels: Record<OperationalScenarioId, string> = {
  normal: '正常运行',
  'peak-arrivals': '到港高峰',
  'channel-closure': '封航',
  'equipment-failure': '设备故障',
  'extreme-weather': '极端天气',
  'channel-congestion': '航道拥堵/传感器漂移',
  'yard-saturation': '堆场饱和',
  'data-loss': '数据失联',
};

const controllerLabels: Record<OperationalControllerId, string> = {
  fcfs: 'FCFS 先到先服务',
  'port-sop': '港口 SOP 代理',
  'operations-research': '运筹枚举优化',
  mpc: 'MPC 滚动优化',
  'rl-checkpoint': 'RL 已完成检查点',
};

const kpiLabels: Record<string, string> = {
  queue_vessels: '排队船舶',
  delay_minutes: '平均延误',
  throughput_teu: '区间吞吐',
  energy_kwh: '区间能耗',
  peak_grid_kw: '峰值负荷',
  cost_myr: '区间成本',
  carbon_tons: '区间碳排',
  service_level_percent: '服务履约',
  safety_risk_percent: '安全风险',
  resilience_index: '韧性指数',
};

const formatValue = (field?: TelemetryField) => {
  if (!field || field.value === null) return '--';
  if (typeof field.value === 'number') return Number.isInteger(field.value)
    ? field.value.toLocaleString('zh-CN')
    : field.value.toFixed(2);
  if (typeof field.value === 'boolean') return field.value ? '是' : '否';
  return String(field.value);
};

const shortHash = (value?: string) => value ? `${value.slice(0, 12)}…${value.slice(-6)}` : '--';

export function OperationalEvidenceCenter({ authToken = '' }: OperationalEvidenceCenterProps) {
  const [activeTab, setActiveTab] = useState<EvidenceTabId>('live');
  const [snapshot, setSnapshot] = useState<PortOperationsSnapshot | null>(null);
  const [recommendations, setRecommendations] = useState<OperationalRecommendationResponse | null>(null);
  const [decision, setDecision] = useState<OperationalDecision | null>(null);
  const [audit, setAudit] = useState<AuditTrail | null>(null);
  const [models, setModels] = useState<ModelRegistry | null>(null);
  const [handoff, setHandoff] = useState<XiaoyiOperationalHandoff | null>(null);
  const [statusMessage, setStatusMessage] = useState('正在读取后端权威运行状态');
  const [controlError, setControlError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const [snapshotResult, recommendationResult, auditResult, modelResult] = await Promise.allSettled([
      fetchOperationsSnapshot(authToken, signal),
      fetchOperationalRecommendations(authToken, signal),
      fetchOperationalAudit(authToken, signal),
      fetchOperationalModels(authToken, signal),
    ]);
    if (snapshotResult.status === 'fulfilled') {
      setSnapshot(snapshotResult.value);
      setStatusMessage(`后端 tick ${snapshotResult.value.sequence} · ${snapshotResult.value.event_time}`);
    }
    if (recommendationResult.status === 'fulfilled') {
      setRecommendations(recommendationResult.value);
      setControlError(null);
    } else if (!(recommendationResult.reason instanceof DOMException && recommendationResult.reason.name === 'AbortError')) {
      setRecommendations(null);
      setControlError(recommendationResult.reason instanceof Error ? recommendationResult.reason.message : '策略门禁阻断');
    }
    if (auditResult.status === 'fulfilled') setAudit(auditResult.value);
    if (modelResult.status === 'fulfilled') setModels(modelResult.value);
  }, [authToken]);

  useEffect(() => {
    const controller = new AbortController();
    const initialTimer = window.setTimeout(() => void refresh(controller.signal), 0);
    const timer = window.setInterval(() => void refresh(controller.signal), 5_000);
    return () => {
      controller.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const fields = useMemo(() => snapshot
    ? Object.entries(snapshot.operationalTelemetry).flatMap(([domain, domainFields]) =>
        Object.entries(domainFields).map(([name, field]) => ({ domain, name, field })))
    : [], [snapshot]);

  const runAction = async (label: string, action: () => Promise<unknown>) => {
    setBusy(true);
    setControlError(null);
    setStatusMessage(`${label}处理中`);
    try {
      await action();
      setStatusMessage(`${label}已由后端确认`);
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label}失败`;
      setControlError(message);
      setStatusMessage(`${label}未通过门禁`);
    } finally {
      setBusy(false);
    }
  };

  const createDecision = (controllerId: OperationalControllerId) => runAction('创建决策', async () => {
    const next = await createOperationalDecision(controllerId, authToken);
    setDecision(next);
  });

  const approveDecision = () => decision && runAction('双人审批', async () => {
    setDecision(await approveOperationalDecision(decision.decision_id, authToken));
  });

  const executeDecision = () => decision && runAction('模拟执行', async () => {
    const result = await executeOperationalDecision(decision.decision_id, authToken);
    setDecision(result.decision);
  });

  const rollbackDecision = () => decision && runAction('回滚', async () => {
    setDecision(await rollbackOperationalDecision(decision.decision_id, authToken));
  });

  const injectScenario = (scenario: OperationalScenarioId) => runAction(`注入${scenarioLabels[scenario]}`, async () => {
    setSnapshot(await injectOperationalScenario(scenario, authToken));
    if (scenario === 'data-loss') setRecommendations(null);
  });

  const generateHandoff = () => runAction('生成小懿交班报告', async () => {
    setHandoff(await fetchXiaoyiOperationalHandoff(authToken));
  });

  if (!snapshot) {
    return (
      <section className="operational-evidence-center operational-evidence-center--loading">
        <strong>证据与闭环中心正在连接后端</strong>
        <span>{controlError ?? statusMessage}</span>
      </section>
    );
  }

  return (
    <section className="operational-evidence-center" data-sequence={snapshot.sequence}>
      <header className="operational-evidence-header">
        <div>
          <small>PORT OPERATIONS CONTROL ROOM · {snapshot.protocolVersion}</small>
          <strong>真实数据边界、模型推理与人机执行闭环</strong>
          <span>{statusMessage}</span>
        </div>
        <div
          className="operational-truth-badges"
          aria-label="真实性状态：公开数据校准实时模拟；模型真实推理输出；待切换现场数据源"
        >
          {snapshot.truth_labels.map((label, index) => (
            <b className={`truth-badge truth-badge--${index}`} key={label}>{label}</b>
          ))}
        </div>
        <div className="operational-run-meta">
          <span><small>run_id</small><strong>{snapshot.run_id}</strong></span>
          <span><small>snapshot</small><strong>{shortHash(snapshot.snapshot_hash)}</strong></span>
          <span><small>scenario</small><strong>{scenarioLabels[snapshot.simulator.scenario]}</strong></span>
        </div>
      </header>

      <nav className="operational-evidence-tabs" aria-label="证据与闭环页面">
        {tabs.map((tab) => (
          <button
            aria-pressed={activeTab === tab.id}
            className={activeTab === tab.id ? 'is-active' : ''}
            data-evidence-tab={tab.id}
            data-xiaoyi-action={`evidence-tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {controlError && (
        <div className="operational-gate-error" role="alert">
          <strong>失败关闭门禁</strong>
          <span>{controlError}</span>
          <em>production_authority=false · dispatch_allowed=false</em>
        </div>
      )}

      <div className="operational-evidence-body">
        {activeTab === 'live' && (
          <div className="operational-live-grid">
            <section className="operational-kpi-grid" aria-label="实时业务 KPI">
              {Object.entries(snapshot.kpis).map(([key, value]) => (
                <span key={key}>
                  <small>{kpiLabels[key] ?? key}</small>
                  <strong>{Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</strong>
                  <em>后端 tick {snapshot.sequence}</em>
                </span>
              ))}
            </section>
            <section className="operational-domain-grid" aria-label="现场数据域">
              {Object.entries(snapshot.operationalTelemetry).map(([domain, domainFields]) => (
                <article key={domain}>
                  <header><strong>{domain}</strong><em>{Object.keys(domainFields).length} fields</em></header>
                  <ul>
                    {Object.entries(domainFields).slice(0, 6).map(([name, field]) => (
                      <li key={name}>
                        <span>{name}</span>
                        <strong>{formatValue(field)} <em>{field.unit}</em></strong>
                        <i className={`quality-${field.quality_status}`}>{field.quality_status}</i>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </section>
          </div>
        )}

        {activeTab === 'twin' && (
          <div className="operational-twin-layout">
            <section>
              <header><strong>数字孪生状态</strong><em>物理/业务守恒</em></header>
              <div className="operational-check-grid">
                {snapshot.quality.consistency_checks.map((check) => (
                  <span className={check.passed ? 'is-passed' : 'is-failed'} key={check.id}>
                    <small>{check.id}</small>
                    <strong>{check.passed ? '通过' : '失败'}</strong>
                    <em>{check.detail}</em>
                  </span>
                ))}
              </div>
            </section>
            <section>
              <header><strong>船舶 / AIS 状态机</strong><em>{snapshot.assets.vessels.length} 个可审计代表资产</em></header>
              <table>
                <thead><tr><th>资产</th><th>船型</th><th>航速</th><th>航向</th><th>ETA</th><th>状态</th></tr></thead>
                <tbody>
                  {snapshot.assets.vessels.map((vessel) => (
                    <tr key={String(vessel.asset_id)}>
                      <td>{String(vessel.asset_id)}</td>
                      <td>{formatValue(vessel.vessel_type as TelemetryField)}</td>
                      <td>{formatValue(vessel.speed_over_ground_knots as TelemetryField)} kn</td>
                      <td>{formatValue(vessel.course_over_ground_deg as TelemetryField)}°</td>
                      <td>{String((vessel.eta as TelemetryField)?.value ?? '--').slice(11, 19)}</td>
                      <td>{formatValue(vessel.navigation_state as TelemetryField)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}

        {activeTab === 'forecast' && (
          <div className="operational-forecast-layout">
            <section className="forecast-model-card">
              <small>{snapshot.forecast.output_status}</small>
              <strong>{snapshot.forecast.model.id}</strong>
              <span>α={snapshot.forecast.model.alpha} · train {snapshot.forecast.model.trainRows} · validation {snapshot.forecast.model.validationRows}</span>
              <span>训练 RMSE {snapshot.forecast.model.trainRmseVesselsPerMonth} / 验证 RMSE {snapshot.forecast.model.validationRmseVesselsPerMonth} 艘/月</span>
              <code>{snapshot.forecast.model.hash}</code>
              <p>{snapshot.forecast.model.limitation}</p>
            </section>
            <section className="forecast-points">
              {snapshot.forecast.points.map((point) => (
                <article key={point.horizon_minutes}>
                  <header><strong>+{point.horizon_minutes} min</strong><em>后端模型输出</em></header>
                  <span><small>到港</small><b>{point.arrivals}</b></span>
                  <span><small>队列</small><b>{point.queue_vessels}</b></span>
                  <span><small>延误</small><b>{point.delay_minutes} min</b></span>
                  <span><small>能耗</small><b>{point.energy_kwh} kWh</b></span>
                  <span><small>碳排</small><b>{point.carbon_tons} t</b></span>
                </article>
              ))}
            </section>
          </div>
        )}

        {activeTab === 'decision' && (
          <div className="operational-decision-layout">
            <section className="candidate-list">
              <header><strong>同一实时输入的强基线对照</strong><em>{shortHash(recommendations?.input_snapshot_hash)}</em></header>
              {recommendations?.candidates.map((candidate) => (
                <article className={candidate.eligible ? '' : 'is-blocked'} key={candidate.controller_id}>
                  <div>
                    <strong>{controllerLabels[candidate.controller_id]}</strong>
                    <span>{candidate.action_label}</span>
                    <small>{candidate.evidence}</small>
                  </div>
                  <span><small>目标值</small><b>{candidate.objective_value}</b></span>
                  <span><small>预测延误</small><b>{candidate.projected_kpis.delay_minutes} min</b></span>
                  <span><small>预测吞吐</small><b>{candidate.projected_kpis.throughput_teu} TEU</b></span>
                  <button
                    disabled={busy || !candidate.eligible}
                    onClick={() => void createDecision(candidate.controller_id)}
                    type="button"
                  >
                    {candidate.eligible ? '创建待审批决策' : candidate.rejection_reason}
                  </button>
                </article>
              )) ?? <p>数据质量门禁阻断，不能生成策略。</p>}
            </section>
            <section className="decision-lifecycle">
              <header><strong>决策生命周期</strong><em>{decision?.status ?? '尚未创建'}</em></header>
              {decision ? (
                <>
                  <dl>
                    <div><dt>decision_id</dt><dd>{decision.decision_id}</dd></div>
                    <div><dt>controller</dt><dd>{controllerLabels[decision.controller_id]}</dd></div>
                    <div><dt>action</dt><dd>{decision.recommended_action}</dd></div>
                    <div><dt>input</dt><dd>{shortHash(decision.input_snapshot_hash)}</dd></div>
                    <div><dt>dataset</dt><dd>{shortHash(decision.dataset_hash)}</dd></div>
                    <div><dt>model</dt><dd>{shortHash(decision.model_hash)}</dd></div>
                    <div><dt>安全投影</dt><dd>{decision.projected_action.modified ? '动作已修改' : '动作位于软件安全包络内'}</dd></div>
                    <div><dt>审批</dt><dd>{decision.approvals.length}/2</dd></div>
                  </dl>
                  <div className="decision-actions">
                    <button disabled={busy || decision.status !== 'pending_approval'} onClick={() => void approveDecision()} type="button">双人审批</button>
                    <button disabled={busy || decision.status !== 'approved'} onClick={() => void executeDecision()} type="button">模拟执行并取回执</button>
                    <button disabled={busy || decision.status !== 'executed'} onClick={() => void rollbackDecision()} type="button">回滚</button>
                  </div>
                  {decision.receipt && (
                    <div className="execution-receipt">
                      <strong>{decision.receipt.receipt_id}</strong>
                      <span>{decision.receipt.executor} · {decision.receipt.status}</span>
                      <ul>
                        {Object.entries(decision.receipt.kpi_delta).slice(0, 8).map(([key, value]) => (
                          <li key={key}><span>{kpiLabels[key] ?? key}</span><b>{value > 0 ? '+' : ''}{value}</b></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : <p>从左侧任选一个已通过门禁的控制器，后端会先生成安全投影，再进入双人审批。</p>}
            </section>
          </div>
        )}

        {activeTab === 'lineage' && (
          <div className="operational-lineage-layout">
            <section className="lineage-summary">
              <span><small>字段总数</small><strong>{snapshot.quality.total_fields}</strong></span>
              <span><small>正常</small><strong>{snapshot.quality.normal_fields}</strong></span>
              <span><small>降级</small><strong>{snapshot.quality.degraded_fields}</strong></span>
              <span><small>实测</small><strong>{snapshot.quality.measured_fields}</strong></span>
              <span><small>模拟</small><strong>{snapshot.quality.simulated_fields}</strong></span>
              <span><small>派生</small><strong>{snapshot.quality.derived_fields}</strong></span>
              <span><small>完整率</small><strong>{snapshot.quality.completeness_percent}%</strong></span>
            </section>
            <table>
              <thead><tr><th>域/字段</th><th>值</th><th>来源类型</th><th>来源 ID</th><th>质量</th><th>置信度</th><th>时标</th><th>trace_id</th></tr></thead>
              <tbody>
                {fields.map(({ domain, name, field }) => (
                  <tr key={`${domain}-${name}`}>
                    <td>{domain}.{name}</td>
                    <td>{formatValue(field)} {field.unit}</td>
                    <td>{field.source_type}</td>
                    <td>{field.source_id}</td>
                    <td><i className={`quality-${field.quality_status}`}>{field.quality_status}</i></td>
                    <td>{Math.round(field.confidence * 100)}%</td>
                    <td>{field.event_time.slice(0, 19)}</td>
                    <td>{field.trace_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'governance' && (
          <div className="operational-governance-layout">
            <section className="authority-boundary">
              <header><strong>生产权限边界</strong><em>强制失败关闭</em></header>
              {Object.entries(snapshot.authority).map(([key, value]) => (
                <span className={value ? 'is-true' : 'is-false'} key={key}><small>{key}</small><strong>{String(value)}</strong></span>
              ))}
              <p>模拟闭环可运行；生产下发必须完成现场映射、标定、影子运行、联锁和回滚演练。</p>
            </section>
            <section className="scenario-controls">
              <header><strong>异常与极端场景注入</strong><em>当前：{scenarioLabels[snapshot.simulator.scenario]}</em></header>
              <div>
                {(Object.keys(scenarioLabels) as OperationalScenarioId[]).map((scenario) => (
                  <button
                    aria-pressed={snapshot.simulator.scenario === scenario}
                    disabled={busy}
                    key={scenario}
                    onClick={() => void injectScenario(scenario)}
                    type="button"
                  >
                    {scenarioLabels[scenario]}
                  </button>
                ))}
              </div>
              <div className="simulator-controls">
                <button disabled={busy || snapshot.simulator.running} onClick={() => void runAction('启动模拟器', () => setOperationalSimulatorRunning(true, authToken))} type="button">启动模拟器</button>
                <button disabled={busy || !snapshot.simulator.running} onClick={() => void runAction('停止模拟器', () => setOperationalSimulatorRunning(false, authToken))} type="button">停止并验证失败关闭</button>
              </div>
            </section>
            <section className="security-envelope">
              <header><strong>软件安全包络</strong><em>动作白名单</em></header>
              <ul>
                {(recommendations?.candidates[0]?.constraints ?? [
                  'single-step deferral <= 2%',
                  'single-step diversion <= 1%',
                  'temporary capacity uplift <= 2%',
                  'battery SOC 15%-95%',
                  'transformer loading <= 100%',
                  'simulation only; production dispatch disabled',
                ]).map((constraint) => <li key={constraint}>{constraint}</li>)}
              </ul>
            </section>
            <section className="xiaoyi-operational-handoff">
              <header>
                <strong>小懿运行解释与交班</strong>
                <em>{handoff?.xiaoyi_model.status ?? '尚未生成'}</em>
              </header>
              <button
                aria-busy={busy}
                data-xiaoyi-action="xiaoyi-operational-handoff"
                data-xiaoyi-state={busy ? 'loading' : handoff ? 'ready' : 'idle'}
                disabled={busy}
                onClick={() => void generateHandoff()}
                type="button"
              >
                {busy ? '正在生成并校验证据' : handoff ? '重新基于最新快照生成' : '基于当前后端快照生成'}
              </button>
              {handoff ? (
                <div>
                  <p>{handoff.state_summary}</p>
                  <ul>{handoff.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  <span><small>建议</small><strong>{handoff.strategy.action_label}</strong><em>{handoff.strategy.evidence}</em></span>
                  <span><small>门禁</small><strong>{handoff.shift_handoff.gate_status}</strong><em>待审批 {handoff.shift_handoff.pending_decisions}</em></span>
                  {handoff.xiaoyi_model.answer && <blockquote>{handoff.xiaoyi_model.answer}</blockquote>}
                  <p className="handoff-disclosure">{handoff.xiaoyi_model.disclosure}</p>
                  <code>{shortHash(handoff.input_snapshot_hash)} · traces {handoff.evidence.trace_ids.length}</code>
                </div>
              ) : <p>点击后读取同一权威快照。未配置或无法调用模型时只展示后端规则底稿，并明确标注，绝不伪装成模型输出。</p>}
            </section>
          </div>
        )}

        {activeTab === 'models' && (
          <div className="operational-model-grid">
            {models?.models.map((model) => (
              <article className={`model-status-${model.status}`} key={model.id}>
                <header><strong>{model.id}</strong><em>{model.status}</em></header>
                <span>{model.family}</span>
                <dl>
                  <div><dt>version</dt><dd>{model.version}</dd></div>
                  <div><dt>run_id</dt><dd>{model.run_id}</dd></div>
                  {model.model_hash && <div><dt>model</dt><dd>{shortHash(model.model_hash)}</dd></div>}
                  {model.dataset_hash && <div><dt>dataset</dt><dd>{shortHash(model.dataset_hash)}</dd></div>}
                  {model.config_hash && <div><dt>config</dt><dd>{shortHash(model.config_hash)}</dd></div>}
                  {model.evidence_artifact && <div><dt>artifact</dt><dd>{model.evidence_artifact}</dd></div>}
                </dl>
                <p>{model.evidence_scope}</p>
                {model.rejection_reason && <b>{model.rejection_reason}</b>}
              </article>
            )) ?? <p>模型注册表正在加载。</p>}
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="operational-audit-layout">
            <header>
              <span><small>链验证</small><strong>{audit?.verified ? 'SHA-256 通过' : '未通过/待生成'}</strong></span>
              <span><small>记录数</small><strong>{audit?.record_count ?? 0}</strong></span>
              <span><small>head_hash</small><strong>{shortHash(audit?.head_hash)}</strong></span>
            </header>
            <ol>
              {audit?.records.map((record) => (
                <li key={record.hash}>
                  <span>#{record.sequence}</span>
                  <strong>{record.event_type}</strong>
                  <em>{record.audit_time}</em>
                  <code>{shortHash(record.hash)}</code>
                  <small>{record.correlation_id}</small>
                </li>
              )) ?? null}
            </ol>
            {!audit?.record_count && <p>创建决策或注入场景后，这里会显示追加式审计记录。</p>}
          </div>
        )}

        {activeTab === 'adapters' && (
          <div className="operational-adapter-layout">
            <section>
              <header><strong>稳定接口合同</strong><em>只替换适配器，不重做业务链</em></header>
              <p>{snapshot.calibration.cross_port_reference}</p>
              <div className="adapter-hashes">
                <span><small>dataset_sha256</small><code>{snapshot.calibration.datasets[0]?.hash}</code></span>
                <span><small>model_sha256</small><code>{snapshot.calibration.model_hash}</code></span>
                <span><small>config_sha256</small><code>{snapshot.calibration.config_hash}</code></span>
              </div>
            </section>
            <section className="adapter-grid">
              {[
                ['AIS', '公开 AIS 研究分布校准船流', '授权 AIS/NMEA/IALA 适配器'],
                ['TOS', 'MPA 月度到港校准作业模拟器', '船期、泊位、箱流、作业任务适配器'],
                ['VTS', '潮窗、航道、引拖工程状态机', 'VTS、引航、拖轮、通航计划适配器'],
                ['PLC/SCADA', '设备状态机与故障引擎', '岸桥、场桥、AGV、闸口实时适配器'],
                ['EMS/BMS/BA', '能源、储能和楼宇物理模型', '电表、EMS、BMS、BA 现场适配器'],
              ].map(([id, current, replacement]) => (
                <article key={id}>
                  <strong>{id}</strong>
                  <span><small>当前</small>{current}</span>
                  <span><small>接港替换</small>{replacement}</span>
                </article>
              ))}
            </section>
            <section className="calibration-datasets">
              {snapshot.calibration.datasets.map((dataset) => (
                <article key={dataset.id}>
                  <strong>{dataset.id}</strong>
                  <span>{dataset.role}</span>
                  <em>{dataset.evidence}</em>
                  <code>{dataset.hash}</code>
                </article>
              ))}
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
