import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../eslint-sarif.mjs", import.meta.url));

const FIXTURE_ESLINT_CONFIG = `export default [{
  files: ["**/*.js"],
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  rules: {
    "no-console": "warn"
  }
}];
`;

function runCli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function createFixture(source) {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "eslint-sarif-compat-"));
  await mkdir(path.join(fixtureDir, "src"), { recursive: true });
  await writeFile(path.join(fixtureDir, "package.json"), '{ "type": "module" }\n', "utf8");
  await writeFile(path.join(fixtureDir, "eslint.config.js"), FIXTURE_ESLINT_CONFIG, "utf8");
  await writeFile(path.join(fixtureDir, "src", "index.js"), source, "utf8");
  return fixtureDir;
}

test("CLI exits 0 and writes SARIF for clean files", async (t) => {
  const fixtureDir = await createFixture("const value = 42;\nexport { value };\n");
  t.after(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  const outputPath = path.join(fixtureDir, "reports", "clean.sarif");
  const result = await runCli(["--output-file", outputPath], fixtureDir);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");

  const sarif = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(sarif.runs[0].results.length, 0);
});

test("CLI exits 1 for warnings and emits %SRCROOT% mapping", async (t) => {
  const fixtureDir = await createFixture("console.log('warn');\n");
  t.after(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  const outputPath = path.join(fixtureDir, "reports", "warning.sarif");
  const result = await runCli(["--output-file", outputPath], fixtureDir);

  assert.equal(result.code, 1);

  const sarif = JSON.parse(await readFile(outputPath, "utf8"));
  assert.ok(sarif.runs[0].results.length > 0);
  assert.equal(
    sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uriBaseId,
    "%SRCROOT%",
  );
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, "src/index.js");
});

test("CLI exits 2 when --output-file value is missing", async (t) => {
  const fixtureDir = await createFixture("const value = 42;\nexport { value };\n");
  t.after(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  const result = await runCli(["--output-file"], fixtureDir);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Missing value for --output-file/u);
});
