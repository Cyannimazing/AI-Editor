import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { motionPython, motionRuntimeReady } from '../src/server/editing/motion-runtime.mjs';

if (!await motionRuntimeReady()) throw new Error('Run pnpm setup:motion before the local image-measurement tests.');
const child = spawn(motionPython(), ['-I', '-B', join(process.cwd(), 'scripts/motion-evidence.test.py')], { windowsHide: true, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
