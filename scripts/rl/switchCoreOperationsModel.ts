import { activateCoreModel, loadActiveCoreModel } from '../../server/coreOperationsModelRegistry.ts';
const report = process.argv[2];
if (!report) throw new Error('Usage: node --experimental-strip-types scripts/rl/switchCoreOperationsModel.ts <report.json>');
console.log(JSON.stringify(await activateCoreModel(report), null, 2));
console.log(JSON.stringify((await loadActiveCoreModel()).reference));
