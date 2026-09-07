import { CORE_OPERATIONS_EVALUATION_SCENARIOS as scenarios, CORE_TRAINING_KERNEL as K, coreBusinessValueGate, evaluateCorePolicy,
  type ConfidenceSummary, type CoreEvaluationMetrics, type FactorizedCorePolicy } from './coreOperationsRlEngine.ts';
import { evaluateDeployedCore } from './coreOperationsFittedRl.ts';
import type { PortBusinessRecord } from './portBusinessDataset.ts';

const delta = (c: CoreEvaluationMetrics, b: CoreEvaluationMetrics) => ({
  rewardImprovement: c.meanReward - b.meanReward,
  waitReductionHours: b.meanWaitingHours - c.meanWaitingHours,
  queueReductionVessels: b.meanQueueVessels - c.meanQueueVessels,
  energyCostReductionPercent: (b.energyCostIndex - c.energyCostIndex) / b.energyCostIndex * 100,
  peakGridReductionPoints: b.peakGridRatioPercent - c.peakGridRatioPercent,
  carbonReductionPercent: (b.carbonIntensity - c.carbonIntensity) / b.carbonIntensity * 100,
  maintenanceBacklogReduction: b.maintenanceBacklog - c.maintenanceBacklog,
  recoveryBacklogReductionVessels: b.recoveryBacklogVessels - c.recoveryBacklogVessels,
});
type Deltas = ReturnType<typeof delta>;
const keys = Object.keys(delta({} as CoreEvaluationMetrics, {} as CoreEvaluationMetrics)) as Array<keyof Deltas>;
const round = (x: number) => Number(x.toFixed(8));
const average = (x: number[]) => x.reduce((a,b) => a+b,0) / x.length;
export const CORE_ROBUST_PROTOCOL = {
  scenarioStrata: [...scenarios], sourceMonthsPerBlock: 4, minimumBlocks: 8, bootstrapSamples: 2000, bootstrapSeed: 9072026,
  design: 'paired cold-start chronological windows; resample the same month-block indexes across fixed scenario strata; seeds are not counted as independent test data',
  fullReplayRule: 'each scenario must retain nonnegative reward/wait/queue/energy/carbon gains versus both SOP and previous deployed RL; throughput>=98.5%, reefer>=99%, no projection',
};
export const evaluateCoreRobustness = (policies: FactorizedCorePolicy[], previous: FactorizedCorePolicy[], records: PortBusinessRecord[]) => {
  const months = [...new Set(records.map((r) => r.sourceMonth))];
  const blocks: PortBusinessRecord[][] = [];
  for (let i=0;i<months.length;i+=4) {
    const selected = new Set(months.slice(i,i+4));
    const block = records.filter((r) => selected.has(r.sourceMonth));
    if (selected.size < 4 && blocks.length) blocks.at(-1)!.push(...block);
    else blocks.push(block);
  }
  if (blocks.length < CORE_ROBUST_PROTOCOL.minimumBlocks) throw new Error('insufficient independent month blocks');
  const full = scenarios.map((scenario) => ({scenario,
    candidate: evaluateDeployedCore(policies, records, scenario), previous: evaluateDeployedCore(previous, records, scenario),
    sop: evaluateCorePolicy({kind:'standard-operating-procedure'},records,scenario),
  }));
  const windows = blocks.map((block, blockIndex) => ({ blockIndex, months:[block[0].sourceMonth,block.at(-1)!.sourceMonth], records:block.length,
    scenarios: scenarios.map((scenario) => {
      const candidate = evaluateDeployedCore(policies,block,scenario);
      const sop = evaluateCorePolicy({kind:'standard-operating-procedure'},block,scenario);
      const prior = evaluateDeployedCore(previous,block,scenario);
      return {scenario,candidate,sop,previous:prior,deltaVsSop:delta(candidate.metrics,sop.metrics),deltaVsPrevious:delta(candidate.metrics,prior.metrics)};
    }),
  }));
  const summarize = (comparator:'deltaVsSop'|'deltaVsPrevious') => {
    const values = windows.map((w) => Object.fromEntries(keys.map((key) => [key,average(w.scenarios.map((s) => s[comparator][key]))])) as Deltas);
    const random=K.seededRandom(CORE_ROBUST_PROTOCOL.bootstrapSeed);
    const bootstrap=Object.fromEntries(keys.map((key)=>[key,[] as number[]])) as Record<keyof Deltas,number[]>;
    for(let b=0;b<CORE_ROBUST_PROTOCOL.bootstrapSamples;b++) {
      const indexes=values.map(()=>Math.floor(random()*values.length));
      for(const key of keys) bootstrap[key].push(average(indexes.map((i)=>values[i][key])));
    }
    return Object.fromEntries(keys.map((key)=>{
      const sorted=bootstrap[key].sort((a,b)=>a-b);
      const original=values.map((v)=>v[key]);
      return [key,{mean:round(average(original)),lower95:round(sorted[Math.floor(sorted.length*0.025)]),upper95:round(sorted[Math.floor(sorted.length*0.975)]),min:round(Math.min(...original)),max:round(Math.max(...original)),samples:values.length}];
    })) as Record<keyof Deltas,ConfidenceSummary>;
  };
  const legacyAggregateGate=coreBusinessValueGate(full.map((r)=>r.candidate),full.map((r)=>r.sop));
  const summaries=summarize('deltaVsSop');
  const previousSummaries=summarize('deltaVsPrevious');
  const gate=structuredClone(legacyAggregateGate);
  Object.assign(gate.evidence,summaries);
  const mapping={rewardImprovement:'rewardImprovement',waitingTime:'waitReductionHours',queue:'queueReductionVessels',energyCost:'energyCostReductionPercent',peakGrid:'peakGridReductionPoints',carbon:'carbonReductionPercent',maintenance:'maintenanceBacklogReduction',recovery:'recoveryBacklogReductionVessels'} as const;
  for(const [check,key] of Object.entries(mapping)) gate.checks[check]=summaries[key].lower95 >= (check==='rewardImprovement'?gate.thresholds.minimumRewardImprovementLower95:check==='recovery'?gate.thresholds.minimumRecoveryBacklogReductionLower95:0);
  const fullReplayChecks = full.map((r) => {
    const versusSop=delta(r.candidate.metrics,r.sop.metrics);
    const versusPrevious=delta(r.candidate.metrics,r.previous.metrics);
    const nonRegressionKeys: Array<keyof Deltas>=['rewardImprovement','waitReductionHours','queueReductionVessels','energyCostReductionPercent','carbonReductionPercent'];
    const metrics=r.candidate.metrics;
    return {scenario:r.scenario,versusSop,versusPrevious,
      passed:nonRegressionKeys.every((k)=>versusSop[k]>=-1e-6&&versusPrevious[k]>=-1e-6)&&metrics.throughputRetentionPercent>=98.5&&metrics.reeferServicePercent>=99&&metrics.safetyProjectionRatePercent===0&&metrics.yardOverflowRatePercent<=r.sop.metrics.yardOverflowRatePercent&&metrics.gateSlaBreachRatePercent<=r.sop.metrics.gateSlaBreachRatePercent};
  });
  gate.checks.fullDeployedScenarioNonRegression=fullReplayChecks.every((r)=>r.passed);
  gate.checks.previousRlReward=previousSummaries.rewardImprovement.lower95>0;
  gate.passed=Object.values(gate.checks).every(Boolean);
  return {protocol:CORE_ROBUST_PROTOCOL,gate,previousSummaries,legacyAggregateGate,fullReplayChecks,full,windows};
};
