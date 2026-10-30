import { inspectProjectCompatibility } from '../src/server/capcut/project-compatibility.mjs';

if (!process.argv[2]) throw new Error('Expected a project directory.');
process.stdout.write(JSON.stringify(await inspectProjectCompatibility(process.argv[2])));
