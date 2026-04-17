#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const LINT_TARGETS = ["src", ".storybook", "vite.config.ts", "eslint.config.js"];
export const SRCROOT_URI_BASE_ID = "%SRCROOT%";

export function parseArgs(argv) {
  let outputFile;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-o" || arg === "--output-file") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --output-file");
      }
      outputFile = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--output-file=")) {
      const value = arg.slice("--output-file=".length);
      if (!value) {
        throw new Error("Missing value for --output-file");
      }
      outputFile = value;
    }
  }

  return { outputFile };
}

export function toSarifLevel(severity) {
  return severity === 2 ? "error" : "warning";
}

export function toRegion(message) {
  const region = {};

  if (message.line !== undefined && message.line !== null) {
    region.startLine = message.line;
  }
  if (message.column !== undefined && message.column !== null) {
    region.startColumn = message.column;
  }
  if (message.endLine !== undefined && message.endLine !== null) {
    region.endLine = message.endLine;
  }
  if (message.endColumn !== undefined && message.endColumn !== null) {
    region.endColumn = message.endColumn;
  }

  return Object.keys(region).length > 0 ? region : undefined;
}

function normalizePathToPosix(filePath) {
  return filePath.replace(/\\/gu, "/");
}

export function toSarifArtifactLocation(filePath, rootDir = process.cwd()) {
  const absoluteFilePath = path.resolve(filePath);
  const absoluteRootDir = path.resolve(rootDir);
  const relativePath = path.relative(absoluteRootDir, absoluteFilePath);
  const withinRoot =
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));

  if (withinRoot) {
    const uri = encodeURI(normalizePathToPosix(relativePath || path.basename(absoluteFilePath)));
    return {
      uri,
      uriBaseId: SRCROOT_URI_BASE_ID,
    };
  }

  return { uri: pathToFileURL(absoluteFilePath).href };
}

export function ensureArtifact(artifacts, artifactIndexByUri, filePath, rootDir = process.cwd()) {
  const artifactLocation = toSarifArtifactLocation(filePath, rootDir);
  const artifactKey = artifactLocation.uriBaseId
    ? `${artifactLocation.uriBaseId}:${artifactLocation.uri}`
    : artifactLocation.uri;

  let index = artifactIndexByUri.get(artifactKey);
  if (index === undefined) {
    index = artifacts.length;
    artifactIndexByUri.set(artifactKey, index);
    artifacts.push({
      location: artifactLocation,
    });
  }

  return { ...artifactLocation, index };
}

export function toSarifResults(
  results,
  artifacts,
  artifactIndexByUri,
  ruleIndexById,
  rootDir = process.cwd(),
) {
  const sarifResults = [];

  for (const result of results) {
    const artifact = ensureArtifact(artifacts, artifactIndexByUri, result.filePath, rootDir);

    for (const message of result.messages) {
      const region = toRegion(message);
      const physicalLocation = {
        artifactLocation: {
          uri: artifact.uri,
          index: artifact.index,
        },
      };
      if (artifact.uriBaseId) {
        physicalLocation.artifactLocation.uriBaseId = artifact.uriBaseId;
      }

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

export function toSarifRules(rulesMeta) {
  return Object.entries(rulesMeta).map(([ruleId, meta]) => ({
    id: ruleId,
    helpUri: meta?.docs?.url || "https://eslint.org/docs/latest/rules/",
    shortDescription: meta?.docs?.description ? { text: meta.docs.description } : undefined,
    properties: meta?.type ? { category: meta.type } : {},
  }));
}

export function buildSarif(results, rulesMeta, eslintVersion) {
  const ruleEntries = Object.entries(rulesMeta);
  const ruleIndexById = new Map(ruleEntries.map(([ruleId], index) => [ruleId, index]));
  const rules = toSarifRules(rulesMeta);

  const artifacts = [];
  const artifactIndexByUri = new Map();
  const rootDir = process.cwd();
  const sarifResults = toSarifResults(results, artifacts, artifactIndexByUri, ruleIndexById, rootDir);
  const hasSourceRootArtifacts = artifacts.some(
    (artifact) => artifact.location.uriBaseId === SRCROOT_URI_BASE_ID,
  );

  const run = {
    tool: {
      driver: {
        name: "ESLint",
        informationUri: "https://eslint.org",
        version: eslintVersion,
        rules,
      },
    },
    artifacts,
    results: sarifResults,
  };

  if (hasSourceRootArtifacts) {
    run.originalUriBaseIds = {
      [SRCROOT_URI_BASE_ID]: {
        uri: pathToFileURL(`${path.resolve(rootDir)}${path.sep}`).href,
      },
    };
  }

  return {
    version: "2.1.0",
    $schema: "http://json.schemastore.org/sarif-2.1.0-rtm.5",
    runs: [run],
  };
}

export function countFindings(results) {
  const errorCount = results.reduce((sum, result) => sum + result.errorCount, 0);
  const warningCount = results.reduce((sum, result) => sum + result.warningCount, 0);
  return { errorCount, warningCount };
}

export async function generateSarif(lintTargets = LINT_TARGETS) {
  const { ESLint } = await import("eslint");
  const eslint = new ESLint({ errorOnUnmatchedPattern: false });
  const results = await eslint.lintFiles(lintTargets);
  const rulesMeta = await eslint.getRulesMetaForResults(results);
  const sarif = buildSarif(results, rulesMeta, ESLint.version);
  const { errorCount, warningCount } = countFindings(results);

  return { sarif, errorCount, warningCount, results, rulesMeta };
}

function isMainModule() {
  if (!process.argv[1]) {
    return false;
  }
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

export async function runCli(argv = process.argv.slice(2)) {
  const { outputFile } = parseArgs(argv);
  const { sarif, errorCount, warningCount } = await generateSarif();

  const output = `${JSON.stringify(sarif, null, 2)}\n`;

  if (outputFile) {
    const outputPath = path.resolve(outputFile);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, output, "utf8");
  } else {
    process.stdout.write(output);
  }

  if (errorCount > 0 || warningCount > 0) {
    process.exitCode = 1;
  }
}

if (isMainModule()) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(2);
  });
}
