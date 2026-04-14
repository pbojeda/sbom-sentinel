import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractFindings, deduplicateFindings, countBySeverity, scanSbom } from '../../src/scanner.js';
import { buildArtifactName } from '../../src/sbom.js';

// ── Mock logger so no shell commands actually run ─────────────────────────────

vi.mock('../../src/logger.js', () => ({
  run:  vi.fn(),
  log:  vi.fn(),
  ok:   vi.fn(),
  warn: vi.fn(),
  err:  vi.fn(),
  dim:  vi.fn(),
}));

// ── Load real fixture ─────────────────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname, '../fixtures/sample-trivy-output.json');
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as unknown;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `sentinel-scan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── extractFindings ───────────────────────────────────────────────────────────

describe('extractFindings', () => {
  it('extracts all raw findings from the real fixture', () => {
    // Fixture: 3 axios + 2 lodash + 1 dicer + 1 send + 1 duplicate axios = 8 raw
    expect(extractFindings(FIXTURE)).toHaveLength(8);
  });

  it('maps all fields correctly from the Trivy JSON structure', () => {
    const findings = extractFindings(FIXTURE);
    const cve = findings.find((f) => f.id === 'CVE-2023-45857');

    expect(cve).toBeDefined();
    expect(cve?.pkg).toBe('axios');
    expect(cve?.installed).toBe('0.21.1');
    expect(cve?.fixed).toBe('1.6.0');
    expect(cve?.severity).toBe('HIGH');
    expect(cve?.title).toBe('Axios Cross-Site Request Forgery Vulnerability');
    expect(cve?.url).toBe('https://avd.aquasec.com/nvd/cve-2023-45857');
    expect(cve?.target).toBe('package-lock.json');
    expect(cve?.type).toBe('npm');
  });

  it('sets fixed to null when FixedVersion is an empty string', () => {
    const findings = extractFindings(FIXTURE);
    const dicer = findings.find((f) => f.id === 'CVE-2022-24434');
    expect(dicer?.fixed).toBeNull();
  });

  it('normalizes lowercase severity strings', () => {
    const raw = {
      Results: [{
        Target: 'test', Type: 'npm',
        Vulnerabilities: [{
          VulnerabilityID: 'CVE-TEST-001', PkgName: 'pkg', InstalledVersion: '1.0.0',
          FixedVersion: '1.0.1', Severity: 'high', Title: 'Test', PrimaryURL: 'https://x.com',
        }],
      }],
    };
    expect(extractFindings(raw)[0].severity).toBe('HIGH');
  });

  it('maps unknown severity strings to UNKNOWN', () => {
    const raw = {
      Results: [{
        Target: 'test', Type: 'npm',
        Vulnerabilities: [{
          VulnerabilityID: 'CVE-TEST-002', PkgName: 'pkg', InstalledVersion: '1.0.0',
          FixedVersion: '', Severity: 'INFORMATIONAL', Title: 'Test', PrimaryURL: '',
        }],
      }],
    };
    expect(extractFindings(raw)[0].severity).toBe('UNKNOWN');
  });

  it('returns empty array for empty Results array', () => {
    expect(extractFindings({ SchemaVersion: 2, Results: [] })).toEqual([]);
  });

  it('returns empty array when Results is missing', () => {
    expect(extractFindings({})).toEqual([]);
  });

  it('returns empty array for null/non-object input', () => {
    expect(extractFindings(null)).toEqual([]);
    expect(extractFindings('invalid')).toEqual([]);
    expect(extractFindings(42)).toEqual([]);
  });

  it('skips results that have no Vulnerabilities array', () => {
    const raw = { Results: [{ Target: 'some-target', Type: 'npm' }] };
    expect(extractFindings(raw)).toEqual([]);
  });

  it('skips individual vulnerability entries with no VulnerabilityID', () => {
    const raw = {
      Results: [{
        Target: 'test', Type: 'npm',
        Vulnerabilities: [{ PkgName: 'pkg', InstalledVersion: '1.0', Severity: 'HIGH' }],
      }],
    };
    expect(extractFindings(raw)).toEqual([]);
  });
});

// ── deduplicateFindings ───────────────────────────────────────────────────────

describe('deduplicateFindings', () => {
  it('removes duplicates with same id + pkg + installed version', () => {
    const raw = extractFindings(FIXTURE);
    const deduped = deduplicateFindings(raw);
    const axiosCsrf = deduped.filter((f) => f.id === 'CVE-2023-45857');
    expect(axiosCsrf).toHaveLength(1);
  });

  it('produces 7 unique findings from the fixture (8 raw − 1 duplicate)', () => {
    const deduped = deduplicateFindings(extractFindings(FIXTURE));
    expect(deduped).toHaveLength(7);
  });

  it('keeps the first occurrence when deduplicating', () => {
    const deduped = deduplicateFindings(extractFindings(FIXTURE));
    const axiosCsrf = deduped.find((f) => f.id === 'CVE-2023-45857');
    expect(axiosCsrf?.target).toBe('package-lock.json');
  });

  it('keeps findings that share the same id but different pkg', () => {
    const findings = [
      { id: 'CVE-X', pkg: 'pkg-a', installed: '1.0.0', fixed: null, severity: 'HIGH' as const, title: '', url: '', target: '', type: '' },
      { id: 'CVE-X', pkg: 'pkg-b', installed: '1.0.0', fixed: null, severity: 'HIGH' as const, title: '', url: '', target: '', type: '' },
    ];
    expect(deduplicateFindings(findings)).toHaveLength(2);
  });

  it('keeps findings that share id + pkg but different installed versions', () => {
    const findings = [
      { id: 'CVE-X', pkg: 'pkg', installed: '1.0.0', fixed: null, severity: 'HIGH' as const, title: '', url: '', target: '', type: '' },
      { id: 'CVE-X', pkg: 'pkg', installed: '2.0.0', fixed: null, severity: 'HIGH' as const, title: '', url: '', target: '', type: '' },
    ];
    expect(deduplicateFindings(findings)).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateFindings([])).toEqual([]);
  });
});

// ── countBySeverity ───────────────────────────────────────────────────────────

describe('countBySeverity', () => {
  it('counts correctly by severity from the deduplicated fixture', () => {
    const findings = deduplicateFindings(extractFindings(FIXTURE));
    const counts = countBySeverity(findings);

    // After dedup: 1 CRITICAL, 3 HIGH, 2 MEDIUM, 1 LOW
    expect(counts.CRITICAL).toBe(1);
    expect(counts.HIGH).toBe(3);
    expect(counts.MEDIUM).toBe(2);
    expect(counts.LOW).toBe(1);
    expect(counts.UNKNOWN).toBe(0);
  });

  it('returns all-zero counts for empty input', () => {
    expect(countBySeverity([])).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 });
  });

  it('counts UNKNOWN severity', () => {
    const findings = [
      { id: 'A', pkg: 'x', installed: '1', fixed: null, severity: 'UNKNOWN' as const, title: '', url: '', target: '', type: '' },
      { id: 'B', pkg: 'x', installed: '1', fixed: null, severity: 'UNKNOWN' as const, title: '', url: '', target: '', type: '' },
    ];
    expect(countBySeverity(findings).UNKNOWN).toBe(2);
  });
});

// ── scanSbom ──────────────────────────────────────────────────────────────────
//
// Strategy: `run` from logger is already mocked (trivy never runs).
// We pre-write the "trivy output" file to the path that scanSbom expects,
// so existsSync / readFileSync work against real files — no fs mocking needed.

describe('scanSbom', () => {
  let workDir: string;
  const NOW = new Date('2024-04-14T13:00:00Z');

  function preSeedTrivyOutput(content: unknown): void {
    const dateStr = NOW.toISOString().slice(0, 10);
    const artifactDir = join(workDir, dateStr);
    mkdirSync(artifactDir, { recursive: true });
    const filename = buildArtifactName('my-backend', 'main', 'abc1234', 'trivy.json', NOW);
    writeFileSync(join(artifactDir, filename), JSON.stringify(content));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    workDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('returns deduplicated findings and correct counts when trivy succeeds', () => {
    preSeedTrivyOutput(FIXTURE);

    const result = scanSbom('/tmp/bom.cdx.json', workDir, 'my-backend', 'main', 'abc1234', NOW);

    expect(result.findings).toHaveLength(7); // 8 raw − 1 duplicate
    expect(result.counts.CRITICAL).toBe(1);
    expect(result.counts.HIGH).toBe(3);
  });

  it('trivyFile path follows the artifact naming convention', () => {
    preSeedTrivyOutput(FIXTURE);

    const result = scanSbom('/tmp/bom.cdx.json', workDir, 'my-backend', 'main', 'abc1234', NOW);

    expect(result.trivyFile).toContain('my-backend');
    expect(result.trivyFile).toContain('main');
    expect(result.trivyFile).toContain('abc1234');
    expect(result.trivyFile).toContain('trivy.json');
  });

  it('throws when trivy does not produce an output file', () => {
    // workDir exists but the trivy output file was never written
    expect(() =>
      scanSbom('/tmp/bom.cdx.json', workDir, 'my-backend', 'main', 'abc1234', NOW),
    ).toThrow(/Trivy did not produce output/);
  });

  it('returns zero counts when trivy output has no vulnerabilities', () => {
    preSeedTrivyOutput({ SchemaVersion: 2, Results: [] });

    const result = scanSbom('/tmp/bom.cdx.json', workDir, 'my-backend', 'main', 'abc1234', NOW);

    expect(result.findings).toHaveLength(0);
    expect(result.counts).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 });
  });
});
