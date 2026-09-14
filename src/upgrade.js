import { fileURLToPath } from 'node:url';

export const REPO = 'pol-cova/phi';
export const SOURCE = `github:${REPO}`;
const BREW_FORMULA = 'pol-cova/phi/phi';

// Which package manager installed this copy of phi, inferred from where the
// running code lives on disk. Falls back to npm, which also accepts the
// github: shorthand used for every install method below.
export function detectInstaller(scriptPath = fileURLToPath(import.meta.url)) {
  const normalized = scriptPath.replaceAll('\\', '/');
  if (normalized.includes('/Cellar/')) return 'brew';
  if (normalized.includes('/.bun/install/global/')) return 'bun';
  return 'npm';
}

export function upgradeCommand(installer) {
  if (installer === 'brew') return { command: 'brew', args: ['reinstall', '--HEAD', BREW_FORMULA] };
  if (installer === 'bun') return { command: 'bun', args: ['add', '-g', SOURCE] };
  return { command: 'npm', args: ['install', '-g', SOURCE] };
}

// Latest published version on main. Returns null when offline so callers can
// still reinstall blind instead of failing the upgrade.
export async function latestVersion(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`https://raw.githubusercontent.com/${REPO}/main/package.json`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const { version } = await response.json();
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}
