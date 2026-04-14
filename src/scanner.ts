import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, log, ok } from './logger.js';
import { buildArtifactName } from './sbom.js';
import { SEVERITY_ORDER } from './types.js';
import type { Finding, Severity, SeverityCounts } from './types.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ScanResult {
  trivyFile: string;
  findings: Finding[];
  counts: SeverityCounts;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Runs `trivy sbom` against `sbomFile`, saves the JSON output to the artifact
 * directory, then extracts, deduplicates and counts the findings.
 *
 * @throws if trivy fails or produces no output file.
 */
export function scanSbom(
  sbomFile: string,
  outputDir: string,
  repo: string,
  branch: string,
  commitSha: string,
  now: Date = new Date(),
): ScanResult {
  const dateStr = now.toISOString().slice(0, 10);
  const artifactDir = join(outputDir, dateStr);
  mkdirSync(artifactDir, { recursive: true });

  const filename = buildArtifactName(repo, branch, commitSha, 'trivy.json', now);
  const trivyFile = join(artifactDir, filename);

  log(`Scanning "${repo}" with Trivy…`);

  // trivy must be installed and available in PATH.
  // The CLI `check` command verifies this at startup.
  run(`trivy sbom --format json --output "${trivyFile}" --quiet "${sbomFile}"`);

  if (!existsSync(trivyFile)) {
    throw new Error(`Trivy did not produce output: ${trivyFile}`);
  }

  const trivyOutput = JSON.parse(readFileSync(trivyFile, 'utf8')) as unknown;
  const allFindings = extractFindings(trivyOutput);
  const findings = deduplicateFindings(allFindings);
  const counts = countBySeverity(findings);

  ok(`Scan for "${repo}": ${findings.length} unique findings (${formatCounts(counts)}).`);

  return { trivyFile, findings, counts };
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parses a Trivy JSON report and returns all findings as a flat list.
 * Unknown or malformed entries are skipped silently.
 */
export function extractFindings(trivyOutput: unknown): Finding[] {
  if (typeof trivyOutput !== 'object' || trivyOutput === null) return [];

  const results = (trivyOutput as Record<string, unknown>)['Results'];
  if (!Array.isArray(results)) return [];

  const findings: Finding[] = [];

  for (const result of results) {
    if (typeof result !== 'object' || result === null) continue;

    const r = result as Record<string, unknown>;
    const target = typeof r['Target'] === 'string' ? r['Target'] : 'unknown';
    const type = typeof r['Type'] === 'string' ? r['Type'] : 'unknown';
    const vulns = r['Vulnerabilities'];

    if (!Array.isArray(vulns)) continue;

    for (const vuln of vulns) {
      if (typeof vuln !== 'object' || vuln === null) continue;

      const v = vuln as Record<string, unknown>;
      const id = typeof v['VulnerabilityID'] === 'string' ? v['VulnerabilityID'] : '';
      if (!id) continue; // skip malformed entries

      const rawFixed = v['FixedVersion'];
      const fixed =
        typeof rawFixed === 'string' && rawFixed.trim() !== '' ? rawFixed.trim() : null;

      findings.push({
        id,
        pkg: typeof v['PkgName'] === 'string' ? v['PkgName'] : '',
        installed: typeof v['InstalledVersion'] === 'string' ? v['InstalledVersion'] : '',
        fixed,
        severity: normalizeSeverity(v['Severity']),
        title: typeof v['Title'] === 'string' ? v['Title'] : '',
        url: typeof v['PrimaryURL'] === 'string' ? v['PrimaryURL'] : '',
        target,
        type,
      });
    }
  }

  return findings;
}

/**
 * Removes duplicate findings based on `id + pkg + installed version`.
 * The first occurrence (earliest target) is kept.
 */
export function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.id}|${f.pkg}|${f.installed}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Returns counts per severity level from a list of findings.
 */
export function countBySeverity(findings: Finding[]): SeverityCounts {
  const counts: SeverityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const f of findings) {
    counts[f.severity]++;
  }
  return counts;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeSeverity(raw: unknown): Severity {
  if (typeof raw === 'string') {
    const upper = raw.toUpperCase() as Severity;
    if ((SEVERITY_ORDER as string[]).includes(upper)) return upper;
  }
  return 'UNKNOWN';
}

function formatCounts(c: SeverityCounts): string {
  return SEVERITY_ORDER.filter((s) => c[s] > 0)
    .map((s) => `${c[s]} ${s}`)
    .join(', ');
}
