import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SbomRow {
  repo: string;
  name: string;
  version: string;
  type: string;
  purl: string;
  licenses: string;
  group: string;
}

/**
 * Returns '{prefix}-YYYY_MM_DD.csv'. Throws if prefix contains unsafe characters
 * (path separators, '..') to prevent path traversal when writing to outputDir/reports/.
 */
export function buildSbomExportFilename(prefix: string, date: Date): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(prefix)) {
    throw new Error(
      `Invalid sbomExport.filePrefix "${prefix}": only alphanumeric, hyphen, underscore, and dot characters are allowed.`,
    );
  }
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${prefix}-${yyyy}_${mm}_${dd}.csv`;
}

/** Reads a CycloneDX JSON SBOM and maps its components[] to SbomRow[]. */
export function extractComponents(sbomFile: string, repoName: string): SbomRow[] {
  const raw = readFileSync(sbomFile, 'utf-8');
  const bom = JSON.parse(raw) as {
    components?: Array<{
      name?: string;
      version?: string;
      type?: string;
      purl?: string;
      group?: string;
      licenses?: Array<{ license?: { id?: string; name?: string } }>;
    }>;
  };

  return (bom.components ?? []).map((c) => ({
    repo: repoName,
    name: c.name ?? '',
    version: c.version ?? '',
    type: c.type ?? '',
    purl: c.purl ?? '',
    licenses: (c.licenses ?? [])
      .map((l) => l.license?.id ?? l.license?.name ?? '')
      .filter(Boolean)
      .join(' | '),
    group: c.group ?? '',
  }));
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Builds an RFC 4180 CSV string with a fixed header row. */
export function buildSbomCsv(rows: SbomRow[]): string {
  const header = 'repo,name,version,type,purl,licenses,group';
  const lines = rows.map((r) =>
    [r.repo, r.name, r.version, r.type, r.purl, r.licenses, r.group]
      .map(escapeCsvField)
      .join(','),
  );
  return [header, ...lines].join('\n') + '\n';
}

/**
 * Extracts all components from each SBOM (repos with sbomFile=null are skipped),
 * writes the CSV to {outputDir}/reports/, and returns the path of the written file.
 */
export function generateSbomExport(
  repoSboms: Array<{ repo: string; sbomFile: string | null }>,
  outputDir: string,
  filePrefix: string,
  now: Date,
): string {
  const rows: SbomRow[] = [];
  for (const { repo, sbomFile } of repoSboms) {
    if (!sbomFile) continue;
    rows.push(...extractComponents(sbomFile, repo));
  }

  const csv = buildSbomCsv(rows);
  const filename = buildSbomExportFilename(filePrefix, now);
  const reportsDir = join(outputDir, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const filePath = join(reportsDir, filename);
  writeFileSync(filePath, csv, 'utf-8');
  return filePath;
}
