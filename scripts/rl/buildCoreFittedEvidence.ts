import { mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { loadGroupedCoreDataset } from '../../server/coreOperationsGroupedDataset.ts';
import { sha256 } from '../../server/coreOperationsModelRegistry.ts';
import { CORE_OPERATIONS_AUTHORITY_BOUNDARY } from '../../shared/coreOperationsRlContract.ts';
import type { FittedTrainingResult } from '../../server/coreOperationsFittedRl.ts';

const directory=process.argv[2];
const version=process.argv[3]??'v2';
if(!/^v[0-9]+$/.test(version)||Number(version.slice(1))<2)throw new Error('use a new report version v2 or later');
const protocol=JSON.parse(await readFile(`${directory}/protocol.json`,'utf8'));
const validation=JSON.parse(await readFile(`${directory}/robust-validation.json`,'utf8'));
const final=JSON.parse(await readFile(`${directory}/final-test.json`,'utf8'));
const lock=JSON.parse(await readFile(`${directory}/final-test-lock.json`,'utf8'));
const results:FittedTrainingResult[]=await Promise.all(protocol.configuration.seeds.map(async(seed:number)=>JSON.parse(await readFile(`${directory}/seed-${seed}.json`,'utf8'))));
for(const [file,digest] of Object.entries(lock.sourceFiles))if(sha256(await readFile(file))!==digest)throw new Error(`evaluation source changed: ${file}`);
const policies=results.map((r)=>r.policy);
if(sha256(JSON.stringify(policies))!==lock.policySha256)throw new Error('selected policies changed after final-test lock');
if(!validation.gate.passed||!final.evaluation.gate.passed||!results.every((r)=>r.convergence.passed))throw new Error('candidate not qualified; preserve failures without promotion');
const dataset=await loadGroupedCoreDataset();
if(dataset.fingerprint!==lock.datasetFingerprint)throw new Error('dataset changed');
const historicalFiles=['reports/core-operations-rl-champion-v1.json','reports/core-operations-rl-champion-v1.md','reports/port-business-rl-champion-v3.json','reports/port-business-rl-champion-v3.md','reports/rl-benchmark-balanced-resilience.json','reports/rl-benchmark-balanced-resilience-calibrated-v2.json','reports/regulatory-resilience-v1.json','reports/regulatory-resilience-v2.json','reports/top-tier-hardening-evidence-v2.json','reports/operational-closure-acceptance-v2.json'];
const historicalPreservation=Object.fromEntries(await Promise.all(historicalFiles.map(async(f)=>[f,sha256(await readFile(f))])));
const previous=JSON.parse(await readFile(historicalFiles[0],'utf8'));
const sources=[
  ...Object.keys(lock.sourceFiles),'server/coreOperationsRlService.ts','server/coreOperationsModelRegistry.ts','server/publicEvidencePlugin.ts',
  'src/integrations/coreOperationsRlAdapter.ts','src/components/OperationalEvidenceCenter.tsx',
  'scripts/rl/trainCoreFittedCandidate.ts','scripts/rl/trainCoreFittedSeed.ts','scripts/rl/evaluateCoreFittedValidation.ts','scripts/rl/finalizeCoreFittedCandidate.ts','scripts/rl/buildCoreFittedEvidence.ts','scripts/rl/switchCoreOperationsModel.ts','scripts/rl/verifyCoreUpgradeLineage.ts','scripts/rl/verifyCoreOperationsUpgrade.ts',
  'scripts/rl/verifyCoreOperationsChampion.ts','scripts/operations/verifyOperationalAcceptance.ts','scripts/integration/verifyTopTierHardeningEvidence.ts',
  'tests/coreOperationsUpgrade.test.ts',
];
const sourceFiles=Object.fromEntries(await Promise.all(sources.map(async(f)=>[f,sha256(await readFile(f))])));
const changedSources:Record<string,{historicalDigests:string[];currentDigest:string}>={};
for(const file of [historicalFiles[0],'reports/top-tier-hardening-evidence-v2.json','reports/operational-closure-acceptance-v2.json']){
  const r=JSON.parse(await readFile(file,'utf8'));
  for(const [source,digest]of Object.entries(r.sourceFingerprint?.files??r.verification?.sourceSha256??{}) as Array<[string,string]>){
    const current=sha256(await readFile(source));
    if(current!==digest){
      const item=changedSources[source]??={historicalDigests:[],currentDigest:current};
      if(!item.historicalDigests.includes(digest))item.historicalDigests.push(digest);
      if(sourceFiles[source]!==current)throw new Error(`extension source missing:${source}`);
    }
  }
}
const artifactDir=`reports/artifacts/core-operations-rl-${version}`;
await mkdir(artifactDir,{recursive:true});
const artifacts:Record<string,string>={};
for(const file of (await readdir(directory)).filter((f)=>f.endsWith('.json'))){
  const target=`${artifactDir}/${file}`;
  const content=await readFile(`${directory}/${file}`);
  try{await copyFile(`${directory}/${file}`,target,constants.COPYFILE_EXCL);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(sha256(await readFile(target))!==sha256(content))throw new Error(`immutable artifact already differs:${target}`, { cause: error });}
  artifacts[target]=sha256(content);
}
const pilot=JSON.parse(await readFile('reports/artifacts/core-operations-rl-v2/rejected-pilot.json','utf8').catch(async (error) => {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  return readFile('.runtime/core-fitted-pilot-validation.json','utf8');
}));
const rejection={attemptId:'pilot-validation-01',status:'rejected-not-converged',reason:pilot.convergence??pilot.reason,curve:pilot.curve,policy:pilot.policy,
  supersededSplitAttempt:{status:'superseded-source-month-overlap',directory:'.runtime/core-fitted-stable-01',reason:'same public monthly anchor was split across partitions; completed seed and interrupted logs retained locally'},
};
const rejectionPath=`${artifactDir}/rejected-pilot.json`;
await writeFile(rejectionPath,JSON.stringify(rejection,null,2));artifacts[rejectionPath]=sha256(await readFile(rejectionPath));
const admitted=results.every((r)=>r.convergence.passed)&&validation.gate.passed&&final.evaluation.gate.passed;
const report={
  schemaVersion:'core-operations-rl-evidence.v1',evidenceLabel:previous.evidenceLabel,generatedAt:new Date().toISOString(),contract:previous.contract,
  sourceFingerprint:{algorithm:'sha256',files:sourceFiles,digest:sha256(Object.entries(sourceFiles).sort(([a],[b])=>a.localeCompare(b)).map(([f,h])=>`${f}:${h}`).join('\n'))},
  dataset:{id:dataset.id,fingerprint:dataset.fingerprint,sourceFingerprint:dataset.sourceFingerprint,evidenceLevel:dataset.evidenceLevel,operationalClaimAllowed:false,recordCount:dataset.records.length,split:dataset.split,quality:dataset.quality,lineage:dataset.lineage,limitations:dataset.limitations,
    partitionCounts:{train:dataset.trainRecords.length,validation:dataset.validationRecords.length,test:dataset.testRecords.length},sourceMonthLeakage:false},
  training:{protocolVersion:'core-operations-champion.v2',dataset:{fingerprint:dataset.fingerprint},attempts:[{attemptId:'pilot-validation-01',status:'rejected'},{attemptId:'source-month-grouped-02',status:'qualified',configuration:protocol.configuration}],
    champion:{admitted,algorithmId:'factorized-fitted-policy-iteration',attemptId:'source-month-grouped-02',seedPolicies:policies,validationGate:validation.gate,finalTestGate:final.evaluation.gate,
      finalTest:{reinforcementLearning:final.evaluation.full.map((x:{candidate:unknown})=>x.candidate),standardOperatingProcedure:final.evaluation.full.map((x:{sop:unknown})=>x.sop)}},boundary:CORE_OPERATIONS_AUTHORITY_BOUNDARY},
  upgrade:{allSeedsConverged:results.every((r)=>r.convergence.passed),convergence:results.map((r)=>({seed:r.policy.hyperparameters.seed,...r.convergence})),deployedValidationPassed:validation.gate.passed,deployedTestPassed:final.evaluation.gate.passed,sourceFiles,
    agreement:final.agreement,previousAgreement:final.previousAgreement,finalTestEvaluationCount:1,selectionLock:lock,
    learningMethod:'model-based factorized approximate policy iteration with paired discounted rollout returns, ridge value fitting and damped policy updates; no expert labels or control-algorithm replacement',
    convergenceScope:'empirical training stability and validation plateau, not a proof of global optimality or real-port convergence'},
  valueAttribution:{design:'identical deployed ensemble, abstention and aggregate safety admission; old RL and SOP comparators; source-month-cluster bootstrap',fullScenarios:final.evaluation.fullReplayChecks,robustGate:final.evaluation.gate,previousRlConfidence:final.evaluation.previousSummaries,
    claimBoundary:'公开月度汇总数据及工程情景下的离线收益；队列、等待与能碳为模型代理量，不能折算为现场船舶数、实际节省金额或生产绩效。历史测试期是回归证据，仍需新的前瞻现场留出集。'},
  runtimeClosure:{...previous.runtimeClosure,modelActivation:'atomic manifest + model/dataset/source hashes + pinned previous-model rollback'},
  releaseDecision:{offlineChampionAdmitted:admitted,validationGatePassed:validation.gate.passed,finalTestGatePassed:final.evaluation.gate.passed,simulationExecutionAdmitted:admitted,operationalDeploymentAdmitted:false},
  historicalPreservation,changedSources,retainedArtifacts:{files:artifacts},
};
await writeFile(`reports/core-operations-rl-champion-${version}.json`,JSON.stringify(report,null,2)+'\n');
const totals=results.reduce((a,r)=>({transitions:a.transitions+r.policy.training.environmentSteps,targets:a.targets+r.policy.training.parameterUpdates}),{transitions:0,targets:0});
const lines=final.evaluation.fullReplayChecks.map((r:{scenario:string;versusPrevious:Record<string,number>})=>`| ${r.scenario} | ${r.versusPrevious.waitReductionHours.toFixed(4)} | ${r.versusPrevious.energyCostReductionPercent.toFixed(3)}% | ${r.versusPrevious.carbonReductionPercent.toFixed(3)}% |`);
await writeFile(`reports/core-operations-rl-champion-${version}.md`,`# 强化学习收敛与业务价值 ${version}\n\n五个随机种子全部通过经验收敛检查；验证与最终历史回归业务门禁均通过。新策略为 factorized-fitted-policy-iteration，保持原 47 维观测、10 个并行动作头、30 个选项和原奖励、业务系数及安全权限。\n\n训练完成 ${totals.transitions.toLocaleString('en-US')} 次模型交互与 ${totals.targets.toLocaleString('en-US')} 个回报目标拟合；每种子 40 轮。最后五轮动作变化最大 ${Math.max(...results.map(r=>r.convergence.maximumProbeChangePercent)).toFixed(3)}%，奖励跨度最大 ${Math.max(...results.map(r=>r.convergence.validationRewardRange)).toFixed(6)}。这是经验稳定性，不是数学全局收敛证明。\n\n按公开源月份整组切分为 ${dataset.trainRecords.length}/${dataset.validationRecords.length}/${dataset.testRecords.length} 条，训练、验证和测试没有共享月份。模型及评估方案先封存，再进行一次最终历史回归；不把旧测试期称为全新的前瞻测试。\n\n## 相对旧强化学习实际运行方式的改进\n\n平均投票一致性 ${(final.previousAgreement.meanVoteShare*100).toFixed(2)}% → ${(final.agreement.meanVoteShare*100).toFixed(2)}%；低于最低一致性的动作头比例 ${final.previousAgreement.belowMinimumVotePercent.toFixed(2)}% → ${final.agreement.belowMinimumVotePercent.toFixed(2)}%。比较均包含实际回退逻辑。\n\n| 工程情景 | 等待代理量减少（模型小时） | 能源成本指数降低 | 碳强度指数降低 |\n|---|---:|---:|---:|\n${lines.join('\n')}\n\n上述差值来自完整时间序列同条件回放。独立稳健性检查采用 ${final.evaluation.windows.length} 个源月份时间块、四个固定情景分层和 2,000 次配对重采样；同一月份的不同情景共用重采样索引，不把随机种子和同月派生记录当成独立现场样本。最低吞吐保持率 ${final.evaluation.gate.evidence.minimumThroughputRetentionPercent.toFixed(3)}%，最低冷藏箱服务保持率 ${final.evaluation.gate.evidence.minimumReeferServicePercent.toFixed(3)}%；十个业务域均在最终情景中产生了实际动作。\n\n收益是公开数据锚定、工程补足仿真中的代理收益。尚无实测港口因果干预数据，不能声称已节省现金、已改善现场业务，或直接切入实港生产。\n\n## 本次修正\n\n1. 同月派生记录跨分区泄漏，改为整月切分。\n2. 十个动作头共享同一总奖励导致归因困难，改为单头动作的配对多步回报拟合。\n3. 在线自举和同时更新的波动，改为冻结本轮策略、正则拟合与阻尼更新。\n4. 仅保存末轮奖励，改为完整训练曲线、固定探针动作变化和验证选择检查点。\n5. 单模型评估与五模型投票运行不一致，统一投票、回退、吞吐及安全准入函数。\n6. 来源可信度与字段完整率混用，保留工程来源分数并单独计算完整性，不提高现场真实性。\n7. 冠军切换缺少完整校验，新增模型、数据与源码哈希校验、原子指针和上一模型回退。\n\n旧模型、旧报告和未收敛试验保留。复现和数据替换步骤见 [落地说明](../docs/RL_CONVERGENCE_V2.md)。\n`);
console.log(JSON.stringify({admitted,totals,report:`reports/core-operations-rl-champion-${version}.json`}));
