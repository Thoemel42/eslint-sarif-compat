import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LINT_TARGETS = ["src", ".storybook", "vite.config.ts", "eslint.config.js"];

export function parseArgs(argv) {
  let outputFile;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-o" || arg === "--output-file") {
      outputFile = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith("--output-file=")) {
      outputFile = arg.slice("--output-file=".length);
    }
  }

  return { outputFile };
}

export function toSarifLevel(severity) {
  return severity === 2 ? "error" : "warning";
}

export function toRegion(message) {
  const region = {};

  if (message.line) {
    region.startLine = message.line;
  }
  if (message.column) {
    region.startColumn = message.column;
  }
  if (message.endLine) {
    region.endLine = message.endLine;
  }
  if (message.endColumn) {
    region.endColumn = message.endColumn;
  }

  return Object.keys(region).length > 0 ? region : undefined;
}

export function ensureArtifact(artifacts, artifactIndexByUri, filePath) {
  const uri = pathToFileURL(path.resolve(filePath)).href;

  let index = artifactIndexByUri.get(uri);
  if (index === undefined) {
    index = artifacts.length;
    artifactIndexByUri.set(uri, index);
    artifacts.push({
      location: {
        uri,
      },
    });
  }

  return { uri, index };
}

export function toSarifResults(results, artifacts, artifactIndexByUri, ruleIndexById) {
  const sarifResults = [];

  for (const result of results) {
    const artifact = ensureArtifact(artifacts, artifactIndexByUri, result.filePath);

    for (const message of result.messages) {
      const region = toRegion(message);
      const physicalLocation = {
        artifactLocation: {
          uri: artifact.uri,
          index: artifact.index,
        },
      };

      if (region) {
        physicalLocation.region = region;
      }

      const sarifResult = {
        level: toSarifLevel(message.severity),
        message: { text: message.message },
        locations: [{ physicalLocation }],
      };

      if (message.ruleId) {
        sarifResult.ruleId = message.ruleId;
        const ruleIndex = ruleIndexById.get(message.ruleId);
        if (ruleIndex !== undefined) {
          sarifResult.ruleIndex = ruleIndex;
        }
      }

      sarifResults.push(sarifResult);
    }
  }

  return sarifResults;
}

export async function main() {
  const { outputFile } = parseArgs(process.argv.slice(2));
  const { ESLint } = await import("eslint");

  const eslint = new ESLint();
  const results = await eslint.lintFiles(LINT_TARGETS);
  const rulesMeta = await eslint.getRulesMetaForResults(results);

  const ruleEntries = Object.entries(rulesMeta);
  const ruleIndexById = new Map(ruleEntries.map(([ruleId], index) => [ruleId, index]));
  const rules = ruleEntries.map(([ruleId, meta]) => ({
    id: ruleId,
    helpUri: meta?.docs?.url || "https://eslint.org/docs/latest/rules/",
    shortDescription: meta?.docs?.description ? { text: meta.docs.description } : undefined,
    properties: meta?.type ? { category: meta.type } : {},
  }));

  const artifacts = [];
  const artifactIndexByUri = new Map();
  const sarifResults = toSarifResults(results, artifacts, artifactIndexByUri, ruleIndexById);

  const sarif = {
    version: "2.1.0",
    $schema: "http://json.schemastore.org/sarif-2.1.0-rtm.5",
    runs: [
      {
        tool: {
          driver: {
            name: "ESLint",
            informationUri: "https://eslint.org",
            version: ESLint.version,
            rules,
          },
        },
        artifacts,
        results: sarifResults,
      },
    ],
  };

  const output = `${JSON.stringify(sarif, null, 2)}\n`;

  if (outputFile) {
    const outputPath = path.resolve(outputFile);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, output, "utf8");
  } else {
    process.stdout.write(output);
  }

  const errorCount = results.reduce((sum, result) => sum + result.errorCount, 0);
  const warningCount = results.reduce((sum, result) => sum + result.warningCount, 0);

  if (errorCount > 0 || warningCount > 0) {
    process.exitCode = 1;
  }
}

const isDirectExecution =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(2);
  });
}
