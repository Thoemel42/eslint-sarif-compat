import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSarif,
  parseArgs,
  toRegion,
  toSarifArtifactLocation,
  toSarifLevel,
  toSarifResults,
} from "../eslint-sarif.mjs";

test("parseArgs reads output file options", () => {
  assert.deepEqual(parseArgs([]), { outputFile: undefined });
  assert.deepEqual(parseArgs(["-o", "a.sarif"]), { outputFile: "a.sarif" });
  assert.deepEqual(parseArgs(["--output-file", "b.sarif"]), { outputFile: "b.sarif" });
  assert.deepEqual(parseArgs(["--output-file=c.sarif"]), { outputFile: "c.sarif" });
  assert.throws(() => parseArgs(["--output-file"]), /Missing value/u);
  assert.throws(() => parseArgs(["--output-file="]), /Missing value/u);
});

test("toSarifLevel maps severities to SARIF levels", () => {
  assert.equal(toSarifLevel(2), "error");
  assert.equal(toSarifLevel(1), "warning");
  assert.equal(toSarifLevel(0), "warning");
});

test("toRegion includes provided positions and skips missing values", () => {
  assert.equal(toRegion({}), undefined);
  assert.deepEqual(
    toRegion({ line: 10, column: 0, endLine: 11, endColumn: 4 }),
    { startLine: 10, startColumn: 0, endLine: 11, endColumn: 4 },
  );
});

test("toSarifArtifactLocation uses %SRCROOT% for paths inside project", () => {
  const location = toSarifArtifactLocation("src/a.js");
  assert.equal(location.uri, "src/a.js");
  assert.equal(location.uriBaseId, "%SRCROOT%");
});

test("toSarifResults deduplicates artifacts and maps ruleIndex", () => {
  const artifacts = [];
  const artifactIndexByUri = new Map();
  const ruleIndexById = new Map([["no-undef", 0]]);

  const lintResults = [
    {
      filePath: "src/a.js",
      messages: [
        {
          severity: 2,
          message: "x is not defined",
          ruleId: "no-undef",
          line: 1,
          column: 3,
        },
      ],
      errorCount: 1,
      warningCount: 0,
    },
    {
      filePath: "src/a.js",
      messages: [
        {
          severity: 1,
          message: "Unexpected console statement",
          ruleId: "no-console",
          line: 2,
          column: 1,
        },
      ],
      errorCount: 0,
      warningCount: 1,
    },
  ];

  const sarifResults = toSarifResults(
    lintResults,
    artifacts,
    artifactIndexByUri,
    ruleIndexById,
  );

  assert.equal(artifacts.length, 1);
  assert.equal(sarifResults.length, 2);
  assert.equal(sarifResults[0].ruleId, "no-undef");
  assert.equal(sarifResults[0].ruleIndex, 0);
  assert.equal(sarifResults[1].ruleId, "no-console");
  assert.equal(sarifResults[1].ruleIndex, undefined);
  assert.equal(artifacts[0].location.uri, "src/a.js");
  assert.equal(artifacts[0].location.uriBaseId, "%SRCROOT%");
});

test("buildSarif produces SARIF 2.1.0 document", () => {
  const lintResults = [
    {
      filePath: "src/file.js",
      messages: [
        {
          severity: 2,
          message: "Unexpected var",
          ruleId: "no-var",
          line: 1,
          column: 1,
        },
      ],
      errorCount: 1,
      warningCount: 0,
    },
  ];

  const rulesMeta = {
    "no-var": {
      docs: {
        description: "Disallow var declarations",
        url: "https://eslint.org/docs/latest/rules/no-var",
      },
      type: "suggestion",
    },
  };

  const sarif = buildSarif(lintResults, rulesMeta, "10.2.0");
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].tool.driver.version, "10.2.0");
  assert.equal(sarif.runs[0].tool.driver.rules[0].id, "no-var");
  assert.equal(sarif.runs[0].results[0].ruleIndex, 0);
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uriBaseId, "%SRCROOT%");
  assert.ok(sarif.runs[0].originalUriBaseIds["%SRCROOT%"].uri.startsWith("file:/"));
});
