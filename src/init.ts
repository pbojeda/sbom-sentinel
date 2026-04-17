import { createInterface } from 'node:readline/promises';
import { writeFileSync, appendFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { ok, log, warn, err } from './logger.js';
import { detectPlatform, repoTokenEnvKey } from './git.js';
import type { GitPlatform } from './git.js';
import type { RepoConfig } from './types.js';

// ── Public types ──────────────────────────────────────────────────────────────

// RepoType reuses the same union as RepoConfig to avoid drift
export type RepoType = RepoConfig['type'];

// StorageChoice is a wizard-only convenience: 'both' maps to 'ibm-cos,google-drive' in all
// generated files — it is NEVER written to disk as-is.
export type StorageChoice = 'none' | 'ibm-cos' | 'google-drive' | 'both';

export interface InitRepo {
  name: string;
  cloneUrl: string;
  branch: string;
  type: RepoType;
}

export interface WizardAnswers {
  projectName: string;
  // No platform field — derived per-repo from cloneUrl via detectPlatform() at file-gen time
  repos: InitRepo[];
  slack: boolean;
  storage: StorageChoice;
  kubernetes: boolean;
  k8sNamespace: string;
  k8sSchedule: string;
  k8sImage: string;
}

// Structural interface for readline injection — lets tests create a plain mock
// without vi.mock('node:readline/promises').
export interface RlInterface {
  question: (prompt: string) => Promise<string>;
  close: () => void;
}

// ── readline helpers ──────────────────────────────────────────────────────────

async function ask(rl: RlInterface, prompt: string, def = ''): Promise<string> {
  const hint = def ? ` [${def}]` : '';
  const answer = (await rl.question(`${prompt}${hint}: `)).trim();
  return answer || def;
}

async function askYesNo(rl: RlInterface, prompt: string, def: boolean): Promise<boolean> {
  const hint = def ? 'Y/n' : 'y/N';
  for (;;) {
    const answer = (await rl.question(`${prompt} (${hint}): `)).trim().toLowerCase();
    if (!answer) return def;
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    log(`  Please answer y or n.`);
  }
}

async function askChoice<T extends string>(
  rl: RlInterface,
  prompt: string,
  choices: readonly T[],
  def: T,
): Promise<T> {
  for (;;) {
    const raw = (await rl.question(`${prompt} (${choices.join('/')}) [${def}]: `)).trim().toLowerCase();
    if (!raw) return def;
    if ((choices as readonly string[]).includes(raw)) return raw as T;
    log(`  Please choose one of: ${choices.join(', ')}`);
  }
}

// ── Wizard ────────────────────────────────────────────────────────────────────

export async function runWizard(rl: RlInterface, dirName: string): Promise<WizardAnswers> {
  log('\nsbom-sentinel init — interactive project setup\n');

  const projectName = await ask(rl, 'Project name', dirName);

  // Collect repos
  const repos: InitRepo[] = [];
  for (;;) {
    const prompt = repos.length === 0 ? 'Add a repository to scan?' : 'Add another repository?';
    const doAdd = await askYesNo(rl, prompt, true);
    if (!doAdd) break;

    const name = await ask(rl, '  Repo name');
    if (!name) { warn('  Repo name is required — skipping.'); continue; }

    const cloneUrl = await ask(rl, '  Clone URL (HTTPS)');
    if (!cloneUrl) { warn('  Clone URL is required — skipping.'); continue; }
    try {
      const { protocol } = new URL(cloneUrl);
      if (protocol !== 'https:' && protocol !== 'http:') {
        warn('  Only HTTPS clone URLs are supported (e.g. https://github.com/org/repo.git).');
        continue;
      }
    } catch {
      warn('  Invalid URL — enter a valid HTTPS clone URL.');
      continue;
    }

    const branch = await ask(rl, '  Branch', 'main');
    const type   = await askChoice(
      rl,
      '  Project type',
      ['node', 'swift', 'gradle', 'python', 'go', 'rust'] as const,
      'node',
    );
    repos.push({ name, cloneUrl, branch, type });
  }

  const slack      = await askYesNo(rl, 'Enable Slack notifications?', true);
  const storage    = await askChoice(
    rl,
    'Report storage',
    ['none', 'ibm-cos', 'google-drive', 'both'] as const,
    'none',
  );
  const kubernetes = await askYesNo(rl, 'Generate Kubernetes manifests?', false);

  let k8sNamespace = 'security';
  let k8sSchedule  = '0 2 * * *';
  let k8sImage     = 'ghcr.io/pbojeda/sbom-sentinel:latest';

  if (kubernetes) {
    k8sNamespace = await ask(rl, '  Kubernetes namespace', 'security');
    k8sSchedule  = await ask(rl, '  CronJob schedule (cron)', '0 2 * * *');
    k8sImage     = await ask(rl, '  Container image', 'ghcr.io/pbojeda/sbom-sentinel:latest');
  }

  return { projectName, repos, slack, storage, kubernetes, k8sNamespace, k8sSchedule, k8sImage };
}

// ── File generation ───────────────────────────────────────────────────────────

export function generateFiles(answers: WizardAnswers, targetDir: string): string[] {
  const created: string[] = [];

  function write(relPath: string, content: string): void {
    const full = join(targetDir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
    created.push(relPath);
  }

  // ── sbom-sentinel.config.json ───────────────────────────────────────────────
  const config = {
    $schema: 'https://raw.githubusercontent.com/pbojeda/sbom-sentinel/main/schema.json',
    manufacturer: answers.projectName,
    outputDir: './artifacts',
    notifications: {
      onVulnerabilities: true,
      onErrors: true,
      slack: { enabled: answers.slack },
      email: { enabled: false },
    },
    repos: answers.repos.map(r => ({
      name:     r.name,
      cloneUrl: r.cloneUrl,
      branch:   r.branch,
      type:     r.type,
    })),
  };
  write('sbom-sentinel.config.json', JSON.stringify(config, null, 2) + '\n');

  // ── .env.example ────────────────────────────────────────────────────────────
  // Derive which platforms are actually used from the repos' clone URLs.
  // This is the same logic the runner uses — no separate "primary platform" question needed.
  const platforms = new Set<GitPlatform>(answers.repos.map(r => detectPlatform(r.cloneUrl)));
  const hasGithub    = platforms.has('github');
  const hasBitbucket = platforms.has('bitbucket');
  const hasOther     = platforms.has('other');
  const noPlatforms  = platforms.size === 0;

  const envLines: string[] = [
    '# sbom-sentinel — Environment Variables',
    '# Copy to .env and fill in your values',
    '# NEVER commit .env — it contains secrets',
    '',
  ];

  if (hasGithub || noPlatforms) {
    envLines.push(
      '# ── GitHub credentials ───────────────────────────────────────────────────────',
      '# Personal Access Token (PAT) for github.com repositories',
      '# GITHUB_TOKEN=your_github_pat_here',
      '# GITHUB_USER=x-token-auth',
    );
    const ghRepos = answers.repos.filter(r => detectPlatform(r.cloneUrl) === 'github');
    if (ghRepos.length > 0) {
      envLines.push('#', '# Per-repo tokens (optional — override GITHUB_TOKEN for a specific repo):');
      for (const r of ghRepos) {
        envLines.push(`# ${repoTokenEnvKey('github', r.name)}=your_github_pat_here`);
      }
    }
    envLines.push('');
  }

  if (hasBitbucket || noPlatforms) {
    envLines.push(
      '# ── Bitbucket credentials ────────────────────────────────────────────────────',
      '# App Password or HTTP Access Token (id.atlassian.com → Security → API tokens)',
      '# BITBUCKET_TOKEN=your_bitbucket_token_here',
      '# BITBUCKET_USER=your-bitbucket-username',
    );
    const bbRepos = answers.repos.filter(r => detectPlatform(r.cloneUrl) === 'bitbucket');
    if (bbRepos.length > 0) {
      envLines.push('#', '# Per-repo tokens (optional — override BITBUCKET_TOKEN for a specific repo):');
      for (const r of bbRepos) {
        envLines.push(`# ${repoTokenEnvKey('bitbucket', r.name)}=ATBB...`);
      }
    }
    envLines.push('');
  }

  if (hasOther || noPlatforms) {
    envLines.push(
      '# ── Generic Git credentials (fallback / self-hosted / GitLab) ───────────────',
      '# GIT_TOKEN=your_token_here',
      '# GIT_USER=x-token-auth',
    );
    const otherRepos = answers.repos.filter(r => detectPlatform(r.cloneUrl) === 'other');
    if (otherRepos.length > 0) {
      envLines.push('#', '# Per-repo tokens (optional):');
      for (const r of otherRepos) {
        envLines.push(`# ${repoTokenEnvKey('other', r.name)}=your_token_here`);
      }
    }
    envLines.push('');
  }

  if (answers.slack) {
    envLines.push(
      '# ── Slack notifications ──────────────────────────────────────────────────────',
      '# Create an Incoming Webhook: https://api.slack.com/messaging/webhooks',
      '# SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz',
      '',
    );
  }

  const hasCos   = answers.storage === 'ibm-cos'      || answers.storage === 'both';
  const hasDrive = answers.storage === 'google-drive' || answers.storage === 'both';

  if (hasCos || hasDrive) {
    // 'both' maps to the comma-separated value the runtime expects
    const storageValue = answers.storage === 'both' ? 'ibm-cos,google-drive' : answers.storage;
    envLines.push(
      '# ── Report storage ───────────────────────────────────────────────────────────',
      `# STORAGE_PROVIDER=${storageValue}`,
      '',
    );
  }

  if (hasCos) {
    envLines.push(
      '# IBM Cloud Object Storage (S3-compatible HMAC credentials)',
      '# IBM_COS_ENDPOINT=https://s3.eu-de.cloud-object-storage.appdomain.cloud',
      '# IBM_COS_BUCKET=sbom-sentinel-reports',
      '# IBM_COS_ACCESS_KEY_ID=REPLACE_ME',
      '# IBM_COS_SECRET_ACCESS_KEY=REPLACE_ME',
      '# IBM_COS_REGION=eu-de',
      '# IBM_COS_PUBLIC_URL=https://sbom-sentinel-reports.s3.eu-de.cloud-object-storage.appdomain.cloud',
      '',
    );
  }

  if (hasDrive) {
    envLines.push(
      '# Google Drive (service account — npm install googleapis)',
      '# GOOGLE_DRIVE_CREDENTIALS=/path/to/service-account.json',
      '# GOOGLE_DRIVE_FOLDER_ID=REPLACE_ME',
      '# Tip: for Google Workspace orgs, use a Shared Drive folder ID to avoid quota errors.',
      '',
    );
  }

  write('.env.example', envLines.join('\n') + '\n');

  // ── .gitignore ──────────────────────────────────────────────────────────────
  const gitignorePath = join(targetDir, '.gitignore');
  if (existsSync(gitignorePath)) {
    const existing = readFileSync(gitignorePath, 'utf8');
    const toAppend = ['.env', 'artifacts/'].filter(
      e => !existing.split('\n').some(l => l.trim() === e),
    );
    if (toAppend.length > 0) {
      appendFileSync(gitignorePath, '\n# sbom-sentinel\n' + toAppend.join('\n') + '\n');
      created.push('.gitignore');
    }
  } else {
    write('.gitignore', [
      '# Secrets — NEVER commit',
      '.env',
      '',
      '# Scan output',
      'artifacts/',
      '',
      '# OS',
      '.DS_Store',
      'Thumbs.db',
      '',
      '# Logs',
      '*.log',
    ].join('\n') + '\n');
  }

  // ── Kubernetes manifests ─────────────────────────────────────────────────────
  if (answers.kubernetes) {
    write('kubernetes/cronjob.yaml',   k8sCronJob(answers));
    write('kubernetes/configmap.yaml', k8sConfigMap(answers, config));
    write('kubernetes/secrets.yaml',   k8sSecrets(answers));
  }

  return created;
}

// ── Kubernetes template generators ───────────────────────────────────────────

function k8sCronJob(a: WizardAnswers): string {
  return `apiVersion: batch/v1
kind: CronJob
metadata:
  name: sbom-sentinel
  namespace: ${a.k8sNamespace}
  labels:
    app: sbom-sentinel
spec:
  schedule: "${a.k8sSchedule}"          # adjust to your timezone
  concurrencyPolicy: Forbid              # skip if previous run is still running
  successfulJobsHistoryLimit: 7
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 1
      activeDeadlineSeconds: 3600        # kill after 1 hour
      template:
        metadata:
          labels:
            app: sbom-sentinel
        spec:
          restartPolicy: Never
          containers:
            - name: sentinel
              image: ${a.k8sImage}
              imagePullPolicy: Always
              args: ["scan"]
              envFrom:
                - secretRef:
                    name: sbom-sentinel-secrets
              env:
                - name: SENTINEL_OUTPUT_DIR
                  value: /app/artifacts
                - name: LOG_LEVEL
                  value: info
              resources:
                requests:
                  cpu: 500m
                  memory: 512Mi
                limits:
                  cpu: "2"
                  memory: 2Gi
              volumeMounts:
                - name: config
                  mountPath: /app/sbom-sentinel.config.json
                  subPath: sbom-sentinel.config.json
                  readOnly: true
                - name: output
                  mountPath: /app/artifacts
          volumes:
            - name: config
              configMap:
                name: sbom-sentinel-config
            - name: output
              persistentVolumeClaim:
                claimName: sbom-sentinel-output

---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: sbom-sentinel-output
  namespace: ${a.k8sNamespace}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  # storageClassName: standard   # uncomment and set your storage class
`;
}

function k8sConfigMap(a: WizardAnswers, config: object): string {
  const indented = JSON.stringify(config, null, 2)
    .split('\n')
    .map(line => `    ${line}`)
    .join('\n');

  return `apiVersion: v1
kind: ConfigMap
metadata:
  name: sbom-sentinel-config
  namespace: ${a.k8sNamespace}
data:
  sbom-sentinel.config.json: |
${indented}
`;
}

function k8sSecrets(a: WizardAnswers): string {
  const platforms    = new Set<GitPlatform>(a.repos.map(r => detectPlatform(r.cloneUrl)));
  const noPlatforms  = platforms.size === 0;
  const hasGithub    = platforms.has('github')    || noPlatforms;
  const hasBitbucket = platforms.has('bitbucket') || noPlatforms;
  const hasOther     = platforms.has('other')     || noPlatforms;
  const hasCos       = a.storage === 'ibm-cos'      || a.storage === 'both';
  const hasDrive     = a.storage === 'google-drive' || a.storage === 'both';
  const storageValue = a.storage === 'both' ? 'ibm-cos,google-drive' : a.storage;

  // All credential hints live in the comment block so stringData: {} is always valid YAML.
  const hints: string[] = [
    '# Secret template — do NOT commit real values.',
    '# Use Sealed Secrets, External Secrets Operator, or your vault solution.',
    '#',
    '# Quick-create from CLI:',
    '#   kubectl create secret generic sbom-sentinel-secrets \\',
    `#     --namespace ${a.k8sNamespace} \\`,
    '#     --from-literal=KEY=\'value\' ...',
    '#     --dry-run=client -o yaml | kubectl apply -f -',
    '#',
    '# Keys to populate in stringData below:',
    '#',
  ];

  if (hasGithub) {
    hints.push(
      '#   # GitHub credentials',
      '#   GITHUB_TOKEN: "REPLACE_ME"',
      '#   GITHUB_USER: "x-token-auth"',
    );
    const ghRepos = a.repos.filter(r => detectPlatform(r.cloneUrl) === 'github');
    if (ghRepos.length > 0) {
      hints.push('#   # Per-repo GitHub tokens (optional):');
      for (const r of ghRepos) {
        hints.push(`#   ${repoTokenEnvKey('github', r.name)}: "REPLACE_ME"`);
      }
    }
    hints.push('#');
  }

  if (hasBitbucket) {
    hints.push(
      '#   # Bitbucket credentials',
      '#   BITBUCKET_TOKEN: "REPLACE_ME"',
      '#   BITBUCKET_USER: "your-bitbucket-username"',
    );
    const bbRepos = a.repos.filter(r => detectPlatform(r.cloneUrl) === 'bitbucket');
    if (bbRepos.length > 0) {
      hints.push('#   # Per-repo Bitbucket tokens (optional):');
      for (const r of bbRepos) {
        hints.push(`#   ${repoTokenEnvKey('bitbucket', r.name)}: "REPLACE_ME"`);
      }
    }
    hints.push('#');
  }

  if (hasOther) {
    hints.push(
      '#   # Generic Git credentials (fallback / self-hosted / GitLab)',
      '#   GIT_TOKEN: "REPLACE_ME"',
      '#   GIT_USER: "x-token-auth"',
      '#',
    );
  }

  if (a.slack) {
    hints.push(
      '#   # Slack webhook',
      '#   SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/xxxx"',
      '#',
    );
  }

  if (hasCos || hasDrive) {
    hints.push(`#   STORAGE_PROVIDER: "${storageValue}"`);
  }

  if (hasCos) {
    hints.push(
      '#   IBM_COS_ENDPOINT: "https://s3.eu-de.cloud-object-storage.appdomain.cloud"',
      '#   IBM_COS_BUCKET: "sbom-sentinel-reports"',
      '#   IBM_COS_ACCESS_KEY_ID: "REPLACE_ME"',
      '#   IBM_COS_SECRET_ACCESS_KEY: "REPLACE_ME"',
      '#   IBM_COS_REGION: "eu-de"',
      '#   IBM_COS_PUBLIC_URL: "https://sbom-sentinel-reports.s3.eu-de.cloud-object-storage.appdomain.cloud"',
      '#',
    );
  }

  if (hasDrive) {
    hints.push(
      '#   GOOGLE_DRIVE_CREDENTIALS: "REPLACE_ME"',
      '#   GOOGLE_DRIVE_FOLDER_ID: "REPLACE_ME"',
      '#',
    );
  }

  return [
    ...hints,
    '',
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    '  name: sbom-sentinel-secrets',
    `  namespace: ${a.k8sNamespace}`,
    'type: Opaque',
    'stringData: {}',
    '',
  ].join('\n');
}

// ── Entry point (called from cli.ts) ─────────────────────────────────────────

export async function runInit(argv: string[]): Promise<void> {
  // argv[0] = 'init', argv[1] = optional target directory
  const targetDir = resolve(process.cwd(), argv[1] ?? '.');
  const dirName   = basename(targetDir);

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
    log(`Created directory: ${targetDir}`);
  }

  const configPath = join(targetDir, 'sbom-sentinel.config.json');
  if (existsSync(configPath)) {
    err(`Config file already exists: ${configPath}`);
    err('Remove it or specify a different directory.');
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const answers = await runWizard(rl, dirName);
    const created = generateFiles(answers, targetDir);

    log('');
    ok(`Project scaffolded in: ${targetDir}`);
    for (const f of created) log(`  ${f}`);
    log('');
    const showCd = argv[1] != null && targetDir !== process.cwd();
    log('Next steps:');
    if (showCd) log(`  1. cd ${argv[1]}`);
    log(`  ${showCd ? 2 : 1}. Copy .env.example → .env and fill in your credentials`);
    log(`  ${showCd ? 3 : 2}. Review sbom-sentinel.config.json — add or remove repos as needed`);
    log(`  ${showCd ? 4 : 3}. Run: sbom-sentinel scan --dry-run`);
  } finally {
    rl.close();
  }
}
