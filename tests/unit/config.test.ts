import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, parseArgs, loadDotEnv } from '../../src/config.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_REPO = {
  name: 'my-backend',
  cloneUrl: 'https://github.com/myorg/my-backend.git',
  branch: 'main',
  type: 'node',
};

function makeTempDir(): string {
  const dir = join(tmpdir(), `sentinel-cfg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfigFile(dir: string, content: unknown, filename = 'sbom-sentinel.config.json'): void {
  writeFileSync(join(dir, filename), JSON.stringify(content));
}

// ── Env var isolation ─────────────────────────────────────────────────────────

const ENV_KEYS = [
  'GIT_TOKEN', 'GIT_USER', 'GITHUB_TOKEN', 'GITHUB_USER', 'BITBUCKET_TOKEN', 'BITBUCKET_USER',
  'SLACK_WEBHOOK_URL', 'SMTP_HOST', 'SMTP_PORT',
  'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'EMAIL_TO', 'SENTINEL_CONFIG',
  'SENTINEL_OUTPUT_DIR', 'SENTINEL_REPO', 'LOG_LEVEL',
  'STORAGE_PROVIDER',
  'IBM_COS_ENDPOINT', 'IBM_COS_BUCKET', 'IBM_COS_ACCESS_KEY_ID', 'IBM_COS_SECRET_ACCESS_KEY',
  'IBM_COS_REGION', 'IBM_COS_PUBLIC_URL',
  'GOOGLE_DRIVE_CREDENTIALS', 'GOOGLE_DRIVE_FOLDER_ID',
];

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

// ── parseArgs ─────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses a bare command', () => {
    expect(parseArgs(['scan'])).toMatchObject({ command: 'scan', dryRun: false });
  });

  it('parses --dry-run', () => {
    expect(parseArgs(['scan', '--dry-run'])).toMatchObject({ command: 'scan', dryRun: true });
  });

  it('parses --repo <name>', () => {
    expect(parseArgs(['scan', '--repo', 'my-backend'])).toMatchObject({ repo: 'my-backend' });
  });

  it('parses --config <path>', () => {
    expect(parseArgs(['scan', '--config', '/tmp/cfg.json'])).toMatchObject({
      configPath: '/tmp/cfg.json',
    });
  });

  it('parses short flags -r and -c', () => {
    expect(parseArgs(['-r', 'api', '-c', 'cfg.json'])).toMatchObject({
      repo: 'api',
      configPath: 'cfg.json',
    });
  });

  it('returns defaults when no args', () => {
    expect(parseArgs([])).toEqual({ dryRun: false });
  });
});

// ── loadDotEnv ────────────────────────────────────────────────────────────────

describe('loadDotEnv', () => {
  it('sets env vars from .env file', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'GIT_TOKEN=abc123\nLOG_LEVEL=debug\n');

    loadDotEnv(dir);

    expect(process.env['GIT_TOKEN']).toBe('abc123');
    expect(process.env['LOG_LEVEL']).toBe('debug');
    rmSync(dir, { recursive: true });
  });

  it('does not overwrite already-set env vars', () => {
    const dir = makeTempDir();
    process.env['GIT_TOKEN'] = 'original';
    writeFileSync(join(dir, '.env'), 'GIT_TOKEN=from-file\n');

    loadDotEnv(dir);

    expect(process.env['GIT_TOKEN']).toBe('original');
    rmSync(dir, { recursive: true });
  });

  it('strips surrounding quotes from values', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'SLACK_WEBHOOK_URL="https://hooks.slack.com/xxx"\n');

    loadDotEnv(dir);

    expect(process.env['SLACK_WEBHOOK_URL']).toBe('https://hooks.slack.com/xxx');
    rmSync(dir, { recursive: true });
  });

  it('silently skips when .env does not exist', () => {
    expect(() => loadDotEnv('/nonexistent/path')).not.toThrow();
  });

  it('ignores comment lines and blank lines', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), '# comment\n\nGIT_USER=myuser\n');

    loadDotEnv(dir);

    expect(process.env['GIT_USER']).toBe('myuser');
    rmSync(dir, { recursive: true });
  });
});

// ── loadConfig ────────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  it('loads a valid config and returns parsed result', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [VALID_REPO] });

    const result = loadConfig([], dir);

    expect(result.config.repos).toHaveLength(1);
    expect(result.config.repos[0].name).toBe('my-backend');
    expect(result.outputDir).toBe('./artifacts');
    expect(result.gitUser).toBe('x-token-auth');
    rmSync(dir, { recursive: true });
  });

  it('throws a clear error when config file does not exist', () => {
    const dir = makeTempDir();
    // No config file written

    expect(() => loadConfig([], dir)).toThrow(/Config file not found/);
    rmSync(dir, { recursive: true });
  });

  it('throws a clear error when repos field is missing', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { manufacturer: 'Acme' }); // no repos key

    expect(() => loadConfig([], dir)).toThrow(/"repos"/);
    rmSync(dir, { recursive: true });
  });

  it('throws when a required repo field is missing', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [{ name: 'x', cloneUrl: 'https://x.com/repo.git' }] }); // missing branch, type

    expect(() => loadConfig([], dir)).toThrow(/"branch"/);
    rmSync(dir, { recursive: true });
  });

  it('filters out repos with enabled: false', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, {
      repos: [
        VALID_REPO,
        { ...VALID_REPO, name: 'disabled-repo', enabled: false },
      ],
    });

    const result = loadConfig([], dir);

    expect(result.config.repos).toHaveLength(1);
    expect(result.config.repos[0].name).toBe('my-backend');
    rmSync(dir, { recursive: true });
  });

  it('filters to a single repo when --repo is passed', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, {
      repos: [
        VALID_REPO,
        { ...VALID_REPO, name: 'other-backend', cloneUrl: 'https://github.com/org/other.git' },
      ],
    });

    const result = loadConfig(['scan', '--repo', 'other-backend'], dir);

    expect(result.config.repos).toHaveLength(1);
    expect(result.config.repos[0].name).toBe('other-backend');
    expect(result.targetRepo).toBe('other-backend');
    rmSync(dir, { recursive: true });
  });

  it('throws when --repo does not match any enabled repo', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [VALID_REPO] });

    expect(() => loadConfig(['--repo', 'nonexistent'], dir)).toThrow(/not found/);
    rmSync(dir, { recursive: true });
  });

  it('env vars take priority over config file values', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [VALID_REPO], outputDir: './from-config' });
    process.env['SENTINEL_OUTPUT_DIR'] = '/from/env';
    process.env['GIT_TOKEN'] = 'env-token';
    process.env['GIT_USER'] = 'env-user';

    const result = loadConfig([], dir);

    expect(result.outputDir).toBe('/from/env');
    expect(result.gitToken).toBe('env-token');
    expect(result.gitUser).toBe('env-user');
    rmSync(dir, { recursive: true });
  });

  it('SENTINEL_REPO env var takes priority over --repo flag', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, {
      repos: [
        VALID_REPO,
        { ...VALID_REPO, name: 'env-repo', cloneUrl: 'https://github.com/org/env.git' },
      ],
    });
    process.env['SENTINEL_REPO'] = 'env-repo';

    const result = loadConfig(['--repo', 'my-backend'], dir);

    expect(result.config.repos[0].name).toBe('env-repo');
    rmSync(dir, { recursive: true });
  });

  it('loads GITHUB_TOKEN and BITBUCKET_TOKEN from env', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [VALID_REPO] });
    process.env['GITHUB_TOKEN'] = 'gh-token';
    process.env['GITHUB_USER'] = 'myuser';
    process.env['BITBUCKET_TOKEN'] = 'bb-token';
    process.env['BITBUCKET_USER'] = 'bbuser';

    const result = loadConfig([], dir);

    expect(result.githubToken).toBe('gh-token');
    expect(result.githubUser).toBe('myuser');
    expect(result.bitbucketToken).toBe('bb-token');
    expect(result.bitbucketUser).toBe('bbuser');
    rmSync(dir, { recursive: true });
  });

  it('does not throw when a private Bitbucket repo has a per-repo BITBUCKET_TOKEN_<REPO_NAME>', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, {
      repos: [{
        ...VALID_REPO,
        cloneUrl: 'https://bitbucket.org/myorg/my-backend.git',
        private: true,
      }],
    });
    process.env['BITBUCKET_TOKEN_MY_BACKEND'] = 'per-repo-token';

    expect(() => loadConfig([], dir)).not.toThrow();
    delete process.env['BITBUCKET_TOKEN_MY_BACKEND'];
    rmSync(dir, { recursive: true });
  });

  it('throws when a private GitHub repo has no GITHUB_TOKEN or GIT_TOKEN', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, {
      repos: [{ ...VALID_REPO, private: true }],
    });

    expect(() => loadConfig([], dir)).toThrow(/GITHUB_TOKEN/);
    rmSync(dir, { recursive: true });
  });

  it('throws when a private Bitbucket repo has no BITBUCKET_TOKEN or GIT_TOKEN', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, {
      repos: [{
        ...VALID_REPO,
        cloneUrl: 'https://bitbucket.org/myorg/my-repo.git',
        private: true,
      }],
    });

    expect(() => loadConfig([], dir)).toThrow(/BITBUCKET_TOKEN/);
    rmSync(dir, { recursive: true });
  });

  it('does not throw when a private repo has the generic GIT_TOKEN as fallback', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [{ ...VALID_REPO, private: true }] });
    process.env['GIT_TOKEN'] = 'fallback-token';

    expect(() => loadConfig([], dir)).not.toThrow();
    rmSync(dir, { recursive: true });
  });

  it('does not throw when a non-private repo has no token configured', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [VALID_REPO] }); // private not set → defaults to false

    expect(() => loadConfig([], dir)).not.toThrow();
    rmSync(dir, { recursive: true });
  });

  it('parses EMAIL_TO as array split by comma', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [VALID_REPO] });
    process.env['EMAIL_TO'] = 'a@x.com, b@x.com , c@x.com';

    const result = loadConfig([], dir);

    expect(result.emailTo).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
    rmSync(dir, { recursive: true });
  });

  it('uses SENTINEL_CONFIG env var to find config file', () => {
    const dir = makeTempDir();
    const customPath = join(dir, 'custom.json');
    writeFileSync(customPath, JSON.stringify({ repos: [VALID_REPO] }));
    process.env['SENTINEL_CONFIG'] = customPath;

    const result = loadConfig([], dir);

    expect(result.config.repos[0].name).toBe('my-backend');
    rmSync(dir, { recursive: true });
  });

  it('passes tokenExpiry from config file into SentinelConfig', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, {
      repos: [VALID_REPO],
      tokenExpiry: { BITBUCKET_TOKEN: '2027-04-15', GITHUB_TOKEN: '2027-06-01' },
    });

    const result = loadConfig([], dir);

    expect(result.config.tokenExpiry).toEqual({
      BITBUCKET_TOKEN: '2027-04-15',
      GITHUB_TOKEN: '2027-06-01',
    });
    rmSync(dir, { recursive: true });
  });

  // ── storageConfig ───────────────────────────────────────────────────────────

  it('storageConfig is undefined when STORAGE_PROVIDER is not set', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [VALID_REPO] });

    const result = loadConfig([], dir);

    expect(result.storageConfig).toBeUndefined();
    rmSync(dir, { recursive: true });
  });

  it('builds storageConfig for ibm-cos when all required vars are set', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [VALID_REPO] });
    process.env['STORAGE_PROVIDER']          = 'ibm-cos';
    process.env['IBM_COS_ENDPOINT']          = 'https://s3.eu-de.cloud-object-storage.appdomain.cloud';
    process.env['IBM_COS_BUCKET']            = 'my-bucket';
    process.env['IBM_COS_ACCESS_KEY_ID']     = 'key-id';
    process.env['IBM_COS_SECRET_ACCESS_KEY'] = 'secret-key';
    process.env['IBM_COS_REGION']            = 'eu-de';
    process.env['IBM_COS_PUBLIC_URL']        = 'https://public.example.com';

    const result = loadConfig([], dir);

    expect(result.storageConfig).toMatchObject({
      provider: 'ibm-cos',
      endpoint: 'https://s3.eu-de.cloud-object-storage.appdomain.cloud',
      bucket: 'my-bucket',
      accessKeyId: 'key-id',
      secretAccessKey: 'secret-key',
      region: 'eu-de',
      publicBaseUrl: 'https://public.example.com',
    });
    rmSync(dir, { recursive: true });
  });

  it('defaults IBM_COS_REGION to us-south when not set', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [VALID_REPO] });
    process.env['STORAGE_PROVIDER']          = 'ibm-cos';
    process.env['IBM_COS_ENDPOINT']          = 'https://s3.eu-de.cloud-object-storage.appdomain.cloud';
    process.env['IBM_COS_BUCKET']            = 'my-bucket';
    process.env['IBM_COS_ACCESS_KEY_ID']     = 'key-id';
    process.env['IBM_COS_SECRET_ACCESS_KEY'] = 'secret-key';

    const result = loadConfig([], dir);

    expect(result.storageConfig?.region).toBe('us-south');
    rmSync(dir, { recursive: true });
  });

  it('throws when STORAGE_PROVIDER=ibm-cos but required vars are missing', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [VALID_REPO] });
    process.env['STORAGE_PROVIDER'] = 'ibm-cos';
    // No IBM_COS_* vars set

    expect(() => loadConfig([], dir)).toThrow(/IBM_COS_ENDPOINT/);
    rmSync(dir, { recursive: true });
  });

  it('builds storageConfig for google-drive when credentials are set', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [VALID_REPO] });
    process.env['STORAGE_PROVIDER']       = 'google-drive';
    process.env['GOOGLE_DRIVE_CREDENTIALS'] = '/secrets/service-account.json';
    process.env['GOOGLE_DRIVE_FOLDER_ID']  = 'folder123';

    const result = loadConfig([], dir);

    expect(result.storageConfig).toMatchObject({
      provider: 'google-drive',
      credentials: '/secrets/service-account.json',
      folderId: 'folder123',
    });
    rmSync(dir, { recursive: true });
  });

  it('throws when STORAGE_PROVIDER=google-drive but GOOGLE_DRIVE_CREDENTIALS is missing', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [VALID_REPO] });
    process.env['STORAGE_PROVIDER'] = 'google-drive';
    // No GOOGLE_DRIVE_CREDENTIALS set

    expect(() => loadConfig([], dir)).toThrow(/GOOGLE_DRIVE_CREDENTIALS/);
    rmSync(dir, { recursive: true });
  });

  it('throws when STORAGE_PROVIDER is an unknown value', () => {
    const dir = makeTempDir();
    writeConfigFile(dir, { repos: [VALID_REPO] });
    process.env['STORAGE_PROVIDER'] = 'dropbox';

    expect(() => loadConfig([], dir)).toThrow(/Unknown STORAGE_PROVIDER/);
    rmSync(dir, { recursive: true });
  });
});
