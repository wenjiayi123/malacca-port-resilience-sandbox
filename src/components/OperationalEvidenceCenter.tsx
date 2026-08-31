import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  approveOperationalDecision,
  createOperationalDecision,
  executeOperationalDecision,
  fetchOperationalAudit,
  fetchOperationalModels,
  fetchOperationalRecommendations,
  fetchOperationsSnapshot,
  fetchProductionReadiness,
  fetchRegulatoryResilience,
  fetchXiaoyiOperationalHandoff,
  injectOperationalScenario,
  injectRegulatoryScenario,
  rollbackOperationalDecision,
  setOperationalSimulatorRunning,
  type AuditTrail,
  type ModelRegistry,
  type OperationalControllerId,
  type OperationalDecision,
  type OperationalRecommendationResponse,
  type OperationalScenarioId,
  type PortOperationsSnapshot,
  type ProductionReadinessStatus,
  type RegulatoryResilienceEvidence,
  type RegulatoryScenarioId,
  type XiaoyiOperationalHandoff,
} from '../integrations/operationsControlAdapter';
import type { TelemetryField } from '../../shared/portTelemetryContract';
import {
  approvePortBusinessProposal,
  fetchPortBusinessChampionStatus,
  fetchPortBusinessDecisionReport,
  inferCurrentPortBusinessPolicy,
  type PortBusinessChampionStatus,
  type PortBusinessDecisionReport,
  type PortBusinessRuntimeDecision,
} from '../integrations/portBusinessRlAdapter';
import {
  approveCoreOperationsProposal,
  executeCoreOperationsProposal,
  fetchCoreOperationsChampionStatus,
  fetchCoreOperationsDecisionReport,
  inferCoreOperationsPolicy,
  rollbackCoreOperationsProposal,
  type CoreOperationsChampionStatus,
  type CoreOperationsDecisionReport,
  type CoreOperationsRuntimeDecision,
} from '../integrations/coreOperationsRlAdapter';

interface OperationalEvidenceCenterProps {
  authToken?: string;
  onBusinessEvidenceChange?: (evidence: {
    champion: PortBusinessChampionStatus | null;
    decision: PortBusinessRuntimeDecision | null;
    report: PortBusinessDecisionReport | null;
    coreChampion: CoreOperationsChampionStatus | null;
    coreDecision: CoreOperationsRuntimeDecision | null;
    coreReport: CoreOperationsDecisionReport | null;
  }) => void;
}

type EvidenceTabId = 'live' | 'twin' | 'forecast' | 'decision' | 'regulatory' | 'lineage' | 'governance' | 'models' | 'audit' | 'adapters';

const tabs: Array<{ id: EvidenceTabId; label: string }> = [
  { id: 'live', label: '实时遥测' },
  { id: 'twin', label: '数字孪生' },
  { id: 'forecast', label: '预测模型' },
  { id: 'decision', label: '策略闭环' },
  { id: 'regulatory', label: '监管韧性' },
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

const regulatoryScenarioLabels: Record<RegulatoryScenarioId, string> = {
  baseline: '常态监管链',
  'maritime-inspection': '海事集中检查',
  'customs-document-hold': '海关单证/查验滞留',
  'dual-inspection-recovery': '双重检查与放行恢复',
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

export function OperationalEvidenceCenter({
  authToken = '',
  onBusinessEvidenceChange,
}: OperationalEvidenceCenterProps) {
  const [activeTab, setActiveTab] = useState<EvidenceTabId>('live');
  const [snapshot, setSnapshot] = useState<PortOperationsSnapshot | null>(null);
  const [recommendations, setRecommendations] = useState<OperationalRecommendationResponse | null>(null);
  const [decision, setDecision] = useState<OperationalDecision | null>(null);
  const [audit, setAudit] = useState<AuditTrail | null>(null);
  const [models, setModels] = useState<ModelRegistry | null>(null);
  const [regulatory, setRegulatory] = useState<RegulatoryResilienceEvidence | null>(null);
  const [productionReadiness, setProductionReadiness] = useState<ProductionReadinessStatus | null>(null);
  const [handoff, setHandoff] = useState<XiaoyiOperationalHandoff | null>(null);
  const [businessChampion, setBusinessChampion] = useState<PortBusinessChampionStatus | null>(null);
  const [businessDecision, setBusinessDecision] = useState<PortBusinessRuntimeDecision | null>(null);
  const [businessReport, setBusinessReport] = useState<PortBusinessDecisionReport | null>(null);
  const [coreChampion, setCoreChampion] = useState<CoreOperationsChampionStatus | null>(null);
  const [coreDecision, setCoreDecision] = useState<CoreOperationsRuntimeDecision | null>(null);
  const [coreReport, setCoreReport] = useState<CoreOperationsDecisionReport | null>(null);
  const [statusMessage, setStatusMessage] = useState('正在读取后端权威运行状态');
  const [controlError, setControlError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const [snapshotResult, recommendationResult, auditResult, modelResult, regulatoryResult, readinessResult] = await Promise.allSettled([
      fetchOperationsSnapshot(authToken, signal),
      fetchOperationalRecommendations(authToken, signal),
      fetchOperationalAudit(authToken, signal),
      fetchOperationalModels(authToken, signal),
      fetchRegulatoryResilience(authToken, signal),
      fetchProductionReadiness(authToken, signal),
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
    if (regulatoryResult.status === 'fulfilled') setRegulatory(regulatoryResult.value);
    if (readinessResult.status === 'fulfilled') setProductionReadiness(readinessResult.value);
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

  useEffect(() => {
    const controller = new AbortController();
    void fetchPortBusinessChampionStatus(authToken, controller.signal)
      .then(setBusinessChampion)
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setControlError(error instanceof Error ? error.message : '全业务冠军证据读取失败');
        }
      });
    return () => controller.abort();
  }, [authToken]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchCoreOperationsChampionStatus(authToken, controller.signal)
      .then(setCoreChampion)
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setControlError(error instanceof Error ? error.message : '全核心联合冠军证据读取失败');
        }
      });
    return () => controller.abort();
  }, [authToken]);

  useEffect(() => {
    onBusinessEvidenceChange?.({
      champion: businessChampion,
      decision: businessDecision,
      report: businessReport,
      coreChampion,
      coreDecision,
      coreReport,
    });
  }, [businessChampion, businessDecision, businessReport, coreChampion, coreDecision, coreReport, onBusinessEvidenceChange]);

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

  const approveDecision = () => decision && runAction('模拟双人审批', async () => {
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

  const injectRegulatory = (scenario: RegulatoryScenarioId) => runAction(
    `注入${regulatoryScenarioLabels[scenario]}`,
    async () => setRegulatory(await injectRegulatoryScenario(scenario, authToken)),
  );

  const generateHandoff = () => runAction('生成小懿交班报告', async () => {
    setHandoff(await fetchXiaoyiOperationalHandoff(authToken));
  });

  const runBusinessInference = () => snapshot && runAction('33维全业务冠军推理', async () => {
    setBusinessReport(null);
    setBusinessDecision(await inferCurrentPortBusinessPolicy(snapshot, authToken));
  });

  const approveBusinessDecision = () => businessDecision && runAction('全业务模拟双岗审批', async () => {
    setBusinessDecision(await approvePortBusinessProposal(businessDecision.proposalId, authToken));
  });

  const downloadBusinessDecisionReport = () => businessDecision && runAction('生成全业务决策报告', async () => {
    const report = await fetchPortBusinessDecisionReport(businessDecision.proposalId, authToken);
    setBusinessReport(report);
    const url = URL.createObjectURL(new Blob(
      [JSON.stringify(report, null, 2)],
      { type: 'application/json;charset=utf-8' },
    ));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `port-business-decision-${report.completionStatus.toLowerCase()}-${businessDecision.proposalId}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  });

  const runCoreInference = () => runAction('全核心十域联合推理', async () => {
    setCoreReport(null);
    setCoreDecision(await inferCoreOperationsPolicy(authToken));
  });

  const approveCoreDecision = () => coreDecision && runAction('全核心联合计划模拟双岗审批', async () => {
    setCoreDecision(await approveCoreOperationsProposal(coreDecision.proposalId, authToken));
  });

  const executeCoreDecision = () => coreDecision && runAction('执行全核心联合沙盘计划', async () => {
    setCoreDecision(await executeCoreOperationsProposal(coreDecision.proposalId, authToken));
  });

  const rollbackCoreDecision = () => coreDecision && runAction('回滚全核心联合沙盘计划', async () => {
    setCoreDecision(await rollbackCoreOperationsProposal(coreDecision.proposalId, authToken));
  });

  const downloadCoreDecisionReport = () => coreDecision && runAction('生成全核心联合决策报告', async () => {
    const report = await fetchCoreOperationsDecisionReport(coreDecision.proposalId, authToken);
    setCoreReport(report);
    const url = URL.createObjectURL(new Blob(
      [JSON.stringify(report, null, 2)],
      { type: 'application/json;charset=utf-8' },
    ));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `core-operations-decision-${report.completionStatus.toLowerCase()}-${coreDecision.proposalId}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  });

  if (!snapshot) {
    return (
      <section className="operational-evidence-center operational-evidence-center--loading">
        <strong>证据与闭环中心正在连接后端</strong>
        <span>{controlError ?? statusMessage}</span>
      </section>
    );
  }

  const coreProjectionPair = (key: string) => {
    const value = coreDecision?.projectedBusinessValue[key];
    return value && typeof value === 'object' && 'before' in value && 'after' in value
      ? value as { before: number; after: number }
      : { before: 0, after: 0 };
  };

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
                    <button
                      disabled={busy || decision.status !== 'pending_approval'}
                      onClick={() => void approveDecision()}
                      title="仅使用本地操作员和安全员测试角色；不代表现场实名审批"
                      type="button"
                    >模拟双人审批（2个测试角色）</button>
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
              ) : <p>从左侧任选一个已通过门禁的控制器，后端会先生成安全投影，再进入本地测试角色模拟审批；现场实名双岗审批仍需接入身份系统。</p>}
            </section>
            <section className="port-business-runtime" aria-label="全核心十域联合强化学习运行执行链">
              <header>
                <div>
                  <small>CORE OPERATIONS RL V1 · ACTIVE RUNTIME CHAIN</small>
                  <strong>
                    {coreChampion
                      ? `${coreChampion.contract.observationCount}维观测 · ${coreChampion.contract.actionHeadCount}个并行动作头 · ${coreChampion.contract.actionChoiceCount}个有界选项 · ${coreChampion.contract.rewardComponentCount}项奖励`
                      : '正在读取全核心联合冠军证据'}
                  </strong>
                </div>
                <span className={coreChampion?.champion.admitted ? 'is-admitted' : 'is-blocked'}>
                  {coreChampion
                    ? `${coreChampion.champion.algorithmId} / ${coreChampion.champion.attemptId}`
                    : 'EVIDENCE PENDING'}
                </span>
                <button
                  disabled={busy || !coreChampion?.champion.admitted}
                  onClick={() => void runCoreInference()}
                  type="button"
                >生成十域联合计划</button>
              </header>
              {coreDecision ? (
                <div className="port-business-runtime__body">
                  <section className="port-business-runtime__decision">
                    <small>{coreDecision.admission.recommendationSource}</small>
                    <strong>{coreDecision.activeDomains.length}/10 个核心域本周期参与</strong>
                    <span>
                      {coreDecision.inference.heads.map((head) =>
                        `${head.domain}:${head.selectedChoiceId}(${(head.voteShare * 100).toFixed(0)}%)`).join(' · ')}
                    </span>
                    <em>{coreDecision.admission.status.toUpperCase()}</em>
                    {coreDecision.domainAbstentions.length > 0 && (
                      <p>低一致性动作头已各自回退保持计划：{coreDecision.domainAbstentions.join('、')}</p>
                    )}
                    {coreDecision.admission.blockers.length > 0 && (
                      <ul>{coreDecision.admission.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                    )}
                  </section>
                  <section className="port-business-runtime__metrics" aria-label="全核心联合计划价值投影">
                    <span><small>队列</small><strong>{coreProjectionPair('queueVessels').before.toFixed(2)}→{coreProjectionPair('queueVessels').after.toFixed(2)}</strong></span>
                    <span><small>延误</small><strong>{coreProjectionPair('delayMinutes').before.toFixed(2)}→{coreProjectionPair('delayMinutes').after.toFixed(2)}min</strong></span>
                    <span><small>吞吐</small><strong>{coreProjectionPair('throughputTeu').before.toFixed(1)}→{coreProjectionPair('throughputTeu').after.toFixed(1)}TEU</strong></span>
                    <span><small>堆场</small><strong>{coreProjectionPair('yardOccupancyPercent').before.toFixed(2)}→{coreProjectionPair('yardOccupancyPercent').after.toFixed(2)}%</strong></span>
                    <span><small>集卡周转</small><strong>{coreProjectionPair('truckTurnMinutes').before.toFixed(2)}→{coreProjectionPair('truckTurnMinutes').after.toFixed(2)}min</strong></span>
                    <span><small>能耗</small><strong>{coreProjectionPair('energyKwh').before.toFixed(2)}→{coreProjectionPair('energyKwh').after.toFixed(2)}kWh</strong></span>
                    <span><small>峰值</small><strong>{coreProjectionPair('peakGridKw').before.toFixed(1)}→{coreProjectionPair('peakGridKw').after.toFixed(1)}kW</strong></span>
                    <span><small>碳排</small><strong>{coreProjectionPair('carbonTons').before.toFixed(3)}→{coreProjectionPair('carbonTons').after.toFixed(3)}t</strong></span>
                    <span><small>维护到期</small><strong>{coreProjectionPair('maintenanceDueCount').before.toFixed(1)}→{coreProjectionPair('maintenanceDueCount').after.toFixed(1)}</strong></span>
                  </section>
                  <section className="port-business-runtime__approval">
                    <span>
                      <small>proposal_id</small><strong>{coreDecision.proposalId}</strong><em>{coreDecision.approval.status}</em>
                    </span>
                    <span>
                      <small>输入快照</small><strong>{shortHash(coreDecision.inputEvidence.snapshotHash)}</strong>
                      <em>实测字段 {coreDecision.inputEvidence.measuredFieldCount} · 仿真字段 {coreDecision.inputEvidence.simulatedFieldCount}</em>
                    </span>
                    <button
                      disabled={busy || coreDecision.approval.status !== 'pending_simulation_review'}
                      onClick={() => void approveCoreDecision()}
                      type="button"
                    >模拟双岗审批（测试身份）</button>
                    <button
                      disabled={busy || coreDecision.approval.status !== 'approved_for_sandbox'}
                      onClick={() => void executeCoreDecision()}
                      type="button"
                    >执行联合沙盘计划并取回执</button>
                    <button
                      disabled={busy || coreDecision.execution.status !== 'executed'}
                      onClick={() => void rollbackCoreDecision()}
                      type="button"
                    >回滚联合计划</button>
                    <button disabled={busy} onClick={() => void downloadCoreDecisionReport()} type="button">导出联合决策报告</button>
                    {coreDecision.execution.receipt && (
                      <div className="execution-receipt">
                        <strong>{coreDecision.execution.receipt.receipt_id}</strong>
                        <span>{coreDecision.execution.receipt.attribution}</span>
                        <small>同状态、同随机种子、同一时刻：新强化学习计划相对继续当前计划的沙盘差值</small>
                        <ul>
                          {Object.entries(
                            coreDecision.execution.receipt.counterfactual?.rl_vs_baseline_kpi_delta
                              ?? coreDecision.execution.receipt.kpi_delta
                              ?? {},
                          ).slice(0, 8).map(([key, value]) => (
                            <li key={key}><span>{kpiLabels[key] ?? key}</span><b>{value > 0 ? '+' : ''}{value}</b></li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p>simulation_mode=true · dispatch_allowed=false · production_authority=false；配对反事实回执隔离同一步自然演化，证明沙盘差值来自新强化学习计划，不是现场因果绩效。</p>
                  </section>
                </div>
              ) : (
                <p>当前主链会从同一后端权威快照生成十域联合计划；低一致性动作头单独回退，安全投影、模拟审批和执行回执均可审计。</p>
              )}
            </section>
            <section className="port-business-runtime" aria-label="保留的港口全业务强化学习第三版证据链">
              <header>
                <div>
                  <small>PORT BUSINESS RL V3 · RETAINED SINGLE-ACTION EVIDENCE</small>
                  <strong>保留：33维观测 · 11个有界动作 · 10项奖励 · 5随机种子冠军集成 · 单动作证据链</strong>
                </div>
                <span className={businessChampion?.champion.admitted ? 'is-admitted' : 'is-blocked'}>
                  {businessChampion
                    ? `${businessChampion.champion.algorithmId} / ${businessChampion.champion.attemptId}`
                    : '正在读取冠军证据'}
                </span>
                <button
                  disabled={busy || !businessChampion?.champion.admitted}
                  onClick={() => void runBusinessInference()}
                  type="button"
                >基于当前权威快照推理</button>
              </header>
              {businessDecision ? (
                <div className="port-business-runtime__body">
                  <section className="port-business-runtime__decision">
                    <small>{businessDecision.admission.recommendationSource}</small>
                    <strong>
                      {businessDecision.inference.actionDistribution.find(
                        (action) => action.actionId === businessDecision.admission.recommendedActionId,
                      )?.label ?? businessDecision.admission.recommendedActionId}
                    </strong>
                    <span>
                      RL首选 {businessDecision.inference.selectedAction.label} · 概率{' '}
                      {(businessDecision.inference.selectedAction.probability * 100).toFixed(1)}% · 种子一致{' '}
                      {(businessDecision.inference.selectedAction.voteShare * 100).toFixed(0)}%
                    </span>
                    <em>
                      {businessDecision.admission.status === 'admitted_for_simulation_review'
                        ? 'ADMITTED_FOR_SIMULATION_REVIEW'
                        : 'ABSTAIN_USE_DETERMINISTIC_FALLBACK'}
                    </em>
                    {businessDecision.admission.blockers.length > 0 && (
                      <ul>
                        {businessDecision.admission.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                      </ul>
                    )}
                  </section>
                  <section className="port-business-runtime__metrics" aria-label="全业务动作价值投影">
                    <span><small>队列</small><strong>{businessDecision.businessProjection.queueVessels.before.toFixed(1)}→{businessDecision.businessProjection.queueVessels.after.toFixed(1)}</strong></span>
                    <span><small>等待</small><strong>{businessDecision.businessProjection.meanWaitingHours.before.toFixed(2)}→{businessDecision.businessProjection.meanWaitingHours.after.toFixed(2)}h</strong></span>
                    <span><small>堆场</small><strong>{(businessDecision.businessProjection.yardOccupancy.before * 100).toFixed(1)}→{(businessDecision.businessProjection.yardOccupancy.after * 100).toFixed(1)}%</strong></span>
                    <span><small>闸口压力</small><strong>{businessDecision.businessProjection.gateQueuePressure.before.toFixed(2)}→{businessDecision.businessProjection.gateQueuePressure.after.toFixed(2)}</strong></span>
                    <span><small>碳强度</small><strong>{businessDecision.businessProjection.carbonIntensity.before.toFixed(3)}→{businessDecision.businessProjection.carbonIntensity.after.toFixed(3)}</strong></span>
                    <span><small>公平差距</small><strong>{businessDecision.businessProjection.fairnessGap.before.toFixed(3)}→{businessDecision.businessProjection.fairnessGap.after.toFixed(3)}</strong></span>
                    <span><small>吞吐保持</small><strong>{businessDecision.businessProjection.throughputRetentionPercent.toFixed(2)}%</strong></span>
                    <span><small>策略熵</small><strong>{businessDecision.inference.uncertainty.normalizedEntropy.toFixed(3)}</strong></span>
                  </section>
                  <section className="port-business-runtime__approval">
                    <span>
                      <small>proposal_id</small>
                      <strong>{businessDecision.proposalId}</strong>
                      <em>{businessDecision.approval.status}</em>
                    </span>
                    <span>
                      <small>输入快照</small>
                      <strong>{shortHash(businessDecision.inputEvidence.snapshotHash)}</strong>
                      <em>现场测量字段 {businessDecision.inputEvidence.operatorMeasuredFieldCount}</em>
                    </span>
                    <button
                      disabled={busy || businessDecision.approval.status !== 'pending_simulation_review'}
                      onClick={() => void approveBusinessDecision()}
                      title="使用两个本地测试身份，不代表现场实名审批"
                      type="button"
                    >模拟双岗审批（测试身份）</button>
                    <button
                      disabled={busy}
                      onClick={() => void downloadBusinessDecisionReport()}
                      type="button"
                    >导出全业务决策报告</button>
                    <p>dispatch_allowed=false · production_authority=false · 只进入沙盘审批和证据报告，不产生生产执行回执。</p>
                  </section>
                </div>
              ) : (
                <p>冠军策略和确定性后备共享当前后端快照；推理结果必须经过合同、观测范围、种子一致性、熵、数据质量、吞吐、堆场和碳门禁。</p>
              )}
            </section>
          </div>
        )}

        {activeTab === 'regulatory' && (regulatory ? (
          <div
            className="operational-governance-layout"
            data-regulatory-evidence={regulatory.strategy.status}
            data-regulatory-scenario={regulatory.scenario}
          >
            <section className="authority-boundary">
              <header><strong>海事/海关权责边界</strong><em>主管机关信号外生</em></header>
              {Object.entries(regulatory.authority).map(([key, value]) => (
                <span className={value ? 'is-true' : 'is-false'} key={key}>
                  <small>{key}</small><strong>{String(value)}</strong>
                </span>
              ))}
              <p>系统不能选择检查对象、改变检查结论或提前放行，只优化检查准备和官方放行后的恢复资源。</p>
            </section>

            <section className="lineage-summary" aria-label="监管状态链">
              <span><small>海事检查队列</small><strong>{regulatory.state.maritimeHoldVessels?.toFixed(2)}</strong></span>
              <span><small>海关查验队列</small><strong>{regulatory.state.customsHoldVessels?.toFixed(2)}</strong></span>
              <span><small>已放行恢复队列</small><strong>{regulatory.state.releasedRecoveryVessels?.toFixed(2)}</strong></span>
              <span><small>监管延误</small><strong>{regulatory.impact.regulatoryDelayMinutes?.toFixed(2)} min</strong></span>
              <span><small>增量能耗</small><strong>{regulatory.impact.incrementalEnergyKwh?.toFixed(2)} kWh</strong></span>
              <span><small>官方本步放行</small><strong>{regulatory.impact.officialReleasedVessels?.toFixed(2)}</strong></span>
            </section>

            <section className="forecast-model-card">
              <small>{regulatory.strategy.status}</small>
              <strong>{regulatory.strategy.id}</strong>
              <span>12维监管观测 · 9种补充动作 · 原5类港口动作保持不变</span>
              <span>3 seeds × {regulatory.strategy.training.episodesPerSeed.toLocaleString()} episodes · selected seed {regulatory.strategy.selectedSeed}</span>
              <span>准备度 {regulatory.strategy.inspectionReadinessRatio} · 放行后恢复优先级 {regulatory.strategy.postReleaseRecoveryPriorityRatio}</span>
              <code>{shortHash(regulatory.businessEvidence.evidenceSha256)}</code>
              <p>{regulatory.businessEvidence.scope}</p>
            </section>

            <section className="operational-kpi-grid" aria-label="监管策略离线业务价值">
              <span><small>场景成本降低</small><strong>{regulatory.businessEvidence.costReductionPercent.toFixed(4)}%</strong><em>冻结测试</em></span>
              <span><small>成本95%区间</small><strong>{regulatory.businessEvidence.costReductionCi95.lower95Percent.toFixed(4)}–{regulatory.businessEvidence.costReductionCi95.upper95Percent.toFixed(4)}%</strong><em>{regulatory.businessEvidence.costReductionCi95.pairedRows} rows</em></span>
              <span><small>能耗降低</small><strong>{regulatory.businessEvidence.energyReductionPercent.toFixed(4)}%</strong><em>同恢复服务</em></span>
              <span><small>碳排降低</small><strong>{regulatory.businessEvidence.carbonReductionPercent.toFixed(4)}%</strong><em>同监管延误</em></span>
              <span><small>监管延误变化</small><strong>{regulatory.businessEvidence.regulatoryDelayReductionPercent.toFixed(4)}%</strong><em>不退化</em></span>
              <span><small>安全违规变化</small><strong>{regulatory.businessEvidence.expectedSafetyViolationChange.toFixed(6)}</strong><em>不退化</em></span>
            </section>

            <section className="scenario-controls">
              <header><strong>监管压力情景</strong><em>当前：{regulatoryScenarioLabels[regulatory.scenario]}</em></header>
              <div>
                {(Object.keys(regulatoryScenarioLabels) as RegulatoryScenarioId[]).map((scenario) => (
                  <button
                    aria-pressed={regulatory.scenario === scenario}
                    disabled={busy}
                    key={scenario}
                    onClick={() => void injectRegulatory(scenario)}
                    type="button"
                  >
                    {regulatoryScenarioLabels[scenario]}
                  </button>
                ))}
              </div>
              <p>v1 无门控候选因能耗、碳排和安全退化被阻断并保留；v2 通过优势投影后才获得离线准入。</p>
            </section>

            <section className="calibration-datasets">
              {regulatory.sources.map((source) => (
                <article key={source.url}>
                  <strong>{source.authority}</strong>
                  <span>{source.subject}</span>
                  <a href={source.url} rel="noreferrer" target="_blank">官方依据</a>
                </article>
              ))}
            </section>
          </div>
        ) : <p>监管韧性证据正在从后端加载。</p>)}

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
            <section className="production-readiness-gates" aria-label="生产就绪三重门禁">
              <header>
                <div>
                  <strong>生产就绪三重门禁</strong>
                  <em>{productionReadiness?.siteDeliveryReady ? 'SITE DELIVERY READY' : 'EXTERNAL EVIDENCE OPEN'}</em>
                </div>
                <button
                  disabled={busy}
                  onClick={() => void runAction('重新核查生产就绪门禁', async () => {
                    setProductionReadiness(await fetchProductionReadiness(authToken));
                  })}
                  type="button"
                >重新核查门禁</button>
              </header>
              {productionReadiness ? (
                <div>
                  <article className={productionReadiness.gates.identityAndOtSafety.readyForPolicyEvaluation ? 'is-ready' : 'is-blocked'}>
                    <small>身份与运行技术联锁</small>
                    <strong>{productionReadiness.gates.identityAndOtSafety.readyForPolicyEvaluation ? '策略评估已配置' : '待现场配置'}</strong>
                    <span>身份公钥 {productionReadiness.gates.identityAndOtSafety.identityTrustKeyCount} · 联锁公钥 {productionReadiness.gates.identityAndOtSafety.interlockTrustKeyCount}</span>
                    <ul>{productionReadiness.gates.identityAndOtSafety.blockers.map((item) => <li key={item}>{item}</li>)}</ul>
                  </article>
                  <article className={productionReadiness.gates.reliability.siteReliabilityAccepted ? 'is-ready' : 'is-blocked'}>
                    <small>24×7 可靠性与灾难恢复</small>
                    <strong>{productionReadiness.gates.reliability.siteReliabilityAccepted ? '现场 SLO 已验收' : '现场 SLO 未验收'}</strong>
                    <span>RPO {productionReadiness.gates.reliability.targets.rpoMinutes}min · RTO {productionReadiness.gates.reliability.targets.rtoMinutes}min · 可用性 {productionReadiness.gates.reliability.targets.availabilityPercent}%</span>
                    <ul>{productionReadiness.gates.reliability.blockers.map((item) => <li key={item}>{item}</li>)}</ul>
                  </article>
                  <article className={productionReadiness.gates.siteAcceptance.decision.siteDeliveryReady ? 'is-ready' : 'is-blocked'}>
                    <small>现场 KPI 与五方验收</small>
                    <strong>{productionReadiness.gates.siteAcceptance.decision.siteDeliveryReady ? '站点交付通过' : '站点交付阻断'}</strong>
                    <span>{productionReadiness.gates.siteAcceptance.evidenceLevel} · 签字 {productionReadiness.gates.siteAcceptance.decision.validSignoffCount}/{productionReadiness.gates.siteAcceptance.decision.requiredSignoffCount}</span>
                    <ul>{productionReadiness.gates.siteAcceptance.decision.blockers.map((item) => <li key={item}>{item}</li>)}</ul>
                  </article>
                </div>
              ) : <p>正在读取身份联锁、可靠性与现场验收证据。</p>}
              <footer>production_authority=false · dispatch_allowed=false；即使站点验收通过，仍须独立生产授权决策和经现场验收的物理执行适配器。</footer>
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
