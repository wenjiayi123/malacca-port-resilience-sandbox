import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256, validateCoreModelReport, type CoreModelReport } from '../../server/coreOperationsModelRegistry.ts';
export const CORE_UPGRADE_REPORT='reports/core-operations-rl-champion-v2.json';
export interface UpgradeLineage extends CoreModelReport {
  historicalPreservation: Record<string,string>;
  changedSources: Record<string,{ historicalDigests:string[]; currentDigest:string }>;
}
export const readVerifiedUpgradeLineage=async()=>{
  const report=JSON.parse(await readFile(CORE_UPGRADE_REPORT,'utf8')) as UpgradeLineage;
  validateCoreModelReport(report);
  if(!report.upgrade || !Object.keys(report.upgrade.sourceFiles).length)throw new Error('upgrade source evidence missing');
  for(const [file,digest]of Object.entries(report.historicalPreservation))if(sha256(await readFile(file))!==digest)throw new Error(`historical artifact changed:${file}`);
  for(const [file,digest]of Object.entries(report.upgrade.sourceFiles))if(sha256(await readFile(file))!==digest)throw new Error(`upgrade source changed:${file}`);
  return report;
};
export const isVerifiedCoreSourceExtension=async(archivedReport:string,file:string,expected:string,actual:string)=>{
  try {
    const r=await readVerifiedUpgradeLineage();
    const reportPath=path.relative(process.cwd(),path.resolve(archivedReport));
    return Boolean(r.historicalPreservation[reportPath]&&r.changedSources[file]?.historicalDigests.includes(expected)&&r.changedSources[file].currentDigest===actual&&r.upgrade?.sourceFiles[file]===actual);
  } catch { return false; }
};
