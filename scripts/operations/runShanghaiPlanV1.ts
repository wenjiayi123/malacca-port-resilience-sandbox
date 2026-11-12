import { readFileSync } from 'node:fs';
import { planTrial, readTrial } from '../../server/shanghaiLabV1.ts';
const body = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(planTrial(readTrial(body))));
