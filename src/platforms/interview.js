import { languages } from '../problem.js';
import { parseStatement, parseVerdict } from '../content.js';
import { navigate, readEditor, writeEditor, pollUntil } from '../browser.js';

const languageButtons = /^(Python3?|C\+\+|JavaScript|TypeScript|Java|C#|C|Go|Kotlin|Swift|Rust|Ruby|PHP|Dart|Scala|Elixir|Erlang|Racket)$/;

export async function selectLanguage(page, platform, language) {
  const label = languages[language][platform];
  const trigger = platform === 'neetcode'
    ? page.locator('.editor-language-btn')
    : page.getByRole('button', { name: languageButtons });
  await trigger.waitFor({ state: 'visible' });
  if ((await trigger.innerText()).trim() === label) return;
  await trigger.click();
  if (platform === 'neetcode') {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await page.locator('#dropdown-menu3').getByRole('button', { name: new RegExp(`^${escaped}\\s`) }).click();
  } else await page.getByText(label, { exact: true }).click();
  await pollUntil(async () => (await trigger.innerText()).trim() === label, 10000, 100);
}

export async function fetchInterview(page, ref, language) {
  await navigate(page, ref.url);
  const statement = page.locator(ref.platform === 'neetcode' ? 'main.neeter-article-content' : '[data-track-load="description_content"]');
  await statement.waitFor({ state: 'visible' });
  const title = ref.platform === 'neetcode'
    ? await page.getByRole('heading', { level: 1 }).innerText()
    : (await page.title()).replace(/ - LeetCode$/, '');
  const content = parseStatement(await statement.innerHTML(), ref.platform);
  await selectLanguage(page, ref.platform, language);
  const code = await readEditor(page);
  return { problem: { ...ref, ...content, title, language, testMode: 'remote' }, code };
}

export async function isInterviewLoggedIn(page, platform) {
  if (platform === 'neetcode') {
    const run = page.getByRole('button', { name: 'Run', exact: true });
    await run.waitFor({ state: 'visible' });
    return run.isEnabled();
  }
  await page.getByRole('textbox', { name: 'Code editor', exact: true }).waitFor({ state: 'visible' });
  return !(await page.locator('#navbar_sign_in_button').isVisible())
    && !(await page.getByText('You need to', { exact: true }).isVisible());
}

export async function prepareInterview(page, problem, source) {
  await navigate(page, problem.url);
  await page.getByRole('textbox', { name: 'Code editor', exact: true }).waitFor({ state: 'visible' });
  if (!await isInterviewLoggedIn(page, problem.platform)) throw new Error(`Sign in first: phi login ${problem.platform}`);
  await selectLanguage(page, problem.platform, problem.language);
  await writeEditor(page, source);
  const button = page.getByRole('button', { name: 'Run', exact: true });
  if (!await button.isEnabled()) throw new Error('The judge is unavailable or the account needs attention. Open the site with phi open.');
}

// LeetCode's check response belongs to the ID returned by this exact run/submit.
export function leetcodeResult(payload) {
  if (payload.state !== 'SUCCESS') return null;
  const accepted = payload.status_code === 10 && payload.correct_answer !== false;
  return {
    verdict: payload.status_msg ?? (accepted ? 'Accepted' : 'Failed'), accepted,
    runtime: payload.status_runtime, memory: payload.status_memory,
    passed: payload.total_correct, total: payload.total_testcases,
    details: [payload.compile_error, payload.runtime_error, payload.std_output,
      payload.last_testcase ? `Input: ${payload.last_testcase}` : '',
      payload.code_output ? `Output: ${payload.code_output}` : '',
      payload.expected_output ? `Expected: ${payload.expected_output}` : '',
      payload.code_answer ? `Output: ${JSON.stringify(payload.code_answer)}` : '',
      payload.expected_code_answer ? `Expected: ${JSON.stringify(payload.expected_code_answer)}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export async function executeLeetcode(page, problem, operation, persist, timeoutMs) {
  const endpoint = operation === 'submit' ? 'submit' : 'interpret_solution';
  let remoteId, result, requestError;
  const writes = [];
  const onResponse = async response => {
    try {
      const url = new URL(response.url());
      if (url.hostname !== 'leetcode.com') return;
      if (url.pathname === `/problems/${problem.id}/${endpoint}/`) {
        if (!response.ok()) { requestError = new Error(`LeetCode returned HTTP ${response.status()}. Check your session and website history.`); return; }
        const payload = await response.json();
        remoteId = String(payload.submission_id ?? payload.interpret_id ?? '');
        if (!remoteId) { requestError = new Error(payload.error ?? 'LeetCode did not return a submission ID.'); return; }
        writes.push(persist({ state: 'judging', remoteId, resultUrl: `https://leetcode.com/submissions/detail/${remoteId}/` }));
      } else if (remoteId && url.pathname === `/submissions/detail/${remoteId}/check/`) {
        result = leetcodeResult(await response.json());
      }
    } catch (error) { requestError = error; }
  };
  const listener = response => { const work = onResponse(response); writes.push(work); };
  page.on('response', listener);
  try {
    await persist({ state: 'sending' });
    await page.getByRole('button', { name: operation === 'submit' ? 'Submit' : 'Run', exact: true }).click();
    return await pollUntil(async () => {
      if (requestError) throw requestError;
      return result && { ...result, remoteId, resultUrl: page.url() };
    }, timeoutMs);
  } finally {
    page.off('response', listener);
    await Promise.all(writes);
  }
}

export async function executeNeetcode(page, operation, persist, timeoutMs) {
  // Scope results to the console, excluding the statement, hints, and old history.
  const consolePanel = page.locator('.console-tabs').locator('..');
  if (!await consolePanel.isVisible()) await page.getByRole('button', { name: /^Console/ }).click();
  await consolePanel.waitFor({ state: 'visible' });
  const before = await consolePanel.innerText();
  const button = page.getByRole('button', { name: operation === 'submit' ? 'Submit' : 'Run', exact: true });
  let observedBusy = false;
  await persist({ state: 'sending' });
  await button.click();
  return pollUntil(async () => {
    const text = await consolePanel.innerText();
    if (/\b(?:Running|Judging|Pending|Submitting)\b/i.test(text)) { observedBusy = true; return null; }
    if (text === before && !observedBusy) return null;
    const verdict = parseVerdict(text);
    if (!verdict) return null;
    return { ...verdict, resultUrl: page.url() };
  }, timeoutMs);
}
