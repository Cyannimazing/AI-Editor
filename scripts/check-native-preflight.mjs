import { checkNativePreflight } from '../src/server/capcut/native-preflight.mjs';

const report = await checkNativePreflight();
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exitCode = report.ok ? 0 : report.compatibility === 'not_applicable' ? 2 : 1;
