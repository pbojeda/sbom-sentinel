import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runWizard, generateFiles } from '../../src/init.js';
import type { RlInterface, WizardAnswers, CiChoice } from '../../src/init.js';

// ── Mock logger ───────────────────────────────────────────────────────────────

vi.mock('../../src/logger.js', () => ({
  ok:   vi.fn(),
  warn: vi.fn(),
  err:  vi.fn(),
  log:  vi.fn(),
  dim:  vi.fn(),
  run:  vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Creates a mock rl that returns answers in sequence (empty string for remaining). */
function makeRl(answers: string[]): RlInterface {
  let i = 0;
  return {
    question: vi.fn(async () => answers[i++] ?? ''),
    close:    vi.fn(),
  };
}

function makeAnswers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
  return {
    projectName:  'my-project',
    repos:        [],
    slack:        false,
    storage:      'none',
    kubernetes:   false,
    k8sNamespace: 'security',
    k8sSchedule:  '0 2 * * *',
    k8sImage:     'ghcr.io/pbojeda/sbom-sentinel:latest',
    docker:       false,
    ci:           'none',
    ...overrides,
  };
}

// ── runWizard ─────────────────────────────────────────────────────────────────

describe('runWizard', () => {
  it('returns defaults when all answers are empty', async () => {
    // Flow: projectName(enter), addRepo(n), slack(enter=Y), storage(enter=none), kubernetes(enter=N)
    const rl = makeRl(['', 'n', '', '', '']);
    const result = await runWizard(rl, 'my-dir');
    expect(result.projectName).toBe('my-dir');
    expect(result.repos).toEqual([]);
    expect(result.slack).toBe(true);
    expect(result.storage).toBe('none');
    expect(result.kubernetes).toBe(false);
  });

  it('uses provided project name over dirName default', async () => {
    const rl = makeRl(['my-awesome-project', 'n', 'n', '', '']);
    const result = await runWizard(rl, 'dir-name');
    expect(result.projectName).toBe('my-awesome-project');
  });

  it('collects one repo with all fields', async () => {
    // addRepo(y), name, url, branch(enter=main), type(enter=node), private(enter=Y), addMore(n)
    const rl = makeRl([
      '',                                          // project name → default
      'y',                                         // add repo?
      'my-backend',                                // name
      'https://bitbucket.org/myorg/my-backend.git', // url
      '',                                          // branch → main
      '',                                          // type → node
      '',                                          // private → Y (default true)
      'n',                                         // add more?
      'n',                                         // slack
      '',                                          // storage → none
      '',                                          // kubernetes → N
    ]);
    const result = await runWizard(rl, 'proj');
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]).toMatchObject({
      name:     'my-backend',
      cloneUrl: 'https://bitbucket.org/myorg/my-backend.git',
      branch:   'main',
      type:     'node',
      private:  true,
    });
  });

  it('collects two repos then stops', async () => {
    const rl = makeRl([
      '',           // project name
      'y',          // add first repo
      'svc-a',      // name
      'https://github.com/org/svc-a.git',
      'main', '',   // branch, type
      '',           // private → true
      'y',          // add second
      'svc-b',
      'https://github.com/org/svc-b.git',
      'develop', 'python',
      'n',          // private → false
      'n',          // no more
      'n',          // slack
      '',           // storage
      '',           // kubernetes
    ]);
    const result = await runWizard(rl, 'proj');
    expect(result.repos).toHaveLength(2);
    expect(result.repos[1]!.branch).toBe('develop');
    expect(result.repos[1]!.type).toBe('python');
  });

  it('skips repo when name is empty and continues loop', async () => {
    const rl = makeRl([
      '',     // project name
      'y',    // add repo
      '',     // name empty → skip
      'y',    // try again
      'valid-svc',
      'https://github.com/org/valid-svc.git',
      '', '',
      '',     // private → true
      'n',    // no more
      'n', '', '',
    ]);
    const result = await runWizard(rl, 'proj');
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]!.name).toBe('valid-svc');
  });

  it('sets kubernetes=true and reads k8s options', async () => {
    const rl = makeRl([
      '',    // project name
      'n',   // no repos
      'n',   // no slack
      '',    // storage → none
      'y',   // kubernetes
      'monitoring',              // namespace
      '0 6 * * 1',              // schedule
      'myregistry/sbom:v1',     // image
    ]);
    const result = await runWizard(rl, 'proj');
    expect(result.kubernetes).toBe(true);
    expect(result.k8sNamespace).toBe('monitoring');
    expect(result.k8sSchedule).toBe('0 6 * * 1');
    expect(result.k8sImage).toBe('myregistry/sbom:v1');
  });

  it('accepts storage=both', async () => {
    const rl = makeRl(['', 'n', 'n', 'both', '']);
    const result = await runWizard(rl, 'proj');
    expect(result.storage).toBe('both');
  });

  it('loops on invalid choice until a valid value is entered', async () => {
    // storage: first answer 'invalid', then 'ibm-cos'
    const rl = makeRl(['', 'n', 'n', 'invalid', 'ibm-cos', '']);
    const result = await runWizard(rl, 'proj');
    expect(result.storage).toBe('ibm-cos');
  });

  it('re-prompts on invalid yes/no input until a valid answer is given', async () => {
    // 'sure' is not y/n — should re-prompt; 'n' answers the question
    const rl = makeRl(['', 'sure', 'n', 'n', '', '']);
    const result = await runWizard(rl, 'proj');
    expect(result.repos).toHaveLength(0);
  });

  it('rejects SSH clone URL and prompts for a new URL', async () => {
    const rl = makeRl([
      '',                                       // project name
      'y',                                      // add repo
      'my-svc',                                 // name
      'git@github.com:org/my-svc.git',          // SSH URL → rejected
      'y',                                      // add repo (loop restart)
      'my-svc',                                 // name
      'https://github.com/org/my-svc.git',      // valid HTTPS
      '', '',                                   // branch, type defaults
      '',                                       // private → true
      'n',                                      // no more repos
      'n', '', '',                              // slack, storage, kubernetes
    ]);
    const result = await runWizard(rl, 'proj');
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]!.cloneUrl).toBe('https://github.com/org/my-svc.git');
  });

  it('rejects malformed clone URL and prompts for a valid one', async () => {
    const rl = makeRl([
      '',
      'y',
      'my-svc',
      'not-a-url',                              // invalid URL → rejected
      'y',
      'my-svc',
      'https://github.com/org/my-svc.git',
      '', '',
      '',                                       // private → true
      'n',
      'n', '', '',
    ]);
    const result = await runWizard(rl, 'proj');
    expect(result.repos).toHaveLength(1);
  });

  it('docker defaults to false when answer is empty', async () => {
    const rl = makeRl(['', 'n', 'n', '', '']);
    const result = await runWizard(rl, 'proj');
    expect(result.docker).toBe(false);
  });

  it('ci defaults to none when no repos are configured', async () => {
    const rl = makeRl(['', 'n', 'n', '', '']);
    const result = await runWizard(rl, 'proj');
    expect(result.ci).toBe('none');
  });

  it('ci defaults to bitbucket when all repos are on Bitbucket', async () => {
    const rl = makeRl([
      '',    // project name
      'y',   // add repo
      'svc', 'https://bitbucket.org/org/svc.git', '', '', '',
      'n',   // no more
      'n',   // slack
      '',    // storage → none
      '',    // kubernetes → N
      '',    // docker → N
      '',    // ci → accept default (bitbucket)
    ]);
    const result = await runWizard(rl, 'proj');
    expect(result.ci).toBe('bitbucket');
  });

  it('ci defaults to github-actions when all repos are on GitHub', async () => {
    const rl = makeRl([
      '',    // project name
      'y',   // add repo
      'svc', 'https://github.com/org/svc.git', '', '', '',
      'n',   // no more
      'n',   // slack
      '',    // storage → none
      '',    // kubernetes → N
      '',    // docker → N
      '',    // ci → accept default (github-actions)
    ]);
    const result = await runWizard(rl, 'proj');
    expect(result.ci).toBe('github-actions');
  });

  it('ci defaults to none when repos have mixed platforms', async () => {
    const rl = makeRl([
      '',
      'y', 'gh-svc', 'https://github.com/org/gh-svc.git', '', '', '',
      'y', 'bb-svc', 'https://bitbucket.org/org/bb-svc.git', '', '', '',
      'n',
      'n', '', '',
      '', '',   // docker, ci → defaults (none for mixed)
    ]);
    const result = await runWizard(rl, 'proj');
    expect(result.ci).toBe('none');
  });

  it('ci=bitbucket collected correctly when explicitly chosen', async () => {
    const rl = makeRl(['', 'n', 'n', '', '', '', 'bitbucket']);
    const result = await runWizard(rl, 'proj');
    expect(result.ci).toBe('bitbucket' as CiChoice);
  });

  it('docker=true and ci=github-actions collected correctly', async () => {
    const rl = makeRl(['', 'n', 'n', '', '', 'y', 'github-actions']);
    const result = await runWizard(rl, 'proj');
    expect(result.docker).toBe(true);
    expect(result.ci).toBe('github-actions' as CiChoice);
  });
});

// ── generateFiles ─────────────────────────────────────────────────────────────

describe('generateFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sbom-init-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── config ──────────────────────────────────────────────────────────────────

  it('creates sbom-sentinel.config.json with correct manufacturer and repos', () => {
    const answers = makeAnswers({
      projectName: 'my-org',
      repos: [{ name: 'svc', cloneUrl: 'https://github.com/org/svc.git', branch: 'main', type: 'node' }],
    });
    generateFiles(answers, tmpDir);

    const raw = readFileSync(join(tmpDir, 'sbom-sentinel.config.json'), 'utf8');
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    expect(cfg['manufacturer']).toBe('my-org');
    expect(Array.isArray(cfg['repos'])).toBe(true);
    const repos = cfg['repos'] as unknown[];
    expect(repos).toHaveLength(1);
    expect((repos[0] as Record<string, unknown>)['name']).toBe('svc');
  });

  it('sets slack.enabled=true in config when slack=true', () => {
    const answers = makeAnswers({ slack: true });
    generateFiles(answers, tmpDir);

    const cfg = JSON.parse(readFileSync(join(tmpDir, 'sbom-sentinel.config.json'), 'utf8')) as {
      notifications: { slack: { enabled: boolean } };
    };
    expect(cfg.notifications.slack.enabled).toBe(true);
  });

  it('sets slack.enabled=false in config when slack=false', () => {
    const answers = makeAnswers({ slack: false });
    generateFiles(answers, tmpDir);

    const cfg = JSON.parse(readFileSync(join(tmpDir, 'sbom-sentinel.config.json'), 'utf8')) as {
      notifications: { slack: { enabled: boolean } };
    };
    expect(cfg.notifications.slack.enabled).toBe(false);
  });

  // ── .env.example ────────────────────────────────────────────────────────────

  it('creates .env.example with BITBUCKET_TOKEN section for bitbucket repos', () => {
    const answers = makeAnswers({
      repos: [{ name: 'my-backend', cloneUrl: 'https://bitbucket.org/org/my-backend.git', branch: 'main', type: 'node' }],
    });
    generateFiles(answers, tmpDir);

    const env = readFileSync(join(tmpDir, '.env.example'), 'utf8');
    expect(env).toContain('BITBUCKET_TOKEN=');
    expect(env).toContain('BITBUCKET_USER=');
    expect(env).toContain('BITBUCKET_TOKEN_MY_BACKEND=');
  });

  it('creates .env.example with GITHUB_TOKEN section for github repos', () => {
    const answers = makeAnswers({
      repos: [{ name: 'my-api', cloneUrl: 'https://github.com/org/my-api.git', branch: 'main', type: 'node' }],
    });
    generateFiles(answers, tmpDir);

    const env = readFileSync(join(tmpDir, '.env.example'), 'utf8');
    expect(env).toContain('GITHUB_TOKEN=');
    expect(env).toContain('GITHUB_TOKEN_MY_API=');
    expect(env).not.toContain('BITBUCKET_TOKEN=');
  });

  it('includes GIT_TOKEN fallback section for other hosts', () => {
    const answers = makeAnswers({
      repos: [{ name: 'my-svc', cloneUrl: 'https://gitlab.com/org/my-svc.git', branch: 'main', type: 'node' }],
    });
    generateFiles(answers, tmpDir);

    const env = readFileSync(join(tmpDir, '.env.example'), 'utf8');
    expect(env).toContain('GIT_TOKEN=');
    expect(env).toContain('GIT_TOKEN_MY_SVC=');
  });

  it('includes all platform sections when no repos are added', () => {
    const answers = makeAnswers({ repos: [] });
    generateFiles(answers, tmpDir);

    const env = readFileSync(join(tmpDir, '.env.example'), 'utf8');
    expect(env).toContain('GITHUB_TOKEN=');
    expect(env).toContain('BITBUCKET_TOKEN=');
    expect(env).toContain('GIT_TOKEN=');
  });

  it('generates per-repo tokens for mixed-platform repos', () => {
    const answers = makeAnswers({
      repos: [
        { name: 'gh-svc',   cloneUrl: 'https://github.com/org/gh-svc.git',       branch: 'main', type: 'node' },
        { name: 'bb-svc',   cloneUrl: 'https://bitbucket.org/org/bb-svc.git',     branch: 'main', type: 'node' },
      ],
    });
    generateFiles(answers, tmpDir);

    const env = readFileSync(join(tmpDir, '.env.example'), 'utf8');
    expect(env).toContain('GITHUB_TOKEN_GH_SVC=');
    expect(env).toContain('BITBUCKET_TOKEN_BB_SVC=');
  });

  it('includes SLACK_WEBHOOK_URL only when slack=true', () => {
    generateFiles(makeAnswers({ slack: true }),  tmpDir);
    expect(readFileSync(join(tmpDir, '.env.example'), 'utf8')).toContain('SLACK_WEBHOOK_URL=');

    rmSync(join(tmpDir, '.env.example'));
    generateFiles(makeAnswers({ slack: false }), tmpDir);
    expect(readFileSync(join(tmpDir, '.env.example'), 'utf8')).not.toContain('SLACK_WEBHOOK_URL=');
  });

  it('includes IBM COS block when storage=ibm-cos', () => {
    generateFiles(makeAnswers({ storage: 'ibm-cos' }), tmpDir);
    const env = readFileSync(join(tmpDir, '.env.example'), 'utf8');
    expect(env).toContain('STORAGE_PROVIDER=ibm-cos');
    expect(env).toContain('IBM_COS_ENDPOINT=');
    expect(env).not.toContain('GOOGLE_DRIVE_');
  });

  it('includes Google Drive block when storage=google-drive', () => {
    generateFiles(makeAnswers({ storage: 'google-drive' }), tmpDir);
    const env = readFileSync(join(tmpDir, '.env.example'), 'utf8');
    expect(env).toContain('STORAGE_PROVIDER=google-drive');
    expect(env).toContain('GOOGLE_DRIVE_CREDENTIALS=');
    expect(env).not.toContain('IBM_COS_');
  });

  it('writes STORAGE_PROVIDER=ibm-cos,google-drive (not "both") when storage=both', () => {
    generateFiles(makeAnswers({ storage: 'both' }), tmpDir);
    const env = readFileSync(join(tmpDir, '.env.example'), 'utf8');
    expect(env).toContain('STORAGE_PROVIDER=ibm-cos,google-drive');
    expect(env).not.toContain('STORAGE_PROVIDER=both');
    expect(env).toContain('IBM_COS_ENDPOINT=');
    expect(env).toContain('GOOGLE_DRIVE_CREDENTIALS=');
  });

  it('includes no storage section when storage=none', () => {
    generateFiles(makeAnswers({ storage: 'none' }), tmpDir);
    const env = readFileSync(join(tmpDir, '.env.example'), 'utf8');
    expect(env).not.toContain('STORAGE_PROVIDER=');
    expect(env).not.toContain('IBM_COS_');
    expect(env).not.toContain('GOOGLE_DRIVE_');
  });

  // ── .gitignore ───────────────────────────────────────────────────────────────

  it('creates .gitignore that includes .env and artifacts/', () => {
    generateFiles(makeAnswers(), tmpDir);
    const gi = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
    expect(gi).toContain('.env');
    expect(gi).toContain('artifacts/');
  });

  // ── Kubernetes ───────────────────────────────────────────────────────────────

  it('does NOT create kubernetes/ when kubernetes=false', () => {
    generateFiles(makeAnswers({ kubernetes: false }), tmpDir);
    expect(existsSync(join(tmpDir, 'kubernetes'))).toBe(false);
  });

  it('creates kubernetes/ files when kubernetes=true', () => {
    const answers = makeAnswers({ kubernetes: true, k8sNamespace: 'security' });
    generateFiles(answers, tmpDir);
    expect(existsSync(join(tmpDir, 'kubernetes', 'cronjob.yaml'))).toBe(true);
    expect(existsSync(join(tmpDir, 'kubernetes', 'configmap.yaml'))).toBe(true);
    expect(existsSync(join(tmpDir, 'kubernetes', 'secrets.yaml'))).toBe(true);
  });

  it('cronjob.yaml uses the provided namespace, schedule, and image', () => {
    const answers = makeAnswers({
      kubernetes:   true,
      k8sNamespace: 'my-ns',
      k8sSchedule:  '0 3 * * *',
      k8sImage:     'registry.example.com/sbom:1.0',
    });
    generateFiles(answers, tmpDir);

    const cj = readFileSync(join(tmpDir, 'kubernetes', 'cronjob.yaml'), 'utf8');
    expect(cj).toContain('namespace: my-ns');
    expect(cj).toContain('"0 3 * * *"');
    expect(cj).toContain('image: registry.example.com/sbom:1.0');
  });

  it('configmap.yaml embeds the config JSON indented with 4 spaces inside the literal block', () => {
    const answers = makeAnswers({ kubernetes: true, projectName: 'test-proj' });
    generateFiles(answers, tmpDir);

    const cm = readFileSync(join(tmpDir, 'kubernetes', 'configmap.yaml'), 'utf8');
    expect(cm).toContain('sbom-sentinel.config.json: |');
    // Every non-empty line after the literal block header must be 4-space-indented
    const afterHeader = cm.split('sbom-sentinel.config.json: |\n')[1]!;
    for (const line of afterHeader.split('\n')) {
      if (line.trim() === '') continue;
      expect(line).toMatch(/^    /);
    }
  });

  it('secrets.yaml includes per-repo Bitbucket token keys and correct namespace', () => {
    const answers = makeAnswers({
      kubernetes: true,
      k8sNamespace: 'prod',
      repos: [
        { name: 'my-service', cloneUrl: 'https://bitbucket.org/org/my-service.git', branch: 'main', type: 'node' },
      ],
    });
    generateFiles(answers, tmpDir);

    const sec = readFileSync(join(tmpDir, 'kubernetes', 'secrets.yaml'), 'utf8');
    expect(sec).toContain('namespace: prod');
    expect(sec).toContain('BITBUCKET_TOKEN_MY_SERVICE');
  });

  it('secrets.yaml writes STORAGE_PROVIDER=ibm-cos,google-drive (not both) when storage=both', () => {
    const answers = makeAnswers({ kubernetes: true, storage: 'both' });
    generateFiles(answers, tmpDir);

    const sec = readFileSync(join(tmpDir, 'kubernetes', 'secrets.yaml'), 'utf8');
    expect(sec).toContain('STORAGE_PROVIDER: "ibm-cos,google-drive"');
    expect(sec).not.toContain('"both"');
  });

  // ── return value ─────────────────────────────────────────────────────────────

  it('returns the list of created relative paths', () => {
    const created = generateFiles(makeAnswers({ kubernetes: true }), tmpDir);
    expect(created).toContain('sbom-sentinel.config.json');
    expect(created).toContain('.env.example');
    expect(created).toContain('.gitignore');
    expect(created).toContain('kubernetes/cronjob.yaml');
    expect(created).toContain('kubernetes/configmap.yaml');
    expect(created).toContain('kubernetes/secrets.yaml');
  });

  it('returns only 3 paths when kubernetes=false', () => {
    const created = generateFiles(makeAnswers({ kubernetes: false }), tmpDir);
    expect(created).toHaveLength(3);
  });

  // ── .gitignore append ────────────────────────────────────────────────────────

  it('appends .env and artifacts/ to an existing .gitignore that lacks them', () => {
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\ndist/\n');
    generateFiles(makeAnswers(), tmpDir);
    const result = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
    expect(result).toContain('node_modules/');
    expect(result).toContain('.env');
    expect(result).toContain('artifacts/');
  });

  it('does not duplicate entries already present in an existing .gitignore', () => {
    writeFileSync(join(tmpDir, '.gitignore'), '.env\nartifacts/\n');
    generateFiles(makeAnswers(), tmpDir);
    const result = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
    expect(result.split('\n').filter(l => l.trim() === '.env')).toHaveLength(1);
    expect(result.split('\n').filter(l => l.trim() === 'artifacts/')).toHaveLength(1);
  });

  // ── secrets.yaml ─────────────────────────────────────────────────────────────

  it('secrets.yaml has valid YAML with an empty stringData map', () => {
    generateFiles(makeAnswers({ kubernetes: true }), tmpDir);
    const sec = readFileSync(join(tmpDir, 'kubernetes', 'secrets.yaml'), 'utf8');
    expect(sec).toContain('stringData: {}');
  });

  it('secrets.yaml includes all platform sections when no repos and kubernetes=true', () => {
    const answers = makeAnswers({ kubernetes: true, repos: [] });
    generateFiles(answers, tmpDir);
    const sec = readFileSync(join(tmpDir, 'kubernetes', 'secrets.yaml'), 'utf8');
    expect(sec).toContain('GITHUB_TOKEN');
    expect(sec).toContain('BITBUCKET_TOKEN');
    expect(sec).toContain('GIT_TOKEN');
  });

  it('writes private: true in config when repo.private is true', () => {
    const answers = makeAnswers({
      repos: [{ name: 'svc', cloneUrl: 'https://github.com/org/svc.git', branch: 'main', type: 'node', private: true }],
    });
    generateFiles(answers, tmpDir);
    const cfg = JSON.parse(readFileSync(join(tmpDir, 'sbom-sentinel.config.json'), 'utf8')) as {
      repos: Array<Record<string, unknown>>;
    };
    expect(cfg.repos[0]!['private']).toBe(true);
  });

  it('omits private field in config when repo.private is false', () => {
    const answers = makeAnswers({
      repos: [{ name: 'svc', cloneUrl: 'https://github.com/org/svc.git', branch: 'main', type: 'node', private: false }],
    });
    generateFiles(answers, tmpDir);
    const cfg = JSON.parse(readFileSync(join(tmpDir, 'sbom-sentinel.config.json'), 'utf8')) as {
      repos: Array<Record<string, unknown>>;
    };
    expect(cfg.repos[0]!['private']).toBeUndefined();
  });

  it('cronjob.yaml uses emptyDir not PVC', () => {
    generateFiles(makeAnswers({ kubernetes: true }), tmpDir);
    const cj = readFileSync(join(tmpDir, 'kubernetes', 'cronjob.yaml'), 'utf8');
    expect(cj).toContain('emptyDir: {}');
    expect(cj).not.toContain('PersistentVolumeClaim');
    expect(cj).not.toContain('persistentVolumeClaim');
  });

  it('cronjob.yaml contains commented imagePullSecrets hint', () => {
    generateFiles(makeAnswers({ kubernetes: true }), tmpDir);
    const cj = readFileSync(join(tmpDir, 'kubernetes', 'cronjob.yaml'), 'utf8');
    expect(cj).toContain('imagePullSecrets');
  });

  it('secrets.yaml GOOGLE_DRIVE_CREDENTIALS hint shows inline JSON format for Kubernetes', () => {
    const answers = makeAnswers({ kubernetes: true, storage: 'google-drive' });
    generateFiles(answers, tmpDir);
    const sec = readFileSync(join(tmpDir, 'kubernetes', 'secrets.yaml'), 'utf8');
    expect(sec).toContain('GOOGLE_DRIVE_CREDENTIALS');
    expect(sec).toContain('service_account');
  });

  // ── Docker ───────────────────────────────────────────────────────────────────

  it('does NOT create Dockerfile when docker=false', () => {
    generateFiles(makeAnswers({ docker: false }), tmpDir);
    expect(existsSync(join(tmpDir, 'Dockerfile'))).toBe(false);
    expect(existsSync(join(tmpDir, 'docker-compose.yml'))).toBe(false);
  });

  it('creates Dockerfile and docker-compose.yml when docker=true', () => {
    generateFiles(makeAnswers({ docker: true }), tmpDir);
    expect(existsSync(join(tmpDir, 'Dockerfile'))).toBe(true);
    expect(existsSync(join(tmpDir, 'docker-compose.yml'))).toBe(true);
  });

  it('Dockerfile contains node:20-alpine and sbom-sentinel install', () => {
    generateFiles(makeAnswers({ docker: true }), tmpDir);
    const df = readFileSync(join(tmpDir, 'Dockerfile'), 'utf8');
    expect(df).toContain('node:20-alpine');
    expect(df).toContain('npm install -g sbom-sentinel');
    expect(df).toContain('@cyclonedx/cdxgen@11');
  });

  it('docker-compose.yml contains per-repo token for Bitbucket repos', () => {
    const answers = makeAnswers({
      docker: true,
      repos: [{ name: 'my-svc', cloneUrl: 'https://bitbucket.org/org/my-svc.git', branch: 'main', type: 'node' }],
    });
    generateFiles(answers, tmpDir);
    const dc = readFileSync(join(tmpDir, 'docker-compose.yml'), 'utf8');
    expect(dc).toContain('BITBUCKET_TOKEN_MY_SVC');
  });

  it('docker-compose.yml activates storage vars when storage=ibm-cos', () => {
    const answers = makeAnswers({ docker: true, storage: 'ibm-cos' });
    generateFiles(answers, tmpDir);
    const dc = readFileSync(join(tmpDir, 'docker-compose.yml'), 'utf8');
    expect(dc).toMatch(/^\s+STORAGE_PROVIDER:/m);
    expect(dc).toContain('IBM_COS_ENDPOINT:');
    expect(dc).not.toMatch(/^\s+#\s+IBM_COS_ENDPOINT:/m);
  });

  it('docker-compose.yml leaves storage vars commented when storage=none', () => {
    const answers = makeAnswers({ docker: true, storage: 'none' });
    generateFiles(answers, tmpDir);
    const dc = readFileSync(join(tmpDir, 'docker-compose.yml'), 'utf8');
    expect(dc).not.toMatch(/^\s+STORAGE_PROVIDER:/m);
  });

  // ── CI ───────────────────────────────────────────────────────────────────────

  it('does NOT create CI file when ci=none', () => {
    generateFiles(makeAnswers({ ci: 'none' }), tmpDir);
    expect(existsSync(join(tmpDir, 'bitbucket-pipelines.yml'))).toBe(false);
    expect(existsSync(join(tmpDir, '.github'))).toBe(false);
  });

  it('creates bitbucket-pipelines.yml when ci=bitbucket', () => {
    generateFiles(makeAnswers({ ci: 'bitbucket' }), tmpDir);
    expect(existsSync(join(tmpDir, 'bitbucket-pipelines.yml'))).toBe(true);
  });

  it('bitbucket-pipelines.yml lists per-repo token names in comment header', () => {
    const answers = makeAnswers({
      ci: 'bitbucket',
      repos: [
        { name: 'ic-framework-back', cloneUrl: 'https://bitbucket.org/org/ic-framework-back.git', branch: 'main', type: 'node' },
      ],
    });
    generateFiles(answers, tmpDir);
    const yml = readFileSync(join(tmpDir, 'bitbucket-pipelines.yml'), 'utf8');
    expect(yml).toContain('BITBUCKET_TOKEN_IC_FRAMEWORK_BACK');
    expect(yml).toContain('ic-framework-back');
  });

  it('creates .github/workflows/sbom-sentinel.yml when ci=github-actions', () => {
    generateFiles(makeAnswers({ ci: 'github-actions' }), tmpDir);
    expect(existsSync(join(tmpDir, '.github', 'workflows', 'sbom-sentinel.yml'))).toBe(true);
  });

  it('github-actions.yml contains per-repo token env vars for Bitbucket repos', () => {
    const answers = makeAnswers({
      ci: 'github-actions',
      repos: [{ name: 'my-api', cloneUrl: 'https://bitbucket.org/org/my-api.git', branch: 'main', type: 'node' }],
    });
    generateFiles(answers, tmpDir);
    const yml = readFileSync(join(tmpDir, '.github', 'workflows', 'sbom-sentinel.yml'), 'utf8');
    expect(yml).toContain('BITBUCKET_TOKEN_MY_API');
  });

  it('github-actions.yml uses k8sSchedule when kubernetes=true', () => {
    const answers = makeAnswers({ ci: 'github-actions', kubernetes: true, k8sSchedule: '0 4 * * 1' });
    generateFiles(answers, tmpDir);
    const yml = readFileSync(join(tmpDir, '.github', 'workflows', 'sbom-sentinel.yml'), 'utf8');
    expect(yml).toContain("'0 4 * * 1'");
  });

  it('github-actions.yml uses default schedule 0 2 * * * when kubernetes=false', () => {
    const answers = makeAnswers({ ci: 'github-actions', kubernetes: false });
    generateFiles(answers, tmpDir);
    const yml = readFileSync(join(tmpDir, '.github', 'workflows', 'sbom-sentinel.yml'), 'utf8');
    expect(yml).toContain("'0 2 * * *'");
  });

  it('github-actions.yml activates IBM COS env vars when storage=ibm-cos', () => {
    const answers = makeAnswers({ ci: 'github-actions', storage: 'ibm-cos' });
    generateFiles(answers, tmpDir);
    const yml = readFileSync(join(tmpDir, '.github', 'workflows', 'sbom-sentinel.yml'), 'utf8');
    expect(yml).toContain('STORAGE_PROVIDER: ibm-cos');
    expect(yml).toMatch(/^\s+IBM_COS_ENDPOINT:/m);
    expect(yml).not.toMatch(/^\s+#\s+IBM_COS_ENDPOINT:/m);
  });

  it('github-actions.yml activates Google Drive env vars when storage=google-drive', () => {
    const answers = makeAnswers({ ci: 'github-actions', storage: 'google-drive' });
    generateFiles(answers, tmpDir);
    const yml = readFileSync(join(tmpDir, '.github', 'workflows', 'sbom-sentinel.yml'), 'utf8');
    expect(yml).toContain('STORAGE_PROVIDER: google-drive');
    expect(yml).toMatch(/^\s+GOOGLE_DRIVE_CREDENTIALS:/m);
  });

  it('returned paths include Dockerfile and CI file', () => {
    const answers = makeAnswers({ docker: true, ci: 'bitbucket' });
    const created = generateFiles(answers, tmpDir);
    expect(created).toContain('Dockerfile');
    expect(created).toContain('docker-compose.yml');
    expect(created).toContain('bitbucket-pipelines.yml');
  });

  it('returned paths include github-actions workflow path', () => {
    const created = generateFiles(makeAnswers({ ci: 'github-actions' }), tmpDir);
    expect(created).toContain('.github/workflows/sbom-sentinel.yml');
  });
});
