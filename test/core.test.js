import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseProblem, languageName, stdinTemplate } from '../src/problem.js';
import { parseStatement, normalizeOutput, parseVerdict } from '../src/content.js';
import { saveProblem, loadProblem, beginAttempt, history } from '../src/storage.js';
import { execute, runLocal } from '../src/runner.js';
import { runProblem } from '../src/app.js';
import { chooseCompiler, findSubmission } from '../src/platforms/codeforces.js';
import { leetcodeResult, executeLeetcode, executeNeetcode } from '../src/platforms/interview.js';
import { EventEmitter } from 'node:events';
import { submissionSource } from '../src/typescript.js';
import { browserLaunchOptions, describeBrowser, browserEnvFor, discoverSystemBrowsers, detectSystemBrowser } from '../src/browser.js';

async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phi-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const watermelon = { ...parseProblem('cf:4A'), language: 'javascript', title: 'Watermelon', statement: 'Split the weight.', tests: [{ input: '8\n', output: 'YES\n' }, { input: '2\n', output: 'NO\n' }], testMode: 'local' };
const solution = "const n=Number(require('fs').readFileSync(0,'utf8'));console.log(n>2&&n%2===0?'YES':'NO');";

test('IDs normalize without conflating native NeetCode and LeetCode', () => {
  assert.equal(parseProblem('nc:duplicate-integer').platform, 'neetcode');
  assert.equal(parseProblem('lc:two-sum').url, 'https://leetcode.com/problems/two-sum/description/');
  assert.equal(parseProblem('cf:123b1').id, '123/B1');
  assert.equal(parseProblem('https://codeforces.com/problemset/problem/4/A').id, '4/A');
  assert.equal(parseProblem('https://codeforces.com/gym/123456/problem/A').contestKind, 'gym');
  assert.equal(languageName('python3'), 'python');
  assert.equal(languageName('ts'), 'typescript');
});

test('reject invalid URLs, traversal, and lookalike hosts', () => {
  for (const value of ['lc:../secrets', 'nc:x/y', 'cf:A', 'https://leetcode.com.evil.com/problems/two-sum/', 'https://u:p@leetcode.com/problems/two-sum/', 'http://leetcode.com/problems/two-sum/', 'https://leetcode.com:123/problems/two-sum/', 'https://neetcode.io/pro']) assert.throws(() => parseProblem(value), value);
});

test('Codeforces samples preserve spaces, blank lines, and modern div line breaks', () => {
  const html = '<div class="sample-test"><div class="input"><pre>  a<br><br>b<br></pre></div><div class="output"><pre><div class="test-example-line">YES</div><div class="test-example-line">NO</div></pre></div></div>';
  const { tests } = parseStatement(html, 'codeforces');
  assert.deepEqual(tests, [{ input: '  a\n\nb\n', output: 'YES\nNO\n' }]);
  assert.throws(() => parseStatement('<div class="sample-test"><div class="input"><pre>8</pre></div></div>', 'codeforces'));
});

test('statement parsing excludes scripts and retains math and interview samples', () => {
  const { statement, tests } = parseStatement('<p>Compute <script type="math/tex">x^2</script></p><script>evil()</script><pre>Input: nums = [1,2]\nOutput: true\nExplanation: example</pre>', 'neetcode');
  assert.match(statement, /x\^2/);
  assert.doesNotMatch(statement, /evil/);
  assert.deepEqual(tests, [{ input: 'nums = [1,2]', output: 'true' }]);
});

test('output comparison supports tokens and exact whitespace', () => {
  assert.equal(normalizeOutput('1  2\n'), normalizeOutput('1\n2\n'));
  assert.notEqual(normalizeOutput(' 1\n', 'exact'), normalizeOutput('1\n', 'exact'));
  assert.equal(normalizeOutput('YES\r\n', 'exact'), 'YES');
});

test('only an explicit verdict is recognized', () => {
  assert.equal(parseVerdict('Acceptance Rate 70%\nAccepted solutions are shown below'), null);
  assert.equal(parseVerdict('Output\nAccepted\nRuntime 3 ms').accepted, true);
  assert.equal(parseVerdict('Wrong Answer\nInput: [1]').accepted, false);
});

test('refetch never overwrites a solution and gym directories are separate', async t => {
  const root = await temporary(t);
  const dir = await saveProblem(root, watermelon, solution);
  await assert.rejects(saveProblem(root, watermelon, 'different'), /Already fetched/);
  assert.equal(await readFile(path.join(dir, 'solution.js'), 'utf8'), solution + '\n');
  const { problem } = await loadProblem(dir);
  assert.equal(problem.id, '4/A');
  const gym = { ...watermelon, ...parseProblem('https://codeforces.com/gym/4/problem/A') };
  assert.notEqual(await saveProblem(root, gym, solution), dir);
});

test('manifest cannot redirect a solution to a different site or read outside its directory', async t => {
  const root = await temporary(t);
  const dir = await saveProblem(root, watermelon, solution);
  const file = path.join(dir, 'problem.json');
  const data = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...data, url: 'https://neetcode.io/problems/two-sum/question' }));
  await assert.rejects(loadProblem(dir), /disagree/);
  await writeFile(file, JSON.stringify({ ...data, file: '../secret' }));
  await assert.rejects(loadProblem(dir), /inside/);
});

test('attempts retain the exact source and uncertain submissions block a retry', async t => {
  const root = await temporary(t);
  const dir = await saveProblem(root, watermelon, solution);
  const { attempt, persist } = await beginAttempt(dir, watermelon, 'submit', solution);
  await persist({ state: 'unknown' });
  assert.equal(await readFile(path.join(dir, '.phi', 'attempts', `${attempt.id}.js`), 'utf8'), solution);
  assert.equal((await history(dir))[0].state, 'unknown');
  await assert.rejects(runProblem(dir, 'submit'), /uncertain result/);
});

test('local samples execute the saved source and record results without a browser', async t => {
  const root = await temporary(t);
  const dir = await saveProblem(root, watermelon, solution);
  const result = await runProblem(dir, 'test', {}, { withBrowser: () => assert.fail('Local tests must not contact a browser') });
  assert.equal(result.accepted, true);
  assert.equal(result.passed, 2, result.details);
  assert.equal((await history(dir))[0].state, 'finished');
  const wrong = await runLocal(dir, watermelon, 'console.log("YES")');
  assert.equal(wrong.accepted, false);
  assert.equal(wrong.cases[1].verdict, 'Wrong Answer');
});

test('runner reports crashes, timeouts, and output limits', async () => {
  const crash = await execute(process.execPath, ['-e', 'throw Error("broken")']);
  assert.notEqual(crash.code, 0);
  assert.match(crash.stderr, /broken/);
  const timeout = await execute(process.execPath, ['-e', 'while(true){}'], { timeoutMs: 100 });
  assert.equal(timeout.failure, 'Time Limit Exceeded');
  const flood = await execute(process.execPath, ['-e', 'process.stdout.write("a".repeat(100000))'], { maxBytes: 100 });
  assert.equal(flood.failure, 'Output Limit Exceeded');
});

test('interactive and function problems are not treated as stdin programs', async () => {
  await assert.rejects(runLocal('.', { ...watermelon, interactive: true }, solution), /interactor/);
  await assert.rejects(runLocal('.', { ...watermelon, platform: 'neetcode' }, solution), /remote judge/);
});

test('compiler IDs come from current options and ambiguous submissions fail closed', () => {
  assert.equal(chooseCompiler([{ id: '999', name: 'GNU G++23' }], 'cpp').id, '999');
  assert.throws(() => chooseCompiler([{ id: '1', name: 'Python 3' }], 'cpp'), /No compiler/);
  const submissions = [{ id: 2, problem: { contestId: 4, index: 'A' } }];
  assert.equal(findSubmission(submissions, new Set([1]), watermelon).id, 2);
  assert.throws(() => findSubmission([...submissions, { ...submissions[0], id: 3 }], new Set(), watermelon), /Multiple/);
});

test('LeetCode run failure cannot be reported as accepted from status code alone', () => {
  assert.equal(leetcodeResult({ state: 'PENDING' }), null);
  assert.equal(leetcodeResult({ state: 'SUCCESS', status_code: 10, correct_answer: false }).accepted, false);
  assert.equal(leetcodeResult({ state: 'SUCCESS', status_code: 10, correct_answer: true }).accepted, true);
  assert.equal(leetcodeResult({ state: 'SUCCESS', status_code: 11, status_msg: 'Wrong Answer' }).accepted, false);
});

test('LeetCode test clicks Run once and correlates results to its own ID', async () => {
  const page = new EventEmitter();
  const clicks = [];
  const updates = [];
  const response = (pathname, data) => ({ url: () => `https://leetcode.com${pathname}`, ok: () => true, json: async () => data });
  page.url = () => 'https://leetcode.com/problems/two-sum/';
  page.getByRole = (role, { name }) => ({ click: async () => {
    clicks.push(name);
    page.emit('response', response('/problems/two-sum/interpret_solution/', { interpret_id: '42' }));
    setTimeout(() => {
      page.emit('response', response('/submissions/detail/99/check/', { state: 'SUCCESS', status_code: 11 }));
      page.emit('response', response('/submissions/detail/42/check/', { state: 'SUCCESS', status_code: 10, correct_answer: true }));
    }, 10);
  } });
  const result = await executeLeetcode(page, { id: 'two-sum' }, 'test', async patch => updates.push(patch), 2000);
  assert.deepEqual(clicks, ['Run']);
  assert.equal(result.remoteId, '42');
  assert.equal(result.accepted, true);
  assert.equal(page.listenerCount('response'), 0);
  assert.ok(updates.some(update => update.remoteId === '42'));
});

test('NeetCode does not accept a stale result and never retries the submit click', async () => {
  let clicks = 0;
  const panel = { isVisible: async () => true, waitFor: async () => {}, innerText: async () => 'Accepted\nold result' };
  const page = { locator: () => ({ locator: () => panel }), getByRole: () => ({ click: async () => { clicks++; } }) };
  await assert.rejects(executeNeetcode(page, 'submit', async () => {}, 20), /Timed out/);
  assert.equal(clicks, 1);
});

test('NeetCode waits while a previous verdict remains visible during judging', async () => {
  let reads = 0;
  const states = ['Accepted\nold result', 'Accepted\nold result\nRunning', 'Wrong Answer\nnew result'];
  const panel = { isVisible: async () => true, waitFor: async () => {}, innerText: async () => states[Math.min(reads++, 2)] };
  const page = { locator: () => ({ locator: () => panel }), getByRole: () => ({ click: async () => {} }), url: () => 'https://neetcode.io/problems/duplicate-integer/question' };
  const result = await executeNeetcode(page, 'test', async () => {}, 2000);
  assert.equal(result.accepted, false);
  assert.equal(result.verdict, 'Wrong Answer');
  assert.ok(reads >= 3);
});

test('Python samples run through the actual interpreter', async t => {
  const root = await temporary(t);
  const problem = { ...watermelon, language: 'python' };
  const code = 'n=int(input())\nprint("YES" if n>2 and n%2==0 else "NO")\n';
  const dir = await saveProblem(root, problem, code);
  const result = await runLocal(dir, problem, code);
  assert.equal(result.passed, 2);
});

test('C++ samples compile and compile errors are returned before running', async t => {
  const root = await temporary(t);
  const problem = { ...watermelon, language: 'cpp' };
  const code = '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<(n>2&&n%2==0?"YES":"NO");}\n';
  const dir = await saveProblem(root, problem, code);
  const result = await runLocal(dir, problem, code);
  assert.equal(result.passed, 2);
  const broken = await runLocal(dir, problem, 'int main() { invalid syntax here; }');
  assert.equal(broken.verdict, 'Compilation Error');
  assert.equal(broken.accepted, false);
  assert.match(broken.details, /error/);
});

test('TypeScript runs locally and converts only Codeforces submissions to JavaScript', async t => {
  const root = await temporary(t);
  const problem = { ...watermelon, language: 'typescript' };
  const code = "import { readFileSync } from 'node:fs';\nconst n = Number(readFileSync(0, 'utf8'));\nconsole.log(n > 2 && n % 2 === 0 ? 'YES' : 'NO');\n";
  const dir = await saveProblem(root, problem, code);
  const result = await runLocal(dir, problem, code);
  assert.equal(result.passed, 2);
  const converted = submissionSource(problem, code);
  assert.equal(converted.problem.language, 'javascript');
  assert.match(converted.source, /require\("node:fs"\)/);
  assert.equal(submissionSource({ ...problem, platform: 'leetcode' }, code).source, code);
});

test('the Codeforces C++ template has fast I/O and compiles locally', async t => {
  const root = await temporary(t);
  const problem = { ...watermelon, language: 'cpp' };
  const code = stdinTemplate('cpp').replace('// Write your solution here.', 'int n; cin >> n; cout << (n > 2 && n % 2 == 0 ? "YES" : "NO") << \'\\n\';');
  const dir = await saveProblem(root, problem, code);
  const result = await runLocal(dir, problem, code);
  assert.equal(result.passed, 2, result.details);
  assert.match(code, /#include <bits\/stdc\+\+\.h>/);
  assert.match(code, /ios::sync_with_stdio\(false\)/);
  assert.match(code, /cin\.tie\(nullptr\)/);
});

test('system browser discovery lists every installed browser with its env usage', async () => {
  const found = await discoverSystemBrowsers();
  assert.ok(Array.isArray(found));
  for (const browser of found) {
    assert.equal(typeof browser.name, 'string');
    assert.equal(typeof browser.path, 'string');
    assert.ok(browser.channel ?? browser.executablePath, browser.name);
    assert.match(browserEnvFor(browser), /^PHI_BROWSER_(CHANNEL|EXECUTABLE)=/);
  }
  assert.equal(await detectSystemBrowser(), found[0]?.path ?? null);
});

test('browser env selection is explicit and described', () => {
  const channel = process.env.PHI_BROWSER_CHANNEL;
  const executable = process.env.PHI_BROWSER_EXECUTABLE;
  try {
    process.env.PHI_BROWSER_CHANNEL = 'chrome';
    delete process.env.PHI_BROWSER_EXECUTABLE;
    assert.deepEqual(browserLaunchOptions(), { channel: 'chrome' });
    assert.match(describeBrowser(), /chrome/);
    assert.equal(browserEnvFor({ name: 'Google Chrome', channel: 'chrome', path: '/x' }), 'PHI_BROWSER_CHANNEL=chrome');
    process.env.PHI_BROWSER_EXECUTABLE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
    assert.throws(() => browserLaunchOptions(), /only one/);
  } finally {
    if (channel === undefined) delete process.env.PHI_BROWSER_CHANNEL; else process.env.PHI_BROWSER_CHANNEL = channel;
    if (executable === undefined) delete process.env.PHI_BROWSER_EXECUTABLE; else process.env.PHI_BROWSER_EXECUTABLE = executable;
  }
});

test('browser choice persists to config and env still wins', async t => {
  const { saveBrowserChoice } = await import('../src/browser.js');
  const home = process.env.PHI_HOME;
  const channel = process.env.PHI_BROWSER_CHANNEL;
  const executable = process.env.PHI_BROWSER_EXECUTABLE;
  const root = await temporary(t);
  try {
    process.env.PHI_HOME = root;
    delete process.env.PHI_BROWSER_CHANNEL;
    delete process.env.PHI_BROWSER_EXECUTABLE;
    assert.deepEqual(browserLaunchOptions(), {});
    await saveBrowserChoice({ channel: 'msedge' });
    assert.deepEqual(browserLaunchOptions(), { channel: 'msedge' });
    assert.match(describeBrowser(), /msedge/);
    await saveBrowserChoice({ executablePath: '/tmp/fake-browser' });
    assert.deepEqual(browserLaunchOptions(), { executablePath: '/tmp/fake-browser' });
    process.env.PHI_BROWSER_CHANNEL = 'chrome';
    assert.deepEqual(browserLaunchOptions(), { channel: 'chrome' });
    await writeFile(path.join(root, 'config.json'), 'not json');
    delete process.env.PHI_BROWSER_CHANNEL;
    assert.deepEqual(browserLaunchOptions(), {});
  } finally {
    if (home === undefined) delete process.env.PHI_HOME; else process.env.PHI_HOME = home;
    if (channel === undefined) delete process.env.PHI_BROWSER_CHANNEL; else process.env.PHI_BROWSER_CHANNEL = channel;
    if (executable === undefined) delete process.env.PHI_BROWSER_EXECUTABLE; else process.env.PHI_BROWSER_EXECUTABLE = executable;
  }
});

test('upgrade reinstalls through the manager that installed phi', async () => {
  const { detectInstaller, upgradeCommand, latestVersion } = await import('../src/upgrade.js');
  assert.equal(detectInstaller('/opt/homebrew/Cellar/phi/HEAD-abc/libexec/bin/phi.js'), 'brew');
  assert.equal(detectInstaller('C:\\Program Files\\phi\\bin\\phi.js'.replaceAll('\\', '/')), 'npm');
  assert.equal(detectInstaller('/Users/a/.bun/install/global/node_modules/phi-practice/bin/phi.js'), 'bun');
  assert.equal(detectInstaller('/Users/a/.npm-global/lib/node_modules/phi-practice/bin/phi.js'), 'npm');
  assert.deepEqual(upgradeCommand('brew'), { command: 'brew', args: ['reinstall', '--HEAD', 'pol-cova/phi/phi'] });
  assert.deepEqual(upgradeCommand('bun'), { command: 'bun', args: ['add', '-g', 'github:pol-cova/phi'] });
  assert.deepEqual(upgradeCommand('npm'), { command: 'npm', args: ['install', '-g', 'github:pol-cova/phi'] });
  assert.equal(await latestVersion(async () => ({ ok: true, json: async () => ({ version: '0.2.0' }) })), '0.2.0');
  assert.equal(await latestVersion(async () => ({ ok: false })), null);
  assert.equal(await latestVersion(async () => { throw new Error('offline'); }), null);
});
