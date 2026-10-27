import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findExecutable } from '../src/server/platform/runtime.mjs';
import { workerPermissionArgs } from '../src/server/codex/permissions.mjs';

const root = join(process.cwd(), '.local-tools', 'sandbox-checks');
await mkdir(root, { recursive: true });
const probe = await mkdtemp(join(root, 'probe-'));
const allowed = join(probe, 'allowed'), protectedFile = join(probe, 'protected.txt');
await mkdir(allowed); await writeFile(protectedFile, 'untouched');
const code = `const fs=require('node:fs'); const file=${JSON.stringify(protectedFile)};
let deniedRead=false,deniedWrite=false;
try { fs.readFileSync(file); } catch(e) { deniedRead=['EPERM','EACCES'].includes(e.code); }
try { fs.writeFileSync(file,'changed'); } catch(e) { deniedWrite=['EPERM','EACCES'].includes(e.code); }
fs.writeFileSync(${JSON.stringify(join(allowed, 'write-ok.txt'))},'allowed');
console.log(JSON.stringify({deniedRead,deniedWrite,allowedWrite:true}));
process.exitCode=deniedRead&&deniedWrite?0:2;`;
const args = ['sandbox', '--permission-profile', 'ai_editor', ...workerPermissionArgs(allowed, undefined, true), '--cd', allowed, process.execPath, '-e', code];
const child = spawn(findExecutable('codex'), args, { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; });
const timer = setTimeout(() => child.kill(), 45000);
const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); clearTimeout(timer);
const protectedUnchanged = await readFile(protectedFile, 'utf8') === 'untouched';
console.log(output.trim());
console.log(JSON.stringify({ exit, protectedUnchanged, passed: exit === 0 && protectedUnchanged }));
process.exitCode = exit === 0 && protectedUnchanged ? 0 : 1;
