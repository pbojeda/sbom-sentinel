import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  buildSbomExportFilename,
  extractComponents,
  buildSbomCsv,
  generateSbomExport,
} from '../../src/sbom-export.js';
import type { SbomRow } from '../../src/sbom-export.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SBOM = join(__dirname, '../fixtures/sample-sbom.cdx.json');

// ── Temp directory for tests that write files ─────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = join(tmpdir(), `sbom-export-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── buildSbomExportFilename ───────────────────────────────────────────────────

describe('buildSbomExportFilename', () => {
  it('returns prefix-YYYY_MM_DD.csv', () => {
    const result = buildSbomExportFilename('sbom-export', new Date('2026-04-21T10:00:00Z'));
    expect(result).toBe('sbom-export-2026_04_21.csv');
  });

  it('uses underscores as date separators (not hyphens)', () => {
    const result = buildSbomExportFilename('my-prefix', new Date('2026-01-05T00:00:00Z'));
    expect(result).toContain('2026_01_05');
    expect(result).not.toMatch(/2026-\d{2}-\d{2}/);
  });

  it('includes a custom prefix verbatim', () => {
    const result = buildSbomExportFilename('SBOM_01_Insulclock_360', new Date('2026-04-21T00:00:00Z'));
    expect(result).toBe('SBOM_01_Insulclock_360-2026_04_21.csv');
  });

  it('throws on prefix with path separator (/ prevents path traversal)', () => {
    expect(() => buildSbomExportFilename('../../etc/passwd', new Date())).toThrow(/filePrefix/);
  });

  it('throws on prefix with space', () => {
    expect(() => buildSbomExportFilename('bad prefix', new Date())).toThrow(/filePrefix/);
  });
});

// ── extractComponents ─────────────────────────────────────────────────────────

describe('extractComponents', () => {
  it('reads the fixture SBOM and returns one row per component', () => {
    const rows = extractComponents(FIXTURE_SBOM, 'my-backend');
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.repo === 'my-backend')).toBe(true);
  });

  it('extracts name, version, type, purl, and licenses correctly', () => {
    const rows = extractComponents(FIXTURE_SBOM, 'my-backend');
    const axios = rows.find((r) => r.name === 'axios');
    expect(axios).toMatchObject({
      repo: 'my-backend',
      name: 'axios',
      version: '0.21.1',
      type: 'library',
      purl: 'pkg:npm/axios@0.21.1',
      licenses: 'MIT',
      group: '',
    });
  });

  it('returns empty string for missing fields', () => {
    const minimalSbom = JSON.stringify({ components: [{ name: 'bare-pkg' }] });
    const sbomPath = join(tmpDir, 'minimal.cdx.json');
    writeFileSync(sbomPath, minimalSbom);

    const rows = extractComponents(sbomPath, 'test-repo');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: '',
      type: '',
      purl: '',
      licenses: '',
      group: '',
    });
  });

  it('extracts license from {license: {id: ...}} structure', () => {
    const sbom = JSON.stringify({
      components: [{ name: 'pkg', licenses: [{ license: { id: 'Apache-2.0' } }] }],
    });
    const sbomPath = join(tmpDir, 'id-license.cdx.json');
    writeFileSync(sbomPath, sbom);

    const rows = extractComponents(sbomPath, 'repo');
    expect(rows[0]!.licenses).toBe('Apache-2.0');
  });

  it('extracts license from {license: {name: ...}} structure', () => {
    const sbom = JSON.stringify({
      components: [{ name: 'pkg', licenses: [{ license: { name: 'Custom Commercial License' } }] }],
    });
    const sbomPath = join(tmpDir, 'name-license.cdx.json');
    writeFileSync(sbomPath, sbom);

    const rows = extractComponents(sbomPath, 'repo');
    expect(rows[0]!.licenses).toBe('Custom Commercial License');
  });

  it('joins multiple licenses with " | "', () => {
    const sbom = JSON.stringify({
      components: [
        {
          name: 'dual-licensed',
          licenses: [{ license: { id: 'MIT' } }, { license: { id: 'Apache-2.0' } }],
        },
      ],
    });
    const sbomPath = join(tmpDir, 'multi-license.cdx.json');
    writeFileSync(sbomPath, sbom);

    const rows = extractComponents(sbomPath, 'repo');
    expect(rows[0]!.licenses).toBe('MIT | Apache-2.0');
  });

  it('extracts group field (Maven/Java SBOMs)', () => {
    const sbom = JSON.stringify({
      components: [{ name: 'guava', group: 'com.google.guava', version: '31.0', type: 'library' }],
    });
    const sbomPath = join(tmpDir, 'java-sbom.cdx.json');
    writeFileSync(sbomPath, sbom);

    const rows = extractComponents(sbomPath, 'java-repo');
    expect(rows[0]!.group).toBe('com.google.guava');
  });
});

// ── buildSbomCsv ──────────────────────────────────────────────────────────────

describe('buildSbomCsv', () => {
  it('first row is the exact header', () => {
    const csv = buildSbomCsv([]);
    expect(csv.split('\n')[0]).toBe('repo,name,version,type,purl,licenses,group');
  });

  it('wraps a field containing a comma in double quotes', () => {
    const row: SbomRow = { repo: 'r', name: 'pkg,v2', version: '1', type: 'library', purl: '', licenses: '', group: '' };
    const csv = buildSbomCsv([row]);
    expect(csv).toContain('"pkg,v2"');
  });

  it('escapes an internal double quote as ""', () => {
    const row: SbomRow = { repo: 'r', name: 'say "hello"', version: '1', type: 'library', purl: '', licenses: '', group: '' };
    const csv = buildSbomCsv([row]);
    expect(csv).toContain('"say ""hello"""');
  });

  it('does not quote plain fields', () => {
    const row: SbomRow = { repo: 'repo', name: 'lodash', version: '4.17.21', type: 'library', purl: 'pkg:npm/lodash@4.17.21', licenses: 'MIT', group: '' };
    const csv = buildSbomCsv([row]);
    const dataLine = csv.split('\n')[1]!;
    expect(dataLine).toBe('repo,lodash,4.17.21,library,pkg:npm/lodash@4.17.21,MIT,');
  });
});

// ── generateSbomExport ────────────────────────────────────────────────────────

describe('generateSbomExport', () => {
  it('writes the CSV file to outputDir/reports/ and returns its path', () => {
    const outputDir = join(tmpDir, 'output-1');
    const now = new Date('2026-04-21T00:00:00Z');

    const csvPath = generateSbomExport(
      [{ repo: 'my-backend', sbomFile: FIXTURE_SBOM }],
      outputDir,
      'sbom-export',
      now,
    );

    expect(csvPath).toBe(join(outputDir, 'reports', 'sbom-export-2026_04_21.csv'));
  });

  it('the written CSV contains component rows from the SBOM', () => {
    const outputDir = join(tmpDir, 'output-2');
    const now = new Date('2026-04-21T00:00:00Z');

    const csvPath = generateSbomExport(
      [{ repo: 'my-backend', sbomFile: FIXTURE_SBOM }],
      outputDir,
      'sbom-export',
      now,
    );

    const content = readFileSync(csvPath, 'utf-8');
    expect(content).toContain('repo,name,version,type,purl,licenses,group');
    expect(content).toContain('my-backend,axios,0.21.1');
    expect(content).toContain('my-backend,express,4.18.2');
  });

  it('repos with sbomFile=null are skipped without throwing', () => {
    const outputDir = join(tmpDir, 'output-3');
    const now = new Date('2026-04-21T00:00:00Z');

    expect(() =>
      generateSbomExport(
        [
          { repo: 'failed-repo', sbomFile: null },
          { repo: 'my-backend', sbomFile: FIXTURE_SBOM },
        ],
        outputDir,
        'sbom-export',
        now,
      ),
    ).not.toThrow();
  });

  it('CSV does not contain rows from repos with sbomFile=null', () => {
    const outputDir = join(tmpDir, 'output-4');
    const now = new Date('2026-04-21T00:00:00Z');

    const csvPath = generateSbomExport(
      [{ repo: 'failed-repo', sbomFile: null }],
      outputDir,
      'sbom-export',
      now,
    );

    const content = readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1); // only the header
    expect(lines[0]).toBe('repo,name,version,type,purl,licenses,group');
  });
});
