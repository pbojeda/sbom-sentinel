import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findPreExistingSbom, generateSbom } from '../../src/sbom.js';
import type { RepoConfig } from '../../src/types.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../src/logger.js', () => ({
  run:  vi.fn(),
  log:  vi.fn(),
  ok:   vi.fn(),
  warn: vi.fn(),
  err:  vi.fn(),
  dim:  vi.fn(),
}));

import { run, log, warn } from '../../src/logger.js';
const mockRun  = vi.mocked(run);
const mockLog  = vi.mocked(log);
const mockWarn = vi.mocked(warn);

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_SBOM = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  components: [{ name: 'axios', version: '1.0.0', type: 'library' }],
});

const EMPTY_SBOM = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  components: [],
});

function makeTempDir(): string {
  const dir = join(tmpdir(), `sentinel-sbom-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const REPO: RepoConfig = {
  name: 'my-backend',
  cloneUrl: 'https://github.com/org/my-backend.git',
  branch: 'main',
  type: 'node',
};

const NOW = new Date('2026-04-22T10:00:00Z');

let tempRoot: string;

beforeEach(() => {
  tempRoot = makeTempDir();
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// ── findPreExistingSbom ───────────────────────────────────────────────────────

describe('findPreExistingSbom', () => {
  it('returns null when sbom/ directory does not exist', () => {
    expect(findPreExistingSbom(tempRoot)).toBeNull();
  });

  it('returns null when sbom/ directory is empty', () => {
    mkdirSync(join(tempRoot, 'sbom'));
    expect(findPreExistingSbom(tempRoot)).toBeNull();
  });

  it('returns null when sbom/ has files that do not match sbom-*.json', () => {
    const sbomDir = join(tempRoot, 'sbom');
    mkdirSync(sbomDir);
    writeFileSync(join(sbomDir, 'bom.json'), '{}');
    writeFileSync(join(sbomDir, 'sbom.json'), '{}');
    writeFileSync(join(sbomDir, 'README.md'), '');
    expect(findPreExistingSbom(tempRoot)).toBeNull();
  });

  it('returns the path when sbom/sbom-v1.2.json exists', () => {
    const sbomDir = join(tempRoot, 'sbom');
    mkdirSync(sbomDir);
    const sbomFile = join(sbomDir, 'sbom-v1.2.json');
    writeFileSync(sbomFile, '{}');
    expect(findPreExistingSbom(tempRoot)).toBe(sbomFile);
  });

  it('returns the first alphabetically when multiple files match', () => {
    const sbomDir = join(tempRoot, 'sbom');
    mkdirSync(sbomDir);
    writeFileSync(join(sbomDir, 'sbom-v2.0.json'), '{}');
    writeFileSync(join(sbomDir, 'sbom-v1.0.json'), '{}');
    writeFileSync(join(sbomDir, 'sbom-v1.5.json'), '{}');
    expect(findPreExistingSbom(tempRoot)).toBe(join(sbomDir, 'sbom-v1.0.json'));
  });
});

// ── generateSbom — pre-existing SBOM path ────────────────────────────────────

describe('generateSbom — pre-existing SBOM', () => {
  it('copies the pre-existing SBOM and does not call cdxgen', () => {
    const localPath = join(tempRoot, 'repo');
    const outputDir = join(tempRoot, 'output');
    mkdirSync(join(localPath, 'sbom'), { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(localPath, 'sbom', 'sbom-v1.0.json'), VALID_SBOM);

    const result = generateSbom(REPO, localPath, outputDir, 'abc1234', NOW);

    expect(result.componentCount).toBe(1);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('logs a message indicating which file was used and that cdxgen was skipped', () => {
    const localPath = join(tempRoot, 'repo');
    const outputDir = join(tempRoot, 'output');
    mkdirSync(join(localPath, 'sbom'), { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(localPath, 'sbom', 'sbom-v1.0.json'), VALID_SBOM);

    generateSbom(REPO, localPath, outputDir, 'abc1234', NOW);

    const loggedMsg = mockLog.mock.calls.find(c => String(c[0]).includes('cdxgen skipped'));
    expect(loggedMsg).toBeDefined();
    expect(String(loggedMsg![0])).toContain('sbom/sbom-v1.0.json');
  });

  it('warns when the pre-existing SBOM has 0 components', () => {
    const localPath = join(tempRoot, 'repo');
    const outputDir = join(tempRoot, 'output');
    mkdirSync(join(localPath, 'sbom'), { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(localPath, 'sbom', 'sbom-v1.0.json'), EMPTY_SBOM);

    const result = generateSbom(REPO, localPath, outputDir, 'abc1234', NOW);

    expect(result.componentCount).toBe(0);
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('0 components'));
  });

  it('throws when the pre-existing SBOM is missing the components array', () => {
    const localPath = join(tempRoot, 'repo');
    const outputDir = join(tempRoot, 'output');
    mkdirSync(join(localPath, 'sbom'), { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(localPath, 'sbom', 'sbom-v1.0.json'), JSON.stringify({ bomFormat: 'CycloneDX' }));

    expect(() =>
      generateSbom(REPO, localPath, outputDir, 'abc1234', NOW),
    ).toThrow('missing "components"');
  });
});

// ── generateSbom — cdxgen path (no pre-existing SBOM) ────────────────────────

describe('generateSbom — cdxgen path', () => {
  it('calls run with a cdxgen command when no pre-existing SBOM exists', () => {
    const localPath = join(tempRoot, 'repo');
    const outputDir = join(tempRoot, 'output');
    mkdirSync(localPath, { recursive: true });
    mkdirSync(outputDir, { recursive: true });

    // run is mocked — cdxgen never writes the file, so generateSbom throws after calling run
    expect(() =>
      generateSbom(REPO, localPath, outputDir, 'abc1234', NOW),
    ).toThrow();

    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('cdxgen'),
      expect.any(Object),
    );
  });
});
