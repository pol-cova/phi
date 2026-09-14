#!/usr/bin/env node
import { parseArgs, stripVTControlCharacters } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';
import { fetchProblem, runProblem, openProblem } from '../src/app.js';
import { platformName, parseProblem } from '../src/problem.js';
import { loadProblem, history } from '../src/storage.js';
import { withBrowser, forgetSession, navigate, dataHome } from '../src/browser.js';
import { compilerOptions } from '../src/platforms/codeforces.js';
import { isInterviewLoggedIn } from '../src/platforms/interview.js';

const help = `phi · coding practice in your terminal

  phi setup                        Install the browser (once)
  phi login <lc|nc|cf>              Sign in using a dedicated browser session
  phi fetch <ID|URL> [--lang NAME]  Save a statement, samples, and solution file
  phi show [DIR]                    Read the downloaded statement
  phi edit [DIR]                    Open your solution in $VISUAL or $EDITOR
  phi test [DIR]                    Run samples locally on CF; remote tests on LC/NC
  phi submit [DIR]                  Submit your saved solution to its own platform
  phi history [DIR]                 Show attempts and results
  phi open [DIR]                    Open the problem in your phi browser session
  phi languages [DIR]               List current Codeforces compiler IDs
  phi logout <lc|nc|cf>             Remove phi's saved session for that platform
  phi doctor                       Check installation

  IDs: lc:two-sum   nc:duplicate-integer   cf:4/A
  Languages: python (py), typescript (ts), cpp (c++), javascript (js)

  --show           Show the browser during a fetch, test, or submission
  --out DIR        Download root, default ./practice
  --timeout MS     Per-sample local timeout, or remote judge wait timeout
  --exact          Compare local output exactly, apart from a final newline
  --compiler ID    Select a Codeforces compiler from phi languages
  --retry          Explicitly allow submission after an uncertain earlier attempt
  --json           Print structured results

  Inside a downloaded problem folder, DIR defaults to the current directory.
  Tests never submit. Use phi submit when you are ready.
`;

function print(value) { console.log(stripVTControlCharacters(String(value))); }
async function wait(question) {
  if (!process.stdin.isTTY) throw new Error('This command needs an interactive terminal.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(question); } finally { rl.close(); }
}

function report(result, json) {
  if (json) return print(JSON.stringify(result, null, 2));
  print(`${result.accepted ? 'PASS' : 'FAIL'}  ${result.verdict}`);
  if (result.total !== undefined) print(`${result.passed}/${result.total} tests passed`);
  if (result.runtime) print(`Runtime: ${result.runtime}  Memory: ${result.memory ?? 'unavailable'}`);
  for (const test of result.cases ?? []) {
    print(`  ${test.case}. ${test.verdict} (${test.elapsedMs} ms)`);
    if (test.verdict !== 'Passed') print(`Input:\n${test.input}\nExpected:\n${test.expected}\nActual:\n${test.actual}${test.stderr ? `\nStderr:\n${test.stderr}` : ''}`);
  }
  if (result.details) print(result.details);
  if (result.resultUrl) print(result.resultUrl);
}

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, lang: { type: 'string', short: 'l' }, out: { type: 'string' },
    show: { type: 'boolean' }, timeout: { type: 'string' }, exact: { type: 'boolean' }, local: { type: 'boolean' },
    compiler: { type: 'string' }, retry: { type: 'boolean' }, json: { type: 'boolean' },
  } });
  const [command, argument, extra] = positionals;
  if (values.version) return print(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
  if (values.help || !command || command === 'help') return print(help);
  if (extra) throw new Error('Too many arguments. See phi --help.');
  const options = { ...values, ...(values.timeout ? { timeoutMs: Number(values.timeout) } : {}) };
  if (values.timeout && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)) throw new Error('--timeout must be a positive integer in milliseconds.');
  const directory = argument ?? '.';
  if (command === 'setup') {
    const require = createRequire(import.meta.url);
    const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Browser setup exited with code ${code}.`))); });
    return;
  }
  if (command === 'fetch') {
    if (!argument) throw new Error('Provide a problem ID or URL.');
    const dir = await fetchProblem(argument, options);
    return values.json ? print(JSON.stringify({ directory: dir })) : print(`Fetched ${dir}\n\nNext: cd ${JSON.stringify(dir)}\n      phi edit\n      phi test\n      phi submit`);
  }
  if (command === 'test' || command === 'submit') {
    if (!values.json) print(command === 'submit' ? 'Submitting the saved solution…' : 'Running tests…');
    const result = await runProblem(directory, command, options);
    report(result, values.json);
    if (!result.accepted) process.exitCode = 1;
    return;
  }
  if (command === 'history') {
    const entries = await history(directory);
    if (values.json) return print(JSON.stringify(entries, null, 2));
    if (!entries.length) return print('No attempts yet.');
    for (const item of entries) print(`${item.id}  ${item.operation.padEnd(6)}  ${item.verdict ?? item.state}${item.remoteId ? `  remote:${item.remoteId}` : ''}${item.error ? `\n  ${item.error}` : ''}`);
    return;
  }
  if (command === 'show') {
    const { directory: dir } = await loadProblem(directory);
    return print(await readFile(path.join(dir, 'problem.md'), 'utf8'));
  }
  if (command === 'edit') {
    const { directory: dir, problem } = await loadProblem(directory);
    const editor = process.env.VISUAL ?? process.env.EDITOR ?? 'vi';
    const file = path.join(dir, problem.file);
    // The editor is a user-supplied shell command; the filename is passed separately.
    const child = process.platform === 'win32' ? spawn(editor, [file], { stdio: 'inherit', shell: true }) : spawn('/bin/sh', ['-c', `${editor} "$1"`, 'phi-editor', file], { stdio: 'inherit' });
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Editor exited with code ${code}.`))); });
    return;
  }
  if (command === 'open') return openProblem(directory, wait);
  if (command === 'languages') {
    const { problem } = await loadProblem(directory);
    if (problem.platform !== 'codeforces') throw new Error('Compiler IDs apply to Codeforces. Use --lang with fetch for LeetCode and NeetCode.');
    const choices = await withBrowser(problem.platform, options, page => compilerOptions(page, problem));
    return values.json ? print(JSON.stringify(choices)) : choices.forEach(choice => print(`${choice.id.padEnd(5)} ${choice.name}`));
  }
  if (command === 'logout') { await forgetSession(platformName(argument)); return print('Saved phi browser session removed.'); }
  if (command === 'login') {
    if (!process.stdin.isTTY) throw new Error('Run phi login in an interactive terminal.');
    const platform = platformName(argument);
    const ref = parseProblem({ leetcode: 'lc:two-sum', neetcode: 'nc:duplicate-integer', codeforces: 'cf:4/A' }[platform]);
    await withBrowser(platform, { show: true }, async page => {
      await navigate(page, ref.url);
      print(`Sign in to ${platform} in the browser window. The session is saved only in phi's dedicated profile.`);
      await wait('After signing in, return here and press Enter. ');
      await navigate(page, ref.url);
      const loggedIn = platform === 'codeforces'
        ? await page.locator('#header a[href^="/profile/"]').count() > 0
        : await isInterviewLoggedIn(page, platform);
      if (!loggedIn) throw new Error('Sign-in could not be verified. Run phi login again and finish signing in.');
      print('Session ready.');
    });
    return;
  }
  if (command === 'doctor') {
    print(`Node ${process.version}\nProfiles: ${dataHome()}`);
    try { await access(chromium.executablePath()); print('Chromium: installed'); }
    catch { print('Chromium: missing. Run phi setup.'); process.exitCode = 1; }
    return;
  }
  throw new Error(`Unknown command: ${command}. See phi --help.`);
}

main().catch(error => { console.error(`phi: ${stripVTControlCharacters(error.message)}`); process.exitCode = 2; });
