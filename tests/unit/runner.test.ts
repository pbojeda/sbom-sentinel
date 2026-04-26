import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkTokenExpiry, resolveCredentials, scan, findSbomRepositoryFolder } from '../../src/runner.js';
import type { LoadedConfig } from '../../src/config.js';
import type { RepoConfig } from '../../src/types.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// node:fs is partially mocked so readdirSync can be controlled in tests.
// mkdirSync, rmSync, etc. remain real to avoid breaking the work-directory setup.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readdirSync: vi.fn(actual.readdirSync) };
});

vi.mock('../../src/logger.js', () => ({
  ok:   vi.fn(),
  warn: vi.fn(),
  err:  vi.fn(),
  log:  vi.fn(),
  dim:  vi.fn(),
  run:  vi.fn(),
}));

vi.mock('../../src/git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/git.js')>();
  return {
    ...actual,
    cloneRepo:     vi.fn(),
    cleanupRepo:   vi.fn(),
  };
});

vi.mock('../../src/sbom.js',       () => ({ generateSbom:       vi.fn() }));
vi.mock('../../src/scanner.js',    () => ({ scanSbom:           vi.fn() }));
vi.mock('../../src/report.js',     () => ({ buildSummary: vi.fn(() => ({})), generateReports: vi.fn(() => ({})) }));
vi.mock('../../src/notify.js',     () => ({ notify: vi.fn(), notifyTokenExpiry: vi.fn() }));
vi.mock('../../src/storage.js',    () => ({ uploadReports: vi.fn(), uploadFile: vi.fn() }));
vi.mock('../../src/sbom-export.js', () => ({ generateSbomExport: vi.fn(() => '/tmp/sbom-export-2026_04_21.csv') }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRepo(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    name: 'my-backend',
    cloneUrl: 'https://github.com/org/my-backend.git',
    branch: 'main',
    type: 'node',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
  return {
    config: { repos: [] },
    args: { dryRun: false },
    outputDir: './artifacts',
    gitToken: '',
    gitUser: 'x-token-auth',
    githubToken: '',
    githubUser: 'x-token-auth',
    bitbucketToken: '',
    bitbucketUser: 'x-token-auth',
    emailTo: [],
    smtpPort: 587,
    logLevel: 'info',
    dryRun: false,
    storageConfigs: [],
    ...overrides,
  } as LoadedConfig;
}

// ── resolveCredentials ────────────────────────────────────────────────────────

describe('resolveCredentials', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const PER_REPO_KEYS = [
    'GITHUB_TOKEN_MY_BACKEND',
    'BITBUCKET_TOKEN_MY_BACKEND',
    'GIT_TOKEN_MY_BACKEND',
    'BITBUCKET_TOKEN_MY_SERVICE',
  ];

  beforeEach(() => {
    for (const key of PER_REPO_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of PER_REPO_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('uses BITBUCKET_TOKEN_<REPO_NAME> for Bitbucket repos (per-repo token)', () => {
    process.env['BITBUCKET_TOKEN_MY_BACKEND'] = 'per-repo-token';
    const repo = makeRepo({ cloneUrl: 'https://bitbucket.org/org/my-backend.git' });
    const creds = resolveCredentials(repo, makeConfig({ bitbucketToken: 'shared-token' }));
    expect(creds.token).toBe('per-repo-token');
    expect(creds.user).toBe('x-token-auth');
  });

  it('falls back to BITBUCKET_TOKEN when no per-repo token is set', () => {
    const repo = makeRepo({ cloneUrl: 'https://bitbucket.org/org/my-backend.git' });
    const creds = resolveCredentials(repo, makeConfig({ bitbucketToken: 'shared-bb', bitbucketUser: 'myuser' }));
    expect(creds.token).toBe('shared-bb');
    expect(creds.user).toBe('myuser');
  });

  it('uses GITHUB_TOKEN_<REPO_NAME> for GitHub repos (per-repo token)', () => {
    process.env['GITHUB_TOKEN_MY_BACKEND'] = 'per-repo-gh-token';
    const repo = makeRepo({ cloneUrl: 'https://github.com/org/my-backend.git' });
    const creds = resolveCredentials(repo, makeConfig({ githubToken: 'shared-gh', githubUser: 'x-token-auth' }));
    expect(creds.token).toBe('per-repo-gh-token');
    expect(creds.user).toBe('x-token-auth');
  });

  it('falls back to GITHUB_TOKEN when no per-repo token is set', () => {
    const repo = makeRepo({ cloneUrl: 'https://github.com/org/my-backend.git' });
    const creds = resolveCredentials(repo, makeConfig({ githubToken: 'shared-gh' }));
    expect(creds.token).toBe('shared-gh');
  });

  it('uses GIT_TOKEN_<REPO_NAME> for other hosts (per-repo token)', () => {
    process.env['GIT_TOKEN_MY_BACKEND'] = 'per-repo-git-token';
    const repo = makeRepo({ cloneUrl: 'https://gitlab.com/org/my-backend.git' });
    const creds = resolveCredentials(repo, makeConfig({ gitToken: 'shared-git' }));
    expect(creds.token).toBe('per-repo-git-token');
  });

  it('falls back to GIT_TOKEN when no platform or per-repo token is set', () => {
    const repo = makeRepo({ cloneUrl: 'https://gitlab.com/org/my-backend.git' });
    const creds = resolveCredentials(repo, makeConfig({ gitToken: 'fallback-token', gitUser: 'myuser' }));
    expect(creds.token).toBe('fallback-token');
    expect(creds.user).toBe('myuser');
  });

  it('per-repo token takes priority over shared platform token', () => {
    process.env['BITBUCKET_TOKEN_MY_SERVICE'] = 'per-repo';
    const repo = makeRepo({ name: 'my-service', cloneUrl: 'https://bitbucket.org/org/my-service.git' });
    const creds = resolveCredentials(repo, makeConfig({ bitbucketToken: 'shared', gitToken: 'fallback' }));
    expect(creds.token).toBe('per-repo');
  });
});

// ── scan — storage upload loop ────────────────────────────────────────────────

describe('scan — storage upload loop', () => {
  beforeEach(async () => {
    const { cloneRepo }                      = await import('../../src/git.js');
    const { generateSbom }                   = await import('../../src/sbom.js');
    const { scanSbom }                       = await import('../../src/scanner.js');
    const { buildSummary, generateReports }  = await import('../../src/report.js');

    vi.mocked(cloneRepo).mockReturnValue({ commitSha: 'abc1234', localPath: '/tmp/repo' });
    vi.mocked(generateSbom).mockReturnValue({ sbomFile: '/tmp/sbom.json', componentCount: 5 });
    vi.mocked(scanSbom).mockReturnValue({ trivyFile: '/tmp/trivy.json', findings: [], counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 } } as never);
    vi.mocked(buildSummary).mockReturnValue({ date: '2026-04-16', generatedAt: '', totals: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 }, hasCriticalOrHigh: false, hasErrors: false, reposWithIssues: [], reposWithErrors: [], repositories: [] } as never);
    vi.mocked(generateReports).mockReturnValue({ json: '/tmp/r.json', html: '/tmp/r.html', txt: '/tmp/r.txt' });
  });

  afterEach(() => { vi.clearAllMocks(); });

  it('calls uploadReports once per configured provider', async () => {
    const { uploadReports } = await import('../../src/storage.js');
    vi.mocked(uploadReports).mockResolvedValue('https://cdn.example.com/report.html');

    const config = makeConfig({
      config: { repos: [makeRepo()] },
      storageConfigs: [
        { provider: 'ibm-cos' },
        { provider: 'google-drive' },
      ],
    });

    await scan(config);

    expect(vi.mocked(uploadReports)).toHaveBeenCalledTimes(2);
  });

  it('continues to second provider even when first returns undefined', async () => {
    const { uploadReports } = await import('../../src/storage.js');
    const { notify }        = await import('../../src/notify.js');
    vi.mocked(uploadReports)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('https://drive.google.com/file/d/abc/view');

    const config = makeConfig({
      config: { repos: [makeRepo()] },
      storageConfigs: [
        { provider: 'ibm-cos' },
        { provider: 'google-drive' },
      ],
    });

    await scan(config);

    expect(vi.mocked(uploadReports)).toHaveBeenCalledTimes(2);
    // reportUrl from second provider must reach notify
    expect(vi.mocked(notify)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reportUrl: 'https://drive.google.com/file/d/abc/view' }),
    );
  });

  it('uses the first successful URL when both providers succeed', async () => {
    const { uploadReports } = await import('../../src/storage.js');
    const { notify }        = await import('../../src/notify.js');
    vi.mocked(uploadReports)
      .mockResolvedValueOnce('https://cos.example.com/report.html')
      .mockResolvedValueOnce('https://drive.google.com/file/d/abc/view');

    const config = makeConfig({
      config: { repos: [makeRepo()] },
      storageConfigs: [
        { provider: 'ibm-cos' },
        { provider: 'google-drive' },
      ],
    });

    await scan(config);

    // IBM COS URL (first provider) wins
    expect(vi.mocked(notify)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reportUrl: 'https://cos.example.com/report.html' }),
    );
  });
});

// ── checkTokenExpiry ──────────────────────────────────────────────────────────

describe('checkTokenExpiry', () => {
  const now = new Date('2026-04-15T12:00:00Z');

  it('returns empty array when no tokens are configured', () => {
    expect(checkTokenExpiry({}, now)).toEqual([]);
  });

  it('returns empty when all tokens expire more than 15 days from now', () => {
    expect(checkTokenExpiry({ MY_TOKEN: '2026-05-10' }, now)).toEqual([]);
  });

  it('returns a warning when a token expires in exactly 15 days', () => {
    const warnings = checkTokenExpiry({ MY_TOKEN: '2026-04-30' }, now);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ tokenName: 'MY_TOKEN', expiresOn: '2026-04-30', daysLeft: 15 });
  });

  it('returns a warning when a token expires within 15 days', () => {
    const warnings = checkTokenExpiry({ MY_TOKEN: '2026-04-20' }, now);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.daysLeft).toBe(5);
  });

  it('returns a warning with negative daysLeft for an already-expired token', () => {
    const warnings = checkTokenExpiry({ MY_TOKEN: '2026-04-01' }, now);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.daysLeft).toBeLessThan(0);
  });

  it('silently skips tokens with invalid date strings', () => {
    const warnings = checkTokenExpiry({ BAD_TOKEN: 'not-a-date', GOOD_TOKEN: '2026-04-16' }, now);
    expect(warnings.some((w) => w.tokenName === 'BAD_TOKEN')).toBe(false);
    expect(warnings.some((w) => w.tokenName === 'GOOD_TOKEN')).toBe(true);
  });

  it('returns multiple warnings when multiple tokens are expiring soon', () => {
    const expiry = {
      TOKEN_A: '2026-04-18',
      TOKEN_B: '2026-04-25',
      TOKEN_C: '2026-06-01',  // far away — no warning
    };
    const warnings = checkTokenExpiry(expiry, now);
    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.tokenName).sort()).toEqual(['TOKEN_A', 'TOKEN_B']);
  });
});

// ── scan — sbom export ────────────────────────────────────────────────────────

describe('scan — sbom export', () => {
  beforeEach(async () => {
    const { cloneRepo }                      = await import('../../src/git.js');
    const { generateSbom }                   = await import('../../src/sbom.js');
    const { scanSbom }                       = await import('../../src/scanner.js');
    const { buildSummary, generateReports }  = await import('../../src/report.js');
    const { generateSbomExport }             = await import('../../src/sbom-export.js');

    vi.mocked(cloneRepo).mockReturnValue({ commitSha: 'abc1234', localPath: '/tmp/repo' });
    vi.mocked(generateSbom).mockReturnValue({ sbomFile: '/tmp/sbom.json', componentCount: 5 });
    vi.mocked(scanSbom).mockReturnValue({ trivyFile: '/tmp/trivy.json', findings: [], counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 } } as never);
    vi.mocked(buildSummary).mockReturnValue({ date: '2026-04-21', generatedAt: '', totals: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 }, hasCriticalOrHigh: false, hasErrors: false, reposWithIssues: [], reposWithErrors: [], repositories: [] } as never);
    vi.mocked(generateReports).mockReturnValue({ json: '/tmp/r.json', html: '/tmp/r.html', txt: '/tmp/r.txt' });
    vi.mocked(generateSbomExport).mockReturnValue('/tmp/sbom-export-2026_04_21.csv');
  });

  afterEach(() => { vi.clearAllMocks(); });

  it('calls generateSbomExport with the sbomFiles collected in Phase 1', async () => {
    const { generateSbomExport } = await import('../../src/sbom-export.js');

    const config = makeConfig({ config: { repos: [makeRepo()] } });
    await scan(config);

    expect(vi.mocked(generateSbomExport)).toHaveBeenCalledWith(
      [{ repo: 'my-backend', sbomFile: '/tmp/sbom.json' }],
      expect.any(String),
      'sbom-export',
      expect.any(Date),
    );
  });

  it('calls uploadFile once per configured storageConfig', async () => {
    const { uploadFile } = await import('../../src/storage.js');

    const config = makeConfig({
      config: { repos: [makeRepo()] },
      storageConfigs: [{ provider: 'ibm-cos' }, { provider: 'google-drive' }],
    });
    await scan(config);

    expect(vi.mocked(uploadFile)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(uploadFile)).toHaveBeenCalledWith(
      '/tmp/sbom-export-2026_04_21.csv',
      'sbom-export-2026_04_21.csv',
      expect.any(Object),
      expect.any(Date),
    );
  });

  it('skips generateSbomExport when sbomExport.enabled is false', async () => {
    const { generateSbomExport } = await import('../../src/sbom-export.js');

    const config = makeConfig({
      config: { repos: [makeRepo()], sbomExport: { enabled: false } },
    });
    await scan(config);

    expect(vi.mocked(generateSbomExport)).not.toHaveBeenCalled();
  });

  it('continues to Phase 2 (vulnerability scan) even when generateSbomExport throws', async () => {
    const { generateSbomExport } = await import('../../src/sbom-export.js');
    const { scanSbom }           = await import('../../src/scanner.js');
    vi.mocked(generateSbomExport).mockImplementationOnce(() => { throw new Error('disk full'); });

    const config = makeConfig({ config: { repos: [makeRepo()] } });
    await scan(config);

    expect(vi.mocked(scanSbom)).toHaveBeenCalled();
  });
});

// ── findSbomRepositoryFolder ──────────────────────────────────────────────────

describe('findSbomRepositoryFolder', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('returns null when no sbom-DD-MM-YYYY folder exists', async () => {
    const { readdirSync } = await import('node:fs');
    vi.mocked(readdirSync).mockReturnValueOnce(['README.md', 'scripts'] as never);
    expect(findSbomRepositoryFolder('/some/path')).toBeNull();
  });

  it('returns the most recent folder when multiple exist', async () => {
    const { readdirSync } = await import('node:fs');
    vi.mocked(readdirSync).mockReturnValueOnce(
      ['sbom-01-04-2026', 'sbom-23-04-2026', 'sbom-15-04-2026'] as never,
    );
    const result = findSbomRepositoryFolder('/repo');
    expect(result).not.toBeNull();
    expect(result!.folderDate).toBe('sbom-23-04-2026');
    expect(result!.folderPath).toContain('sbom-23-04-2026');
  });

  it('returns the only folder when exactly one exists', async () => {
    const { readdirSync } = await import('node:fs');
    vi.mocked(readdirSync).mockReturnValueOnce(['sbom-23-04-2026'] as never);
    const result = findSbomRepositoryFolder('/repo');
    expect(result!.folderDate).toBe('sbom-23-04-2026');
  });

  it('ignores folders that do not match the sbom-DD-MM-YYYY pattern', async () => {
    const { readdirSync } = await import('node:fs');
    vi.mocked(readdirSync).mockReturnValueOnce(
      ['sbom-23-04-2026', 'sbom-today', 'random-folder', 'scripts'] as never,
    );
    const result = findSbomRepositoryFolder('/repo');
    expect(result!.folderDate).toBe('sbom-23-04-2026');
  });
});

// ── scan — sbom-repository mode ───────────────────────────────────────────────

describe('scan — sbom-repository mode', () => {
  beforeEach(async () => {
    const { buildSummary, generateReports } = await import('../../src/report.js');
    vi.mocked(buildSummary).mockReturnValue({
      date: '2026-04-23', generatedAt: '', totals: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 },
      hasCriticalOrHigh: false, hasErrors: false, reposWithIssues: [], reposWithErrors: [], repositories: [],
    } as never);
    vi.mocked(generateReports).mockReturnValue({ json: '/tmp/r.json', html: '/tmp/r.html', txt: '/tmp/r.txt' });
  });

  afterEach(() => { vi.clearAllMocks(); });

  it('skips clone and generateSbom — calls scanSbom once per .json file in the detected folder', async () => {
    const { readdirSync } = await import('node:fs');
    vi.mocked(readdirSync)
      .mockReturnValueOnce(['sbom-23-04-2026'] as never)
      .mockReturnValueOnce(['i02-communications.json', 'i03_integrationapi.json'] as never);

    const { cloneRepo }    = await import('../../src/git.js');
    const { generateSbom } = await import('../../src/sbom.js');
    const { scanSbom }     = await import('../../src/scanner.js');
    vi.mocked(scanSbom).mockReturnValue({
      trivyFile: '/tmp/trivy.json', findings: [],
      counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 },
    } as never);

    const repo: RepoConfig = {
      name: 'i360-sbom-repository', cloneUrl: '', branch: 'master',
      type: 'node', mode: 'sbom-repository', path: '/local/repo',
    };
    const config = makeConfig({ config: { repos: [repo] } });

    await scan(config);

    expect(vi.mocked(cloneRepo)).not.toHaveBeenCalled();
    expect(vi.mocked(generateSbom)).not.toHaveBeenCalled();
    expect(vi.mocked(scanSbom)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(scanSbom)).toHaveBeenCalledWith(
      expect.stringContaining('i02-communications.json'),
      expect.any(String), 'i02-communications', 'sbom-23-04-2026', 'sbom-23-04-2026', expect.any(Date),
    );
  });

  it('records an error result when no sbom-DD-MM-YYYY folder is found', async () => {
    const { readdirSync } = await import('node:fs');
    vi.mocked(readdirSync).mockReturnValueOnce(['README.md'] as never);

    const { buildSummary } = await import('../../src/report.js');
    const repo: RepoConfig = {
      name: 'i360-sbom-repository', cloneUrl: '', branch: 'master',
      type: 'node', mode: 'sbom-repository', path: '/local/repo',
    };
    const config = makeConfig({ config: { repos: [repo] } });

    await scan(config);

    const call = vi.mocked(buildSummary).mock.calls[0]!;
    const results = call[0];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ repo: 'i360-sbom-repository', error: true });
  });
});
