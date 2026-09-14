import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { languages } from './problem.js';
import { normalizeOutput } from './content.js';
import { compileTypeScript } from './typescript.js';

export function execute(command, args, { input = '', cwd, timeoutMs = 2000, maxBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', size = 0, failure;
    const kill = () => {
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL'); }
    };
    const timer = setTimeout(() => { failure = 'Time Limit Exceeded'; kill(); }, timeoutMs);
    const collect = stream => chunk => {
      size += chunk.length;
      if (size > maxBytes) { failure = 'Output Limit Exceeded'; kill(); return; }
      if (stream === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') { failure = error.message; kill(); } });
    child.once('error', error => { clearTimeout(timer); reject(new Error(`Cannot start ${command}: ${error.message}`)); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, failure, elapsedMs: Math.round(performance.now() - start) }); });
    child.stdin.end(input);
  });
}

export function validateTests(tests) {
  if (!Array.isArray(tests) || !tests.length) throw new Error('No samples found. Add input/output pairs to tests.json.');
  for (const [i, test] of tests.entries()) {
    if (typeof test?.input !== 'string' || typeof test?.output !== 'string') throw new Error(`Test ${i + 1} must contain string input and output fields.`);
  }
  return tests;
}

export async function runLocal(directory, problem, source, options = {}) {
  if (problem.platform !== 'codeforces') throw new Error('Function problems use the remote judge. Run phi test without --local.');
  if (problem.interactive) throw new Error('Interactive problems need a custom interactor; the sample runner cannot judge them.');
  const tests = validateTests(JSON.parse(await readFile(path.join(directory, 'tests.json'), 'utf8')));
  const comparison = options.exact ? 'exact' : 'tokens';
  const temp = await mkdtemp(path.join(os.tmpdir(), 'phi-test-'));
  try {
    let executableSource = source;
    if (problem.language === 'typescript') {
      try { executableSource = compileTypeScript(source); }
      catch (error) { return { accepted: false, verdict: 'Compilation Error', details: error.message }; }
    }
    const file = path.join(temp, `solution.${['javascript', 'typescript'].includes(problem.language) ? 'cjs' : languages[problem.language].extension}`);
    await writeFile(file, executableSource);
    let command, args;
    if (problem.language === 'cpp') {
      const executable = path.join(temp, process.platform === 'win32' ? 'solution.exe' : 'solution');
      const includes = fileURLToPath(new URL('../templates/include', import.meta.url));
      const build = await execute(process.env.CXX ?? 'c++', ['-std=c++17', '-O2', '-I', includes, file, '-o', executable], { cwd: directory, timeoutMs: 30000 });
      if (build.code !== 0 || build.failure) return { accepted: false, verdict: build.failure ?? 'Compilation Error', details: build.stderr };
      command = executable; args = [];
    } else {
      command = problem.language === 'python' ? (process.env.PHI_PYTHON ?? 'python3') : process.execPath;
      args = [file];
    }
    const results = [];
    for (const [i, test] of tests.entries()) {
      const run = await execute(command, args, { input: test.input, cwd: directory, timeoutMs: options.timeoutMs ?? 2000 });
      const verdict = run.failure ?? (run.code !== 0 ? 'Runtime Error' : normalizeOutput(run.stdout, comparison) === normalizeOutput(test.output, comparison) ? 'Passed' : 'Wrong Answer');
      results.push({ case: i + 1, verdict, elapsedMs: run.elapsedMs, input: test.input, expected: test.output, actual: run.stdout, stderr: run.stderr });
    }
    const passed = results.filter(result => result.verdict === 'Passed').length;
    return { accepted: passed === tests.length, verdict: passed === tests.length ? 'Samples passed' : 'Samples failed', passed, total: tests.length, cases: results };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
