import { readFileSync } from 'node:fs';

const aliases = { lc: 'leetcode', leetcode: 'leetcode', nc: 'neetcode', neetcode: 'neetcode', cf: 'codeforces', codeforces: 'codeforces' };

export function platformName(value) {
  const platform = aliases[value?.toLowerCase()];
  if (!platform) throw new Error('Choose leetcode, neetcode, or codeforces.');
  return platform;
}

export function parseProblem(input) {
  let platform, id, contestKind = 'contest';
  if (/^https?:\/\//.test(input)) {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Use an HTTPS problem URL without credentials or a custom port.');
    platform = { 'leetcode.com': 'leetcode', 'neetcode.io': 'neetcode', 'codeforces.com': 'codeforces' }[url.hostname.replace(/^www\./, '')];
    if (!platform) throw new Error('Unsupported problem website.');
    if (platform === 'codeforces') {
      const match = url.pathname.match(/^\/(?:problemset\/problem|contest|gym)\/(\d+)\/(?:problem\/)?([A-Za-z]\d*)\/?$/);
      if (!match) throw new Error('Use a Codeforces problemset, contest, or gym problem URL.');
      contestKind = url.pathname.startsWith('/gym/') ? 'gym' : 'contest';
      id = `${match[1]}/${match[2].toUpperCase()}`;
    } else id = url.pathname.match(/^\/problems\/([a-z0-9-]+)(?:\/(?:description|question|submissions|history))?\/?$/)?.[1];
  } else {
    const match = input.match(/^([^:]+):(.+)$/);
    if (!match) throw new Error('Use lc:two-sum, nc:duplicate-integer, cf:4/A, or a problem URL.');
    platform = platformName(match[1]);
    id = match[2];
    if (platform === 'codeforces') {
      const parts = id.match(/^(\d+)\/?([A-Za-z]\d*)$/);
      if (!parts) throw new Error('Codeforces IDs look like cf:4/A or cf:4A.');
      id = `${parts[1]}/${parts[2].toUpperCase()}`;
    }
  }
  if (!id || (platform !== 'codeforces' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))) throw new Error('Invalid problem slug.');
  const [contestId, index] = id.split('/');
  const url = platform === 'codeforces'
    ? `https://codeforces.com/${contestKind}/${contestId}/problem/${index}`
    : `https://${platform === 'leetcode' ? 'leetcode.com' : 'neetcode.io'}/problems/${id}/${platform === 'leetcode' ? 'description/' : 'question'}`;
  return { platform, id, url, ...(platform === 'codeforces' ? { contestId: Number(contestId), index, contestKind } : {}) };
}

export const languages = {
  python: { extension: 'py', leetcode: 'Python3', neetcode: 'Python', compiler: /^(?:Python 3|PyPy 3)/ },
  cpp: { extension: 'cpp', leetcode: 'C++', neetcode: 'C++', compiler: /(?:GNU|Clang).*[GC]\+\+(?:17|20|23)/ },
  javascript: { extension: 'js', leetcode: 'JavaScript', neetcode: 'JavaScript', compiler: /(?:JavaScript|Node\.js)/ },
  typescript: { extension: 'ts', leetcode: 'TypeScript', neetcode: 'TypeScript', compiler: /Node\.js/ },
};

export function languageName(value) {
  const language = { py: 'python', python3: 'python', 'c++': 'cpp', js: 'javascript', ts: 'typescript' }[value] ?? value;
  if (!languages[language]) throw new Error('Supported languages: python, typescript, cpp, javascript.');
  return language;
}

export function stdinTemplate(language) {
  if (language === 'cpp') return readFileSync(new URL('../templates/codeforces.cpp', import.meta.url), 'utf8');
  if (language === 'typescript') return "import { readFileSync } from 'node:fs';\n\nconst input = readFileSync(0, 'utf8').trim();\n\nfunction solve(input: string): void {\n    // Write your solution here.\n}\n\nsolve(input);\n";
  if (language === 'javascript') return "const fs = require('node:fs');\nconst input = fs.readFileSync(0, 'utf8').trim();\n// Write your solution here.\n";
  return 'import sys\n\n\ndef solve():\n    data = sys.stdin.read()\n    # Write your solution here.\n\n\nif __name__ == "__main__":\n    solve()\n';
}
