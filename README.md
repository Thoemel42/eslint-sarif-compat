# eslint-sarif-compat

A compact SARIF generator for ESLint `10.2.x` when the built-in SARIF formatter is not compatible.

This script runs ESLint and outputs valid SARIF 2.1.0 JSON, for example for GitHub Code Scanning.

## Why this project?

With ESLint `10.2.x`, using the SARIF formatter directly can be problematic.  
`eslint-sarif-compat` provides a simple, stable workaround:

- lints files through the ESLint Node API
- maps findings to SARIF `results`
- emits relative artifact URIs using `%SRCROOT%` for better GitHub mapping
- writes output to a file or `stdout`
- sets exit code `1` when errors or warnings are found

## Requirements

- Node.js 20+ (recommended)
- npm

## Usage

### 1. Run the script

```bash
npm install
npm run sarif -- --output-file reports/eslint.sarif
```

Without `--output-file`, SARIF is written to `stdout`:

```bash
node eslint-sarif.mjs > reports/eslint.sarif
```

If `--output-file` is passed without a value, the CLI exits with code `2`.

### 2. Adjust lint targets

The currently linted targets are defined in `LINT_TARGETS`:

```js
const LINT_TARGETS = ["src", ".storybook", "vite.config.ts", "eslint.config.js"];
```

Adjust this list to match your project.

## Development

Run tests:

```bash
npm test
```

Run linting:

```bash
npm run lint
```

## Exit codes

- `0`: successful run, no findings
- `1`: successful run, but errors/warnings found
- `2`: technical execution error

## GitHub Actions example

```yaml
name: ESLint SARIF

on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: node eslint-sarif.mjs --output-file reports/eslint.sarif
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: reports/eslint.sarif
```

## Limitations

- Not a drop-in replacement for every ESLint formatter option
- Focused on SARIF output for CI/code scanning
- Only paths defined in `LINT_TARGETS` are linted

## License

MIT. See [LICENSE](LICENSE).
