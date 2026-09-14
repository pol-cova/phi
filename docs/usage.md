# A little more phi

Each fetch creates `problem.md`, `problem.json`, `tests.json`, and a solution file under `./practice`. An existing solution is never overwritten. Use `--out DIR` to change that folder.

Use `--lang py`, `--lang ts`, `--lang cpp`, or `--lang js`. Full names work too. Python is the default for interview problems and C++ for Codeforces.

## Tests and languages

- **Codeforces:** edit `tests.json` to add input/output pairs. Tests compare whitespace-separated tokens by default. Add `--exact` to compare spacing. Interactive problems and custom checkers need their own runner.
- **LeetCode / NeetCode:** remote tests use the site's current test cases. Use `phi open` to change them. Downloaded `tests.json` is only a reference copy.
- **TypeScript on Codeforces:** phi compiles your code to CommonJS JavaScript and submits it with Node.js. Phi keeps both the TypeScript source and submitted JavaScript. External packages are not bundled.
- **C++:** local tests use C++17 and `-O2`. The template works with GCC and Apple Clang.

## Handy commands

```sh
phi test --timeout 3000
phi languages
phi submit --compiler ID
phi history --json
phi open
phi doctor
phi logout nc
```

Use `--show` to display the browser for remote operations.

## Sessions and retries

Phi saves separate browser profiles under `~/.local/share/phi/browsers`. Set `PHI_HOME` to move them. Sign in again when a session expires.

If a submission times out, check `phi history` and the site before trying again. Phi requires `--retry` after an uncertain submission so it does not send your code twice.

## Staying up to date

```sh
phi upgrade         # reinstall through npm, Bun, or Homebrew — whichever installed phi
phi upgrade --force # reinstall even when already on the latest version
```

Phi checks the latest version on `main` first and stops when there is nothing to do. Your browser and saved sessions are kept.

## Configuration

| Variable | Purpose |
| --- | --- |
| `VISUAL` / `EDITOR` | Editor, default `vi` |
| `PHI_HOME` | Session storage directory |
| `PHI_PYTHON` | Python executable, default `python3` |
| `CXX` | C++ compiler executable, default `c++` |
| `PHI_BROWSER_CHANNEL` | Reuse a system browser instead of the ~200 MB download, e.g. `chrome`, `chrome-beta`, `msedge` (`phi setup` lists what it finds) |
| `PHI_BROWSER_EXECUTABLE` | Full path to a browser binary (takes precedence over the channel; set only one of the two) |

## Browser setup without the download

`phi setup` first looks for browsers you already have (Chrome, Edge, Chromium, Brave, Arc, Vivaldi, Opera) and lists them with the exact variable to reuse one. No guessing:

```sh
phi setup
# Found 2 system browsers — no download needed:
#   Google Chrome  PHI_BROWSER_CHANNEL=chrome  (/Applications/Google Chrome.app/...)
#   Brave          PHI_BROWSER_EXECUTABLE="/Applications/Brave Browser.app/..."
```

Easiest is to remember one (no env vars needed):

```sh
phi setup --use chrome   # saves the default and verifies it launches
```

In an interactive terminal plain `phi setup` lists what it found and offers to remember it. The choice is saved to `~/.local/share/phi/config.json` (honoring `PHI_HOME`); `PHI_BROWSER_CHANNEL` / `PHI_BROWSER_EXECUTABLE` still override it when set, e.g. `export PHI_BROWSER_CHANNEL=chrome`. If both variables are set, phi errors out so the choice stays explicit. `phi setup --bundled` forces the ~200 MB bundled Chromium download even when a system browser exists, and `phi setup --json` prints the discovered list for scripts.

Why a real browser at all? The sites sit behind bot protection (Codeforces returns a Cloudflare challenge to plain `curl`), and login plus the LeetCode/NeetCode editors need JavaScript. Reusing your installed browser keeps that compatibility without the extra download.
