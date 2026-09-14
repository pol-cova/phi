import { mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const dataHome = () => path.resolve(process.env.PHI_HOME ?? path.join(os.homedir(), '.local', 'share', 'phi'));

export async function withBrowser(platform, options, action) {
  const { chromium } = await import('playwright');
  const profile = path.join(dataHome(), 'browsers', platform);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await chmod(profile, 0o700);
  const lock = `${profile}.lock`;
  try { await mkdir(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(`Another phi command may be using ${platform}. Close it first. If it crashed, remove ${lock} after verifying no phi browser is running.`);
  }
  let context;
  try {
    await writeFile(path.join(lock, 'pid'), String(process.pid));
    context = await chromium.launchPersistentContext(profile, {
      headless: !options.show,
      viewport: { width: 1440, height: 1000 },
      locale: 'en-US',
      ...(process.env.PHI_BROWSER_CHANNEL ? { channel: process.env.PHI_BROWSER_CHANNEL } : {}),
    });
    context.setDefaultTimeout(20000);
    context.setDefaultNavigationTimeout(45000);
    const page = context.pages()[0] ?? await context.newPage();
    return await action(page, context);
  } catch (error) {
    if (/Executable doesn't exist/.test(error.message)) throw new Error('Browser is not installed. Run phi setup first.');
    throw error;
  } finally {
    try { await context?.close(); } finally { await rm(lock, { recursive: true, force: true }); }
  }
}

export async function forgetSession(platform) {
  const profile = path.join(dataHome(), 'browsers', platform);
  try { await readFile(path.join(`${profile}.lock`, 'pid')); throw new Error('Close the running phi command before logging out.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rm(profile, { recursive: true, force: true });
}

export async function navigate(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

export async function readEditor(page) {
  const editor = page.getByRole('textbox', { name: 'Code editor', exact: true });
  await editor.waitFor({ state: 'visible' });
  await editor.press('ControlOrMeta+a');
  const code = await editor.inputValue();
  await editor.press('ArrowLeft');
  if (!code.trim()) throw new Error('The site returned an empty editor. Select a supported language and retry.');
  return code.replace(/\r\n/g, '\n');
}

export async function writeEditor(page, code) {
  const editor = page.getByRole('textbox', { name: 'Code editor', exact: true });
  await editor.waitFor({ state: 'visible' });
  await editor.press('ControlOrMeta+a');
  await page.keyboard.insertText(code);
  const actual = await readEditor(page);
  if (actual !== code.replace(/\r\n/g, '\n')) throw new Error('The website editor did not retain the exact source. Nothing was submitted.');
}

export async function pollUntil(read, timeoutMs = 120000, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await read();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for the judge. Check the website and phi history before submitting again.');
}
