import { mkdir, writeFile, readFile, rm, chmod, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const dataHome = () => path.resolve(process.env.PHI_HOME ?? path.join(os.homedir(), '.local', 'share', 'phi'));

export const configPath = () => path.join(dataHome(), 'config.json');

// Persisted `phi setup --use` choice. Environment variables always win.
function savedBrowserOptions() {
  try {
    const config = JSON.parse(readFileSync(configPath(), 'utf8'));
    if (typeof config.browserChannel === 'string' && config.browserChannel.trim()) return { channel: config.browserChannel.trim() };
    if (typeof config.browserExecutable === 'string' && config.browserExecutable.trim()) return { executablePath: config.browserExecutable.trim() };
  } catch { /* missing or invalid config: fall through to bundled Chromium */ }
  return {};
}

export function browserLaunchOptions() {
  const channel = process.env.PHI_BROWSER_CHANNEL?.trim() || undefined;
  const executablePath = process.env.PHI_BROWSER_EXECUTABLE?.trim() || undefined;
  if (channel && executablePath) throw new Error('Set only one of PHI_BROWSER_CHANNEL or PHI_BROWSER_EXECUTABLE.');
  if (channel || executablePath) return { ...(channel ? { channel } : {}), ...(executablePath ? { executablePath } : {}) };
  return savedBrowserOptions();
}

export async function saveBrowserChoice(choice) {
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true });
  let config = {};
  try { config = JSON.parse(await readFile(file, 'utf8')); } catch { /* start fresh */ }
  delete config.browserChannel;
  delete config.browserExecutable;
  if (choice.channel) config.browserChannel = choice.channel;
  if (choice.executablePath) config.browserExecutable = choice.executablePath;
  await writeFile(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

export function describeBrowser() {
  const { channel, executablePath } = browserLaunchOptions();
  if (executablePath) return `system browser at ${executablePath}`;
  if (channel) return `system browser via channel "${channel}"`;
  return 'bundled Chromium';
}

export async function verifyBrowserLaunch() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ ...browserLaunchOptions(), headless: true });
  await browser.close();
}

function systemBrowserTable() {
  const home = os.homedir();
  const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files';
  const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
  const macApp = name => [`/Applications/${name}`, `${home}/Applications/${name}`];
  return [
    { name: 'Google Chrome', channel: 'chrome', paths: [
      ...macApp('Google Chrome.app/Contents/MacOS/Google Chrome'),
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    ] },
    { name: 'Google Chrome Beta', channel: 'chrome-beta', paths: [
      ...macApp('Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta'),
      path.join(programFiles, 'Google', 'Chrome Beta', 'Application', 'chrome.exe'),
      '/usr/bin/google-chrome-beta',
    ] },
    { name: 'Google Chrome Dev', channel: 'chrome-dev', paths: [
      ...macApp('Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'),
      path.join(programFiles, 'Google', 'Chrome Dev', 'Application', 'chrome.exe'),
      '/usr/bin/google-chrome-unstable',
    ] },
    { name: 'Google Chrome Canary', channel: 'chrome-canary', paths: [
      ...macApp('Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'),
      path.join(localAppData, 'Google', 'Chrome SxS', 'Application', 'chrome.exe'),
    ] },
    { name: 'Microsoft Edge', channel: 'msedge', paths: [
      ...macApp('Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable',
    ] },
    { name: 'Microsoft Edge Beta', channel: 'msedge-beta', paths: [
      ...macApp('Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta'),
      '/usr/bin/microsoft-edge-beta',
    ] },
    { name: 'Microsoft Edge Dev', channel: 'msedge-dev', paths: [
      ...macApp('Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev'),
      '/usr/bin/microsoft-edge-dev',
    ] },
    { name: 'Chromium', paths: [
      ...macApp('Chromium.app/Contents/MacOS/Chromium'),
      '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
    ] },
    { name: 'Brave', paths: [
      ...macApp('Brave Browser.app/Contents/MacOS/Brave Browser'),
      path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      '/usr/bin/brave-browser', '/usr/bin/brave', '/snap/bin/brave',
    ] },
    { name: 'Arc', paths: [...macApp('Arc.app/Contents/MacOS/Arc')] },
    { name: 'Vivaldi', paths: [
      ...macApp('Vivaldi.app/Contents/MacOS/Vivaldi'),
      '/usr/bin/vivaldi', '/usr/bin/vivaldi-stable',
    ] },
    { name: 'Opera', paths: [
      ...macApp('Opera.app/Contents/MacOS/Opera'),
      '/usr/bin/opera', '/snap/bin/opera',
    ] },
  ];
}

export function browserEnvFor(discovered) {
  return discovered.channel ? `PHI_BROWSER_CHANNEL=${discovered.channel}` : `PHI_BROWSER_EXECUTABLE=${JSON.stringify(discovered.executablePath)}`;
}

export async function discoverSystemBrowsers() {
  const found = [];
  for (const entry of systemBrowserTable()) {
    for (const candidate of entry.paths) {
      try {
        await access(candidate);
        found.push(entry.channel
          ? { name: entry.name, channel: entry.channel, path: candidate }
          : { name: entry.name, executablePath: candidate, path: candidate });
        break;
      } catch { /* try next path for this browser */ }
    }
  }
  return found;
}

export async function detectSystemBrowser() {
  const found = await discoverSystemBrowsers();
  return found[0]?.path ?? null;
}

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
      ...browserLaunchOptions(),
    });
    context.setDefaultTimeout(20000);
    context.setDefaultNavigationTimeout(45000);
    const page = context.pages()[0] ?? await context.newPage();
    return await action(page, context);
  } catch (error) {
    if (/Executable doesn't exist/.test(error.message)) throw new Error('Browser is not installed. Run phi setup first, or reuse your system browser with PHI_BROWSER_CHANNEL=chrome (see docs/usage.md).');
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
