import { mkdir, readFile, writeFile, rename, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { parseProblem, languageName, languages } from './problem.js';

export async function writeJSON(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, file);
}

export async function saveProblem(root, problem, code) {
  const suffix = problem.contestKind === 'gym' ? 'gym-' : '';
  const directory = path.resolve(root, problem.platform, suffix + problem.id.replaceAll('/', '-'));
  await mkdir(directory, { recursive: true });
  try { await access(path.join(directory, 'problem.json')); throw new Error(`Already fetched: ${directory}. Your files were left intact.`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const file = `solution.${languages[problem.language].extension}`;
  await writeFile(path.join(directory, file), code.replace(/\r\n/g, '\n') + '\n', { flag: 'wx' });
  await writeFile(path.join(directory, 'problem.md'), `# ${problem.title}\n\n${problem.url}\n\n${problem.statement}\n`, { flag: 'wx' });
  await writeFile(path.join(directory, 'tests.json'), JSON.stringify(problem.tests, null, 2) + '\n', { flag: 'wx' });
  await writeJSON(path.join(directory, 'problem.json'), { ...problem, file, fetchedAt: new Date().toISOString(), version: 1 });
  return directory;
}

export async function loadProblem(directory) {
  const dir = path.resolve(directory);
  let problem;
  try { problem = JSON.parse(await readFile(path.join(dir, 'problem.json'), 'utf8')); }
  catch (error) { throw new Error(`Cannot load ${dir}/problem.json. Run phi fetch first.`, { cause: error }); }
  const canonical = parseProblem(problem.url);
  if (canonical.platform !== problem.platform || canonical.id !== problem.id) throw new Error('Problem URL and ID disagree. Refetch into a new directory.');
  languageName(problem.language);
  if (typeof problem.file !== 'string' || path.basename(problem.file) !== problem.file) throw new Error('Solution file must be inside the problem directory.');
  return { directory: dir, problem: { ...problem, ...canonical } };
}

export async function beginAttempt(directory, problem, operation, source) {
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const folder = path.join(directory, '.phi', 'attempts');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${id}.${languages[problem.language].extension}`), source, { mode: 0o600, flag: 'wx' });
  const attempt = { id, operation, platform: problem.platform, problemId: problem.id, language: problem.language, startedAt: new Date().toISOString(), sourceHash: createHash('sha256').update(source).digest('hex'), state: 'prepared' };
  const persist = async (patch) => { Object.assign(attempt, patch); await writeJSON(path.join(folder, `${id}.json`), attempt); };
  await persist({});
  return { attempt, persist };
}

export async function history(directory) {
  const folder = path.join(directory, '.phi', 'attempts');
  let files;
  try { files = await readdir(folder); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return Promise.all(files.filter(file => file.endsWith('.json')).sort().reverse().map(async file => JSON.parse(await readFile(path.join(folder, file), 'utf8'))));
}
