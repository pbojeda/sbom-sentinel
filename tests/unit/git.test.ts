import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeSanitizer, buildCloneUrl, cloneRepo, cleanupRepo, detectPlatform } from '../../src/git.js';
import type { RepoConfig } from '../../src/types.js';

// ── Mock logger so no shell commands actually run ─────────────────────────────

vi.mock('../../src/logger.js', () => ({
  run: vi.fn(),
  log: vi.fn(),
  ok:  vi.fn(),
  warn: vi.fn(),
  err: vi.fn(),
  dim: vi.fn(),
}));

// Import after mock so we get the mocked version
import { run } from '../../src/logger.js';
const mockRun = vi.mocked(run);

// ── Helpers ───────────────────────────────────────────────────────────────────

const REPO: RepoConfig = {
  name: 'my-backend',
  cloneUrl: 'https://github.com/myorg/my-backend.git',
  branch: 'main',
  type: 'node',
};

function makeTempDir(): string {
  const dir = join(tmpdir(), `sentinel-git-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── makeSanitizer ─────────────────────────────────────────────────────────────

describe('makeSanitizer', () => {
  it('replaces the token with ***', () => {
    const sanitize = makeSanitizer('secret-token-123');
    expect(sanitize('Error: https://user:secret-token-123@github.com failed')).toBe(
      'Error: https://user:***@github.com failed',
    );
  });

  it('replaces all occurrences in the same string', () => {
    const sanitize = makeSanitizer('tok');
    expect(sanitize('tok and tok and tok')).toBe('*** and *** and ***');
  });

  it('returns identity function when token is empty', () => {
    const sanitize = makeSanitizer('');
    const s = 'no token here';
    expect(sanitize(s)).toBe(s);
  });

  it('handles tokens with special regex characters', () => {
    const sanitize = makeSanitizer('tok.en+x$');
    expect(sanitize('prefix tok.en+x$ suffix')).toBe('prefix *** suffix');
    // Should NOT match "token+x$" (the dot must be literal)
    expect(sanitize('prefix tokenx suffix')).toBe('prefix tokenx suffix');
  });

  it('redacts token from a full git clone error message', () => {
    const token = 'ghp_MySecretToken42';
    const sanitize = makeSanitizer(token);
    const raw = `fatal: unable to access 'https://x-token-auth:ghp_MySecretToken42@github.com/org/repo.git/': The requested URL returned error: 403`;
    expect(sanitize(raw)).not.toContain(token);
    expect(sanitize(raw)).toContain('***');
  });
});

// ── buildCloneUrl ─────────────────────────────────────────────────────────────

describe('buildCloneUrl', () => {
  it('injects user and token into a GitHub URL', () => {
    const url = buildCloneUrl(
      'https://github.com/myorg/my-backend.git',
      'mytoken',
      'x-token-auth',
    );
    expect(url).toBe('https://x-token-auth:mytoken@github.com/myorg/my-backend.git');
  });

  it('injects user and token into a GitLab URL', () => {
    const url = buildCloneUrl(
      'https://gitlab.com/myorg/my-project.git',
      'glpat-abc123',
      'oauth2',
    );
    expect(url).toBe('https://oauth2:glpat-abc123@gitlab.com/myorg/my-project.git');
  });

  it('injects user and token into a Bitbucket URL', () => {
    const url = buildCloneUrl(
      'https://bitbucket.org/myorg/my-repo.git',
      'app-password-xyz',
      'myuser',
    );
    expect(url).toBe('https://myuser:app-password-xyz@bitbucket.org/myorg/my-repo.git');
  });

  it('preserves the repository path and .git suffix', () => {
    const url = buildCloneUrl(
      'https://github.com/org/sub/path/repo.git',
      'tok',
      'user',
    );
    expect(url).toContain('/org/sub/path/repo.git');
  });
});

// ── cloneRepo ─────────────────────────────────────────────────────────────────

describe('cloneRepo', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = makeTempDir();
    // Default: clone succeeds, rev-parse returns a SHA
    mockRun
      .mockReturnValueOnce('')        // git clone
      .mockReturnValueOnce('abc1234'); // git rev-parse
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('calls git clone with the authenticated URL', () => {
    cloneRepo(REPO, workDir, 'mytoken', 'x-token-auth');

    const [cloneCmd] = mockRun.mock.calls[0] as [string, ...unknown[]];
    expect(cloneCmd).toContain('git clone');
    expect(cloneCmd).toContain('x-token-auth:mytoken@github.com');
    expect(cloneCmd).toContain('--depth 1');
    expect(cloneCmd).toContain('--branch main');
  });

  it('calls git rev-parse to capture the commit SHA', () => {
    cloneRepo(REPO, workDir, 'mytoken');

    const [revParseCmd] = mockRun.mock.calls[1] as [string, ...unknown[]];
    expect(revParseCmd).toContain('git rev-parse --short=7 HEAD');
  });

  it('returns the commitSha from rev-parse output', () => {
    const result = cloneRepo(REPO, workDir, 'mytoken');
    expect(result.commitSha).toBe('abc1234');
  });

  it('returns localPath as {workDir}/{repo.name}', () => {
    const result = cloneRepo(REPO, workDir, 'mytoken');
    expect(result.localPath).toBe(join(workDir, 'my-backend'));
  });

  it('passes the sanitizer to run so the token is never logged', () => {
    cloneRepo(REPO, workDir, 'mytoken', 'x-token-auth');

    // The third argument passed to run() must be a sanitizer function
    const sanitizerArg = mockRun.mock.calls[0][2] as ((s: string) => string) | undefined;
    expect(typeof sanitizerArg).toBe('function');

    // And the sanitizer must redact the token
    expect(sanitizerArg?.('contains mytoken here')).toBe('contains *** here');
  });

  it('does not leak the token in error messages when clone fails', () => {
    const token = 'super-secret-token';
    // Simulate run() already applying sanitization (as it does in production)
    mockRun.mockReset();
    mockRun.mockImplementationOnce((_cmd, _opts, sanitize) => {
      // run() applies sanitize before throwing — simulate that behaviour
      const raw = `fatal: could not read Username for 'https://${token}@github.com'`;
      throw new Error((sanitize as (s: string) => string)(raw));
    });

    let thrownMessage = '';
    try {
      cloneRepo(REPO, workDir, token);
    } catch (e) {
      thrownMessage = e instanceof Error ? e.message : String(e);
    }

    expect(thrownMessage).not.toContain(token);
    expect(thrownMessage).toContain('***');
  });

  it('uses x-token-auth as default git user', () => {
    cloneRepo(REPO, workDir, 'mytoken'); // no user arg

    const [cloneCmd] = mockRun.mock.calls[0] as [string, ...unknown[]];
    expect(cloneCmd).toContain('x-token-auth:mytoken@');
  });
});

// ── detectPlatform ────────────────────────────────────────────────────────────

describe('detectPlatform', () => {
  it('returns github for github.com URLs', () => {
    expect(detectPlatform('https://github.com/org/repo.git')).toBe('github');
    expect(detectPlatform('https://github.com/user/private-repo.git')).toBe('github');
  });

  it('returns bitbucket for bitbucket.org URLs', () => {
    expect(detectPlatform('https://bitbucket.org/org/repo.git')).toBe('bitbucket');
    expect(detectPlatform('https://bitbucket.org/myteam/my-service.git')).toBe('bitbucket');
  });

  it('returns other for unknown hosts', () => {
    expect(detectPlatform('https://gitlab.com/org/repo.git')).toBe('other');
    expect(detectPlatform('https://my-gitea.internal/org/repo.git')).toBe('other');
    expect(detectPlatform('https://dev.azure.com/org/repo.git')).toBe('other');
  });
});

// ── cleanupRepo ───────────────────────────────────────────────────────────────

describe('cleanupRepo', () => {
  it('removes an existing directory', () => {
    const dir = makeTempDir();

    cleanupRepo(dir);

    expect(existsSync(dir)).toBe(false);
  });

  it('does not throw when directory does not exist', () => {
    expect(() => cleanupRepo('/tmp/nonexistent-sentinel-dir-xyz')).not.toThrow();
  });
});
