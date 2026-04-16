import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkTokenExpiry, resolveCredentials, scan } from '../../src/runner.js';
import type { LoadedConfig } from '../../src/config.js';
import type { RepoConfig } from '../../src/types.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

vi.mock('../../src/sbom.js',    () => ({ generateSbom:   vi.fn() }));
vi.mock('../../src/scanner.js', () => ({ scanSbom:       vi.fn() }));
vi.mock('../../src/report.js',   () => ({ buildSummary:   vi.fn(() => ({})), generateReports: vi.fn(() => ({})) }));
vi.mock('../../src/notify.js',   () => ({ notify: vi.fn(), notifyTokenExpiry: vi.fn() }));
vi.mock('../../src/storage.js',  () => ({ uploadReports: vi.fn() }));

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
    const { cloneRepo }      = await import('../../src/git.js');
    const { scanSbom }       = await import('../../src/scanner.js');
    const { buildSummary, generateReports } = await import('../../src/report.js');

    vi.mocked(cloneRepo).mockReturnValue({ commitSha: 'abc1234', localPath: '/tmp/repo' });
    vi.mocked(scanSbom).mockReturnValue({ findings: [], errors: [] });
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
