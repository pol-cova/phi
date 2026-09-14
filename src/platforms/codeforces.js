import { languages, stdinTemplate } from '../problem.js';
import { parseStatement } from '../content.js';
import { navigate, pollUntil } from '../browser.js';

export async function fetchCodeforces(page, ref, language) {
  await navigate(page, ref.url);
  const statement = page.locator('.problem-statement');
  await statement.waitFor({ state: 'visible' });
  const title = await statement.locator('.header > .title').innerText();
  const html = await statement.innerHTML();
  const content = parseStatement(html, 'codeforces');
  const interactive = /interactive/i.test(await statement.locator('.input-file').innerText().catch(() => '')) || /This is an interactive problem/i.test(content.statement);
  return { problem: { ...ref, ...content, title, language, interactive, testMode: 'local' }, code: stdinTemplate(language) };
}

export function chooseCompiler(options, language, requested) {
  if (requested) {
    const match = options.find(option => option.id === requested);
    if (!match) throw new Error(`Compiler ${requested} is not available. Use phi languages.`);
    if (['javascript', 'typescript'].includes(language) && !languages.javascript.compiler.test(match.name)) throw new Error('JavaScript and TypeScript submissions require a Node.js compiler.');
    return match;
  }
  const match = options.find(option => languages[language].compiler.test(option.name));
  if (!match) throw new Error(`No compiler found for ${language}. Use phi languages, then phi submit --compiler ID.`);
  return match;
}

export async function compilerOptions(page, problem) {
  await navigate(page, `https://codeforces.com/${problem.contestKind}/${problem.contestId}/submit`);
  if (new URL(page.url()).pathname.startsWith('/enter')) throw new Error('Sign in first: phi login codeforces');
  const select = page.locator('select[name="programTypeId"]');
  await select.waitFor({ state: 'visible' });
  return select.locator('option').evaluateAll(elements => elements.map(element => ({ id: element.value, name: element.textContent.trim() })));
}

export async function prepareCodeforces(page, problem, source, compilerId) {
  const options = await compilerOptions(page, problem);
  const compiler = chooseCompiler(options, problem.language, compilerId);
  await page.locator('select[name="programTypeId"]').selectOption(compiler.id);
  await page.locator('select[name="submittedProblemIndex"]').selectOption(problem.index);
  const upload = page.locator('input[type="file"][name="sourceFile"]');
  if (await upload.count()) {
    await upload.setInputFiles({ name: problem.file, mimeType: 'text/plain', buffer: Buffer.from(source) });
  } else {
    const textarea = page.locator('textarea[name="source"]');
    await textarea.fill(source);
    if (await textarea.inputValue() !== source) throw new Error('The source field did not retain the exact solution.');
  }
  const profile = page.locator('#header a[href^="/profile/"]');
  const href = await profile.first().getAttribute('href');
  const handle = href?.split('/').at(-1);
  if (!handle) throw new Error('Could not identify the signed-in Codeforces account. Nothing was submitted.');
  return { handle, compiler };
}

export function createStatusReader(page, handle) {
  let lastCall = 0;
  return async () => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 2100 - (Date.now() - lastCall))));
    lastCall = Date.now();
    const response = await page.request.get(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=30`, { timeout: 20000 });
    if (!response.ok()) throw new Error(`Codeforces status returned HTTP ${response.status()}.`);
    const payload = await response.json();
    if (payload.status !== 'OK') throw new Error(payload.comment ?? 'Codeforces status is unavailable.');
    return payload.result;
  };
}

export function findSubmission(submissions, baseline, problem) {
  const candidates = submissions.filter(s => !baseline.has(s.id) && s.problem.contestId === problem.contestId && s.problem.index === problem.index);
  if (candidates.length > 1) throw new Error('Multiple new submissions match this problem. Check the website to identify your attempt.');
  return candidates[0];
}

export async function executeCodeforces(page, problem, session, persist, timeoutMs) {
  const readStatus = createStatusReader(page, session.handle);
  const baseline = new Set((await readStatus()).map(s => s.id));
  let remoteId;
  await persist({ state: 'sending', account: session.handle, compiler: session.compiler });
  await page.getByRole('button', { name: /^Submit$/i }).click();
  return pollUntil(async () => {
    const submissions = await readStatus();
    const submission = remoteId ? submissions.find(s => s.id === remoteId) : findSubmission(submissions, baseline, problem);
    if (!submission) return null;
    const resultUrl = `https://codeforces.com/${problem.contestKind}/${problem.contestId}/submission/${submission.id}`;
    if (!remoteId) {
      remoteId = submission.id;
      await persist({ state: 'judging', remoteId, resultUrl });
    }
    if (!submission.verdict || submission.verdict === 'TESTING') return null;
    return { remoteId, resultUrl, verdict: submission.verdict, accepted: submission.verdict === 'OK', runtime: `${submission.timeConsumedMillis} ms`, memory: `${Math.round(submission.memoryConsumedBytes / 1024)} KB`, passed: submission.passedTestCount };
  }, timeoutMs, 100);
}
