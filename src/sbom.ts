import { existsSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { run, log, ok, warn } from './logger.js';
import type { RepoConfig } from './types.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface SbomResult {
  sbomFile: string;
  componentCount: number;
}

// ── Artifact naming ───────────────────────────────────────────────────────────

/**
 * Formats a Date as `YYYYMMDDTHHMMSSz` (UTC, no milliseconds).
 * Used in artifact filenames so they sort chronologically.
 */
export function formatTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')      // 2024-04-14T13:22:19.123Z → 20240414T132219.123Z
    .replace(/\.\d+Z$/, 'z'); // → 20240414T132219z
}

/**
 * Builds a deterministic artifact filename.
 *
 * Pattern: `{repo}__{branch}__{commitSha}__{timestamp}__{suffix}`
 *
 * - Slashes in branch names are replaced with `-`
 * - `suffix` is e.g. `bom.cdx.json` or `trivy.json`
 */
export function buildArtifactName(
  repo: string,
  branch: string,
  commitSha: string,
  suffix: string,
  now: Date = new Date(),
): string {
  const safeBranch = branch.replace(/\//g, '-');
  const ts = formatTimestamp(now);
  return `${repo}__${safeBranch}__${commitSha}__${ts}__${suffix}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Generates a CycloneDX 1.6 SBOM for `repo` and writes it under
 * `{outputDir}/{YYYY-MM-DD}/{artifact-name}`.
 *
 * Supports two modes (controlled by `repo.mode`):
 *   - `"cdxgen"` (default) — runs `cdxgen` directly with the repo type
 *   - `"command"` — runs a custom command defined in `repo.sbomCommand`,
 *     then copies the file from `repo.sbomOutput` to the artifact dir
 *
 * @throws if the SBOM is not generated or has no "components" array.
 */
export function generateSbom(
  repo: RepoConfig,
  localPath: string,
  outputDir: string,
  commitSha: string,
  now: Date = new Date(),
): SbomResult {
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const artifactDir = join(outputDir, dateStr);
  mkdirSync(artifactDir, { recursive: true });

  const filename = buildArtifactName(repo.name, repo.branch, commitSha, 'bom.cdx.json', now);
  const sbomFile = join(artifactDir, filename);

  log(`Generating SBOM for "${repo.name}" (mode: ${repo.mode ?? 'cdxgen'})…`);

  if (repo.mode === 'command') {
    runCustomCommand(repo, localPath, sbomFile);
  } else {
    runCdxgen(repo, localPath, sbomFile);
  }

  return validateSbom(sbomFile, repo.name);
}

// ── Private helpers ───────────────────────────────────────────────────────────

function runCdxgen(repo: RepoConfig, localPath: string, sbomFile: string): void {
  // cdxgen must be installed globally or available in PATH.
  // The CLI `check` command verifies this at startup.
  // Use an absolute output path — sbomFile may be relative to process.cwd() but
  // cdxgen runs with cwd=localPath, so a relative path would resolve incorrectly.
  const absSbomFile = resolve(sbomFile);
  const cmd = `cdxgen -t ${repo.type} --spec-version 1.6 -o "${absSbomFile}" "${localPath}"`;
  run(cmd, { cwd: localPath });
}

function runCustomCommand(repo: RepoConfig, localPath: string, sbomFile: string): void {
  if (!repo.sbomCommand) {
    throw new Error(
      `Repo "${repo.name}" has mode: "command" but "sbomCommand" is not set in config.`,
    );
  }

  // Run the repo's own SBOM generation script
  run(repo.sbomCommand, { cwd: localPath });

  // Locate the generated file
  const relativePath = repo.sbomOutput ?? 'bom.json';
  const sourcePath = join(localPath, relativePath);

  if (!existsSync(sourcePath)) {
    throw new Error(
      `SBOM not found at expected path: ${sourcePath}\n` +
        `Check "sbomOutput" in the config for repo "${repo.name}".`,
    );
  }

  // Copy into the artifact directory under the standard name
  copyFileSync(sourcePath, sbomFile);
}

function validateSbom(sbomFile: string, repoName: string): SbomResult {
  if (!existsSync(sbomFile)) {
    throw new Error(`SBOM was not generated: ${sbomFile}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(sbomFile, 'utf8'));
  } catch {
    throw new Error(`SBOM file is not valid JSON: ${sbomFile}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`SBOM has unexpected format (not a JSON object): ${sbomFile}`);
  }

  const components = (parsed as Record<string, unknown>)['components'];

  if (!Array.isArray(components)) {
    throw new Error(
      `SBOM is missing "components" array — cdxgen may have failed silently for "${repoName}".`,
    );
  }

  if (components.length === 0) {
    warn(`SBOM for "${repoName}" has 0 components. Is the repository empty?`);
  } else {
    ok(`SBOM for "${repoName}": ${components.length} components.`);
  }

  return { sbomFile, componentCount: components.length };
}
