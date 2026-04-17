import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  ensureArtifact,
  parseArgs,
  toRegion,
  toSarifLevel,
  toSarifResults,
} from "./eslint-sarif.mjs";

test("parseArgs supports -o and --output-file forms", () => {
  assert.deepEqual(parseArgs(["-o", "a.sarif"]), { outputFile: "a.sarif" });
  assert.deepEqual(parseArgs(["--output-file", "b.sarif"]), { outputFile: "b.sarif" });
  assert.deepEqual(parseArgs(["--output-file=c.sarif"]), { outputFile: "c.sarif" });
});

test("parseArgs keeps last output-file value when repeated", () => {
  assert.deepEqual(parseArgs(["--output-file=a.sarif", "-o", "b.sarif"]), { outputFile: "b.sarif" });
});

test("parseArgs returns undefined outputFile when option not provided", () => {
  assert.deepEqual(parseArgs(["--foo"]), { outputFile: undefined });
});

test("toSarifLevel maps severity 2 to error and other values to warning", () => {
  assert.equal(toSarifLevel(2), "error");
  assert.equal(toSarifLevel(1), "warning");
  assert.equal(toSarifLevel(0), "warning");
});

test("toRegion maps only available location fields", () => {
  assert.deepEqual(
    toRegion({ line: 1, column: 2, endLine: 3, endColumn: 4 }),
    { startLine: 1, startColumn: 2, endLine: 3, endColumn: 4 },
  );
  assert.deepEqual(toRegion({ line: 5 }), { startLine: 5 });
  assert.equal(toRegion({}), undefined);
});

test("ensureArtifact deduplicates file artifacts and returns stable indices", () => {
  const artifacts = [];
  const indexMap = new Map();

  const first = ensureArtifact(artifacts, indexMap, "src/example.js");
  const second = ensureArtifact(artifacts, indexMap, "src/example.js");
  const third = ensureArtifact(artifacts, indexMap, "src/other.js");

  assert.equal(first.index, 0);
  assert.equal(second.index, 0);
  assert.equal(third.index, 1);
  assert.equal(artifacts.length, 2);

  const expectedFirstUri = pathToFileURL(path.resolve("src/example.js")).href;
  assert.equal(first.uri, expectedFirstUri);
  assert.deepEqual(artifacts[0], { location: { uri: expectedFirstUri } });
});

test("toSarifResults converts eslint results with rule indices and regions", () => {
  const artifacts = [];
  const artifactIndexByUri = new Map();
  const ruleIndexById = new Map([
    ["no-console", 0],
    ["eqeqeq", 1],
  ]);

  const sarifResults = toSarifResults(
    [
      {
        filePath: "src/a.js",
        messages: [
          {
            severity: 2,
            message: "Unexpected console statement.",
            line: 10,
            column: 4,
            endLine: 10,
            endColumn: 11,
            ruleId: "no-console",
          },
          {
            severity: 1,
            message: "Expected '===' and instead saw '=='.",
            ruleId: "eqeqeq",
          },
        ],
      },
    ],
    artifacts,
    artifactIndexByUri,
    ruleIndexById,
  );

  assert.equal(sarifResults.length, 2);
  assert.equal(artifacts.length, 1);

  assert.equal(sarifResults[0].level, "error");
  assert.equal(sarifResults[0].ruleId, "no-console");
  assert.equal(sarifResults[0].ruleIndex, 0);
  assert.deepEqual(sarifResults[0].locations[0].physicalLocation.region, {
    startLine: 10,
    startColumn: 4,
    endLine: 10,
    endColumn: 11,
  });

  assert.equal(sarifResults[1].level, "warning");
  assert.equal(sarifResults[1].ruleId, "eqeqeq");
  assert.equal(sarifResults[1].ruleIndex, 1);
  assert.equal(sarifResults[1].locations[0].physicalLocation.region, undefined);
});

test("toSarifResults omits ruleIndex when rule is unknown and omits ruleId when absent", () => {
  const sarifResults = toSarifResults(
    [
      {
        filePath: "src/a.js",
        messages: [
          { severity: 1, message: "Unknown rule", ruleId: "custom/unknown" },
          { severity: 1, message: "No rule id" },
        ],
      },
    ],
    [],
    new Map(),
    new Map([["known", 0]]),
  );

  assert.equal(sarifResults.length, 2);
  assert.equal(sarifResults[0].ruleId, "custom/unknown");
  assert.equal("ruleIndex" in sarifResults[0], false);
  assert.equal("ruleId" in sarifResults[1], false);
  assert.equal("ruleIndex" in sarifResults[1], false);
});
