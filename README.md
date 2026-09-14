# phi

Your editor, your terminal, your next accepted solution.

Fetch problems, run tests, and submit to LeetCode, NeetCode, and Codeforces. Write Python, TypeScript, C++, or JavaScript.

## Install

Node.js 22+ is required.

```sh
# npm
npm install -g github:pol-cova/phi

# Bun
bun add -g github:pol-cova/phi

# Homebrew
brew tap pol-cova/phi https://github.com/pol-cova/phi
brew install --HEAD pol-cova/phi/phi
```

Then install the browser once:

```sh
phi setup
```

Bun handles installation; Node runs the CLI. Homebrew installs Node for you.

## Solve something

```sh
phi login lc
phi fetch lc:two-sum --lang ts
cd practice/leetcode/two-sum

phi show
phi edit
phi test
phi submit
```

Sign in once per platform with `phi login lc`, `phi login nc`, or `phi login cf`.

```sh
phi fetch nc:duplicate-integer --lang py
phi fetch cf:4/A --lang cpp
```

Codeforces C++ files start with `bits/stdc++.h`, fast I/O, and a `solve()` function. Local C++ tests compile with `-O2`.

## What runs where

| | LeetCode / NeetCode | Codeforces |
| --- | --- | --- |
| `phi test` | Runs on the site's judge | Runs downloaded samples locally |
| TypeScript | Submitted as TypeScript | Compiled to JavaScript for Node.js |
| `phi submit` | Sends to the selected platform | Uses the Codeforces submission form |

`phi test` never submits. `phi submit` sends your saved file. `phi history` keeps attempts, source snapshots, and results.

Run `phi --help` or read the [short guide](docs/usage.md) for everything else.

This is an early release. Fetching and local runners are tested. Signed-in remote tests and submissions still need live verification, and website changes can break integrations.

## Contribute

Small fixes welcome. See [contributing.md](contributing.md).

MIT license.
