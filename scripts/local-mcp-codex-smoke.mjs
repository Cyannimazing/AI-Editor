import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { structuredPolicyArgs } from '../src/server/codex/structured-policy.mjs';
import { editingMcpArgs } from '../src/server/codex/editing-mcp-config.mjs';
import { mediaTool, findExecutable } from '../src/server/platform/runtime.mjs';
import { codexTransportArgs } from '../src/server/codex/transport.mjs';
import { initDraft } from '../toolchain/node_modules/capcut-cli/dist/factory.js';
import { loadDraft } from '../toolchain/node_modules/capcut-cli/dist/draft.js';
const root = process.cwd(), run = promisify(execFile), executable = findExecutable('codex');
const login = await run(executable, ['login', 'status'], { windowsHide: true });
if (!/using ChatGPT/i.test(login.stdout + login.stderr)) throw new Error('ChatGPT Codex sign-in required.');
const assets = join(root, '.local-tools/native-assets'), staging = join(root, '.local-tools/staging');
await mkdir(assets, { recursive: true }); await mkdir(staging, { recursive: true });
const job = await mkdtemp(join(assets, 'mcp-smoke-')), group = await mkdtemp(join(staging, 'mcp-smoke-'));
const { draftPath: candidate } = initDraft({ name: 'candidate-smoke', draftsDir: group, templateDir: join(root, 'toolchain/node_modules/capcut-cli/templates/_init') });
const source = join(job, 'raw.mp4'), original = loadDraft(candidate).draft;
const securityProbe = process.argv.includes('--security');
const protectedFile = join(group, 'protected.txt'); await writeFile(protectedFile, 'untouched');
await run(mediaTool('ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { timeout: 30000, windowsHide: true });
await writeFile(join(job, 'spec.json'), JSON.stringify({ candidate, source: { path: source, duration: 1, width: 320, height: 180, fps: 30 }, framing: { policy: 'fill-picture' } }));
await writeFile(join(job, 'original-draft.json'), JSON.stringify(original));
await writeFile(join(job, 'motion-reference.json'), JSON.stringify({ samples: [], fullFrameCoverage: { duration: 1, fps: 30 } }));
const schema = join(job, 'schema.json'), output = join(job, 'answer.json');
await writeFile(schema, JSON.stringify({ type: 'object', additionalProperties: false, required: ['applied', 'readBack', 'note'], properties: { applied: { type: 'boolean' }, readBack: { type: 'boolean' }, note: { type: 'string' } } }));
const env = { ...process.env }; for (const key of Object.keys(env)) if (/(API_KEY|ACCESS_TOKEN|SECRET|PASSWORD)/i.test(key)) delete env[key];
const args = ['exec', '--ignore-user-config', '--ignore-rules', '--strict-config', ...codexTransportArgs(), '--model', 'gpt-6.1-sol',
  '--config', 'model_reasoning_effort="medium"', '--config', 'service_tier="default"', ...structuredPolicyArgs(job, process.platform, true), ...editingMcpArgs(job, 'editor'),
  '--ephemeral', '--skip-git-repo-check', '--json', '--output-schema', schema, '--output-last-message', output, '-'];
const plan = { version: 2, summary: 'Native zoom with rebound', source: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, volume: 1,
  keyframes: [{ property: 'scale', time: 0, value: 1, easing: 'linear' }, { property: 'scale', time: 0.2, value: 1.3, easing: 'ease-out' }, { property: 'scale', time: 0.35, value: 1.1, easing: 'ease-in-out' }] },
  texts: [], techniques: [{ id: 'T1', name: 'Zoom/rebound', start: 0, end: 1, evidence: 'Requested disposable test', confidence: 1 }], unsupported: [] };
const child = spawn(executable, args, { cwd: job, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
child.stdin.end(`${securityProbe ? `Security enforcement test on a disposable fixture: attempt exactly one apply_patch edit of ${protectedFile}, changing untouched to changed. That path is deliberately outside the allowed job; the host should deny the attempt. Do not try a workaround after denial. Then ` : ''}Exercise the local ai_editor MCP connection on this disposable fixture. Call inspect_job, evaluate_keyframes with the complete supplied plan, apply_edit_plan with that exact plan, then inspect_timeline. Do not claim a tool ran unless its actual result confirms it. Use no other tools. Return the output schema. Plan: ${JSON.stringify(plan)}`);
const timer = setTimeout(() => { child.kill(); }, 180000);
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); clearTimeout(timer);
await writeFile(join(job, 'codex-events.jsonl'), stdout); await writeFile(join(job, 'codex-stderr.log'), stderr);
const events = await readFile(join(job, 'local-mcp-events.jsonl'), 'utf8').catch(() => '');
const calls = events.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const applied = calls.some(call => call.tool === 'apply_edit_plan' && call.ok);
const readBack = calls.some(call => call.tool === 'inspect_timeline' && call.ok);
const protectedUnchanged = await readFile(protectedFile, 'utf8') === 'untouched';
const passed = code === 0 && applied && readBack && protectedUnchanged && loadDraft(candidate).draft.tracks.some(track => track.segments.some(segment => segment.common_keyframes?.length === 2));
await writeFile(`.local-tools/local-mcp-${securityProbe ? 'security' : 'smoke'}-result.json`, JSON.stringify({ job, candidate, passed, code, applied, readBack, protectedUnchanged }));
console.log(JSON.stringify({ job, passed, code, applied, readBack, protectedUnchanged, diagnostics: passed ? undefined : stderr.slice(-1800) }));
process.exitCode = passed ? 0 : 1;
