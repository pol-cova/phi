# Contributing to phi

## Install

You'll need Node.js 22+, Python 3, and a C++ compiler to run all tests.

```sh
git clone https://github.com/pol-cova/phi.git
cd phi
npm install
npm link
phi setup
```

`bun install` also works.

## What it does

Phi brings LeetCode, NeetCode, and Codeforces to your terminal. Fetch a problem, edit your solution, test it, and submit when you're ready. Python, TypeScript, C++, and JavaScript are supported.

## Contribute

1. Open an issue for a bug or idea.
2. Fork the repo and make a focused change.
3. Run `npm test` or `bun run test`.
4. Open a pull request saying what changed and how you tested it.

Platform code lives in `src/platforms/`. Local tests run through `src/runner.js`. Templates live in `templates/`.

Keep it small and useful. Don't commit account sessions or personal solutions.
