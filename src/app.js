import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseProblem, languageName } from './problem.js';
import { withBrowser, navigate } from './browser.js';
import { saveProblem, loadProblem, beginAttempt, history } from './storage.js';
import { fetchInterview, prepareInterview, executeLeetcode, executeNeetcode } from './platforms/interview.js';
import { fetchCodeforces, prepareCodeforces, executeCodeforces } from './platforms/codeforces.js';
import { runLocal } from './runner.js';
import { submissionSource } from './typescript.js';

export async function fetchProblem(input, options) {
  const ref = parseProblem(input);
  const language = languageName(options.lang ?? (ref.platform === 'codeforces' ? 'cpp' : 'python'));
  const { problem, code } = await withBrowser(ref.platform, options, page => ref.platform === 'codeforces' ? fetchCodeforces(page, ref, language) : fetchInterview(page, ref, language));
  return saveProblem(options.out ?? path.resolve('practice'), problem, code);
}

export async function runProblem(directory, operation, options = {}, dependencies = {}) {
  const { problem, directory: dir } = await loadProblem(directory);
  if (operation === 'submit' && !options.retry) {
    const unresolved = (await history(dir)).find(a => a.operation === 'submit' && ['sending', 'judging', 'unknown'].includes(a.state));
    if (unresolved) throw new Error(`Attempt ${unresolved.id} has an uncertain result. Check phi history and the website, then use --retry only if you intend another submission.`);
  }
  const source = await readFile(path.join(dir, problem.file), 'utf8');
  if (!source.trim()) throw new Error('The solution file is empty.');
  const { attempt, persist } = await beginAttempt(dir, problem, operation, source);
  const browser = dependencies.withBrowser ?? withBrowser;
  try {
    let result;
    if (operation === 'test' && (problem.platform === 'codeforces' || options.local)) {
      result = await runLocal(dir, problem, source, options);
    } else {
      const submission = submissionSource(problem, source);
      if (submission.source !== source) {
        const submittedFile = `${attempt.id}.submitted.js`;
        await writeFile(path.join(dir, '.phi', 'attempts', submittedFile), submission.source, { mode: 0o600, flag: 'wx' });
        await persist({ submittedLanguage: submission.problem.language, submittedFile, submittedSourceHash: createHash('sha256').update(submission.source).digest('hex') });
      }
      result = await browser(problem.platform, options, async page => {
        if (problem.platform === 'codeforces') {
          const session = await prepareCodeforces(page, submission.problem, submission.source, options.compiler);
          return executeCodeforces(page, problem, session, persist, options.timeoutMs ?? 120000);
        }
        await prepareInterview(page, problem, source);
        return problem.platform === 'leetcode'
          ? executeLeetcode(page, problem, operation, persist, options.timeoutMs ?? 120000)
          : executeNeetcode(page, operation, persist, options.timeoutMs ?? 120000);
      });
    }
    await persist({ state: 'finished', finishedAt: new Date().toISOString(), ...result });
    return attempt;
  } catch (error) {
    await persist({ state: ['sending', 'judging'].includes(attempt.state) ? 'unknown' : 'failed', error: error.message });
    throw error;
  }
}

export async function openProblem(directory, wait) {
  const { problem } = await loadProblem(directory);
  return withBrowser(problem.platform, { show: true }, async page => { await navigate(page, problem.url); await wait('Press Enter here to close the browser. '); });
}
