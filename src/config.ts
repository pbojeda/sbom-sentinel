import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { SentinelConfig, RepoConfig } from './types.js';
import { detectPlatform } from './git.js';

// ── Public types ─────────────────────────────────────────────────────────────

export interface CliArgs {
  command?: string;
  dryRun: boolean;
  repo?: string;
  configPath?: string;
}

export interface LoadedConfig {
  config: SentinelConfig;
  args: CliArgs;
  outputDir: string;
  gitToken: string;
  gitUser: string;
  githubToken: string;
  githubUser: string;
  bitbucketToken: string;
  bitbucketUser: string;
  slackWebhookUrl?: string;
  smtpHost?: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPass?: string;
  emailFrom?: string;
  emailTo: string[];
  logLevel: string;
  dryRun: boolean;
  targetRepo?: string;
}

// ── .env loader (no dotenv dependency) ───────────────────────────────────────

/**
 * Reads a .env file from `cwd` and sets any missing keys in process.env.
 * Existing env vars always take precedence (env > .env file).
 */
export function loadDotEnv(cwd: string): void {
  const envPath = join(cwd, '.env');
  if (!existsSync(envPath)) return;

  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return;
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;

    // Strip surrounding quotes from value
    const raw_val = trimmed.slice(eq + 1).trim();
    const value = raw_val.replace(/^(["'])(.*)(\1)$/, '$2');

    // Process env always wins
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ── CLI argument parser ───────────────────────────────────────────────────────

/**
 * Parses raw argv (without node + script prefix).
 * Handles: scan, init, check, --dry-run, --repo <name>, --config <path>, --version, --help
 */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if ((arg === '--repo' || arg === '-r') && argv[i + 1]) {
      args.repo = argv[++i];
    } else if ((arg === '--config' || arg === '-c') && argv[i + 1]) {
      args.configPath = argv[++i];
    } else if (!arg.startsWith('-') && !args.command) {
      args.command = arg;
    }
  }

  return args;
}

// ── Config validator ──────────────────────────────────────────────────────────

function validate(raw: unknown): SentinelConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Config file must be a JSON object.');
  }

  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj['repos'])) {
    throw new Error(
      'Config is missing required field: "repos" (must be an array of repository objects).',
    );
  }

  for (const [i, repo] of (obj['repos'] as unknown[]).entries()) {
    if (typeof repo !== 'object' || repo === null) {
      throw new Error(`repos[${i}] must be an object.`);
    }

    const r = repo as Record<string, unknown>;

    if (typeof r['name'] !== 'string' || !r['name'].trim()) {
      throw new Error(`repos[${i}] is missing required field: "name".`);
    }
    if (typeof r['cloneUrl'] !== 'string' || !r['cloneUrl'].trim()) {
      throw new Error(`repos[${i}] ("${r['name']}") is missing required field: "cloneUrl".`);
    }
    if (typeof r['branch'] !== 'string' || !r['branch'].trim()) {
      throw new Error(`repos[${i}] ("${r['name']}") is missing required field: "branch".`);
    }
    if (typeof r['type'] !== 'string' || !r['type'].trim()) {
      throw new Error(`repos[${i}] ("${r['name']}") is missing required field: "type".`);
    }
  }

  return raw as SentinelConfig;
}

// ── Main loader ───────────────────────────────────────────────────────────────

/**
 * Loads and merges configuration from (in ascending priority):
 *   1. Defaults
 *   2. sbom-sentinel.config.json
 *   3. CLI flags
 *   4. Environment variables  ← highest priority
 *
 * @param argv  Raw CLI arguments, defaults to process.argv.slice(2)
 * @param cwd   Working directory for resolving paths, defaults to process.cwd()
 */
export function loadConfig(
  argv: string[] = process.argv.slice(2),
  cwd: string = process.cwd(),
): LoadedConfig {
  // Step 1 — Load .env (only sets keys not already in process.env)
  loadDotEnv(cwd);

  // Step 2 — Parse CLI flags
  const args = parseArgs(argv);

  // Step 3 — Locate config file
  const configPath = resolve(
    cwd,
    process.env['SENTINEL_CONFIG'] ?? args.configPath ?? 'sbom-sentinel.config.json',
  );

  if (!existsSync(configPath)) {
    throw new Error(
      `Config file not found: ${configPath}\n` +
        `Run 'sbom-sentinel init' to generate a starter config in the current directory.`,
    );
  }

  // Step 4 — Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (e) {
    throw new Error(
      `Failed to parse config file: ${configPath}\n${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Step 5 — Validate shape
  const config = validate(parsed);

  // Step 6 — Filter disabled repos
  let repos: RepoConfig[] = config.repos.filter((r) => r.enabled !== false);

  // Step 7 — Filter by --repo / SENTINEL_REPO env var (env var wins)
  const targetRepo = process.env['SENTINEL_REPO'] ?? args.repo;
  if (targetRepo) {
    repos = repos.filter((r) => r.name === targetRepo);
    if (repos.length === 0) {
      throw new Error(
        `Repo "${targetRepo}" not found in config (or is disabled). ` +
          `Available repos: ${config.repos.map((r) => r.name).join(', ')}`,
      );
    }
  }

  config.repos = repos;

  // Step 8 — Merge env vars (env always wins over file values)
  const outputDir = process.env['SENTINEL_OUTPUT_DIR'] ?? config.outputDir ?? './artifacts';
  const gitToken = process.env['GIT_TOKEN'] ?? '';
  const gitUser = process.env['GIT_USER'] ?? 'x-token-auth';
  const githubToken = process.env['GITHUB_TOKEN'] ?? '';
  const githubUser = process.env['GITHUB_USER'] ?? 'x-token-auth';
  const bitbucketToken = process.env['BITBUCKET_TOKEN'] ?? '';
  const bitbucketUser = process.env['BITBUCKET_USER'] ?? 'x-token-auth';

  const emailTo = process.env['EMAIL_TO']
    ? process.env['EMAIL_TO'].split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  // Step 9 — Validate credentials for private repositories (fail fast before any clone)
  for (const repo of config.repos) {
    if (!repo.private) continue;
    const platform = detectPlatform(repo.cloneUrl);
    const resolved =
      platform === 'github'    ? (githubToken || gitToken) :
      platform === 'bitbucket' ? (bitbucketToken || gitToken) :
      gitToken;
    if (!resolved) {
      const hint =
        platform === 'github'    ? 'GITHUB_TOKEN (or GIT_TOKEN)'    :
        platform === 'bitbucket' ? 'BITBUCKET_TOKEN (or GIT_TOKEN)' :
        'GIT_TOKEN';
      throw new Error(
        `Repo "${repo.name}" is marked as private but no token is configured.\n` +
        `Set ${hint} in your environment or .env file.`,
      );
    }
  }

  return {
    config,
    args,
    outputDir,
    gitToken,
    gitUser,
    githubToken,
    githubUser,
    bitbucketToken,
    bitbucketUser,
    slackWebhookUrl: process.env['SLACK_WEBHOOK_URL'],
    smtpHost: process.env['SMTP_HOST'],
    smtpPort: parseInt(process.env['SMTP_PORT'] ?? '587', 10),
    smtpUser: process.env['SMTP_USER'],
    smtpPass: process.env['SMTP_PASS'],
    emailFrom: process.env['EMAIL_FROM'],
    emailTo,
    logLevel: process.env['LOG_LEVEL'] ?? 'info',
    dryRun: args.dryRun,
    targetRepo,
  };
}
