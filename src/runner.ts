import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { log, ok, warn, err, dim, run } from './logger.js';
import { cloneRepo, cleanupRepo, detectPlatform, repoTokenEnvKey } from './git.js';
import { generateSbom } from './sbom.js';
import { scanSbom } from './scanner.js';
import { buildSummary, generateReports } from './report.js';
import type { ReportFiles } from './report.js';
import { notify, notifyTokenExpiry } from './notify.js';
import type { NotifyConfig } from './notify.js';
import { uploadReports, uploadFile } from './storage.js';
import { generateSbomExport } from './sbom-export.js';
import type { LoadedConfig } from './config.js';
import type { RepoConfig, RepoResult, GlobalSummary, TokenExpiryWarning } from './types.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface RunResult {
  summary: GlobalSummary;
  reports: ReportFiles;
  /** 0 = ok · 1 = CRITICAL/HIGH vulnerabilities found · 2 = scan errors */
  exitCode: 0 | 1 | 2;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Orchestrates the full scan pipeline:
 *   1. Verify external tools (git, cdxgen, trivy)
 *   2. For each repo: clone → generate SBOM → scan → cleanup
 *   3. Build consolidated GlobalSummary
 *   4. Write JSON / HTML / TXT reports
 *   5. Send Slack / email notifications
 *   6. Return result + exit code
 *
 * Individual repo failures are captured in the summary rather than aborting
 * the entire run. The exit code reflects the worst outcome:
 *   - 2 if any repo errored (incomplete scan)
 *   - 1 if CRITICAL/HIGH findings (but all scans succeeded)
 *   - 0 if all clear
 */
export async function scan(config: LoadedConfig): Promise<RunResult> {
  if (config.dryRun) {
    return executeDryRun(config);
  }

  const notifyConfig: NotifyConfig = {
    slackWebhookUrl: config.slackWebhookUrl,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    smtpUser: config.smtpUser,
    smtpPass: config.smtpPass,
    emailFrom: config.emailFrom,
    emailTo: config.emailTo,
    notifications: config.config.notifications,
  };

  // ── 0. Token expiry check ──────────────────────────────────────────────────

  const tokenExpiry = config.config.tokenExpiry ?? {};
  if (Object.keys(tokenExpiry).length > 0) {
    const expiryWarnings = checkTokenExpiry(tokenExpiry, new Date());
    if (expiryWarnings.length > 0) {
      for (const w of expiryWarnings) {
        warn(
          w.daysLeft <= 0
            ? `Token "${w.tokenName}" has EXPIRED (${w.expiresOn}) — update it to avoid authentication failures.`
            : `Token "${w.tokenName}" expires in ${w.daysLeft} day(s) (${w.expiresOn}).`,
        );
      }
      await notifyTokenExpiry(expiryWarnings, notifyConfig);
    }
  }

  // ── 1. Setup ───────────────────────────────────────────────────────────────

  const { repos } = config.config;

  // ── 2. Tool check ──────────────────────────────────────────────────────────

  const allSbomRepo = repos.every((r) => r.mode === 'sbom-repository');
  checkExternalTools({ skipCdxgen: allSbomRepo, skipGit: allSbomRepo });

  // ── 3. Work directory ──────────────────────────────────────────────────────

  const now = new Date();
  const workDir = join(tmpdir(), `sbom-sentinel-${now.getTime()}`);
  mkdirSync(workDir, { recursive: true });
  dim(`Work directory: ${workDir}`);

  log(`Starting scan for ${repos.length} repository/repositories…`);

  // ── 4. Phase 1: clone + generate SBOMs ────────────────────────────────────

  interface SbomPhaseResult {
    repoName: string;
    branch: string;
    commitSha: string;
    sbomFile: string | null;
    error: boolean;
    errorMessage?: string;
  }

  const sbomPhase: SbomPhaseResult[] = [];

  for (const repo of repos) {
    if (repo.mode === 'sbom-repository') {
      log(`\n── ${repo.name} — sbom-repository mode ──`);
      const expanded = processSbomRepository(repo);
      sbomPhase.push(...expanded);
      continue;
    }

    log(`\n── ${repo.name} (${repo.branch}) — generating SBOM ──`);

    // Pre-computed so finally can always clean up, even if cloneRepo throws
    const localPath = join(workDir, repo.name);
    let commitSha = '';

    try {
      const { token, user } = resolveCredentials(repo, config);
      ({ commitSha } = cloneRepo(repo, workDir, token, user));

      const { sbomFile, componentCount } = generateSbom(repo, localPath, config.outputDir, commitSha, now);
      dim(`  SBOM: ${componentCount} components`);

      sbomPhase.push({ repoName: repo.name, branch: repo.branch, commitSha, sbomFile, error: false });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      err(`${repo.name} failed: ${errorMessage}`);
      sbomPhase.push({ repoName: repo.name, branch: repo.branch, commitSha, sbomFile: null, error: true, errorMessage });
    } finally {
      cleanupRepo(localPath);
    }
  }

  // ── 4. Cleanup work dir ────────────────────────────────────────────────────

  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    warn(`Could not remove work directory: ${workDir}`);
  }

  // ── 4b. SBOM export (optional, non-fatal) ─────────────────────────────────

  if (config.config.sbomExport?.enabled !== false) {
    try {
      const prefix = config.config.sbomExport?.filePrefix ?? 'sbom-export';
      const csvPath = generateSbomExport(
        sbomPhase.map((r) => ({ repo: r.repoName, sbomFile: r.sbomFile })),
        config.outputDir,
        prefix,
        now,
      );
      ok(`SBOM export written: ${basename(csvPath)}`);
      for (const storageConf of config.storageConfigs) {
        await uploadFile(csvPath, basename(csvPath), storageConf, now);
      }
    } catch (e) {
      warn(`SBOM export failed (vulnerability scan will continue): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 5. Phase 2: scan SBOMs with Trivy ─────────────────────────────────────

  const results: RepoResult[] = [];

  for (const phase of sbomPhase) {
    if (phase.error || !phase.sbomFile) {
      results.push({
        repo: phase.repoName,
        branch: phase.branch,
        commitSha: phase.commitSha,
        sbomFile: null,
        trivyFile: null,
        findings: [],
        error: true,
        errorMessage: phase.errorMessage,
      });
      continue;
    }

    log(`\n── ${phase.repoName} (${phase.branch}) — scanning ──`);

    try {
      const { trivyFile, findings, counts } = scanSbom(
        phase.sbomFile, config.outputDir, phase.repoName, phase.branch, phase.commitSha, now,
      );
      const summary = formatCounts(counts);
      ok(`${phase.repoName}: ${findings.length} findings${summary ? ` (${summary})` : ''}`);
      results.push({
        repo: phase.repoName,
        branch: phase.branch,
        commitSha: phase.commitSha,
        sbomFile: phase.sbomFile,
        trivyFile,
        findings,
        error: false,
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      err(`${phase.repoName} failed: ${errorMessage}`);
      results.push({
        repo: phase.repoName,
        branch: phase.branch,
        commitSha: phase.commitSha,
        sbomFile: phase.sbomFile,
        trivyFile: null,
        findings: [],
        error: true,
        errorMessage,
      });
    }
  }

  // ── 6. Consolidate ─────────────────────────────────────────────────────────

  const globalSummary = buildSummary(results, now);

  // ── 7. Reports ─────────────────────────────────────────────────────────────

  const reports = generateReports(globalSummary, config.outputDir);

  // ── 7b. Upload to storage (optional) ──────────────────────────────────────

  let reportUrl: string | undefined;
  for (const storageConf of config.storageConfigs) {
    const url = await uploadReports(reports, storageConf);
    if (url && !reportUrl) reportUrl = url;
  }

  // ── 8. Notify ──────────────────────────────────────────────────────────────

  await notify(globalSummary, { ...notifyConfig, reportUrl });

  // ── 9. Exit code ───────────────────────────────────────────────────────────
  // Priority: 2 (errors) > 1 (vulns) > 0 (ok)

  const exitCode: 0 | 1 | 2 = globalSummary.hasErrors
    ? 2
    : globalSummary.hasCriticalOrHigh
    ? 1
    : 0;

  log(`\nScan complete. Exit code: ${exitCode}`);

  return { summary: globalSummary, reports, exitCode };
}

// ── External tool check ───────────────────────────────────────────────────────

/**
 * Checks that git, cdxgen and trivy are available in PATH.
 * Throws with clear install instructions if any are missing.
 *
 * Also exported so the CLI `check` command can call it directly.
 * `skipCdxgen` and `skipGit` can be set to true when all repos use
 * `mode: "sbom-repository"` (no cloning or SBOM generation needed).
 */
export function checkExternalTools(
  options: { skipCdxgen?: boolean; skipGit?: boolean } = {},
): void {
  const { skipCdxgen = false, skipGit = false } = options;
  const tools = [
    ...(!skipGit ? [{ name: 'git', cmd: 'git --version', hint: 'https://git-scm.com/downloads' }] : []),
    ...(!skipCdxgen ? [{ name: 'cdxgen', cmd: 'cdxgen --version', hint: 'npm install -g @cyclonedx/cdxgen' }] : []),
    { name: 'trivy', cmd: 'trivy --version', hint: 'https://trivy.dev/latest/getting-started/installation/' },
  ];

  const missing: string[] = [];

  for (const tool of tools) {
    try {
      run(tool.cmd, { stdio: 'pipe' });
      dim(`  ${tool.name}: ok`);
    } catch {
      missing.push(`  ${tool.name.padEnd(10)} → install: ${tool.hint}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `The following required tools are not installed or not in PATH:\n\n` +
        missing.join('\n') +
        `\n\nInstall them and run again. See the README for details.`,
    );
  }
}

// ── Token expiry check ────────────────────────────────────────────────────────

/**
 * Returns warnings for tokens that expire within 15 days (or have already expired).
 * Tokens with invalid date strings are silently skipped.
 * Exported for testing.
 */
export function checkTokenExpiry(
  tokenExpiry: Record<string, string>,
  now: Date,
): TokenExpiryWarning[] {
  const warnings: TokenExpiryWarning[] = [];
  for (const [tokenName, expiresOnStr] of Object.entries(tokenExpiry)) {
    const expiresOn = new Date(expiresOnStr + 'T00:00:00Z');
    if (isNaN(expiresOn.getTime())) continue;
    const daysLeft = Math.ceil((expiresOn.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 15) {
      warnings.push({ tokenName, expiresOn: expiresOnStr, daysLeft });
    }
  }
  return warnings;
}

// ── Dry-run ───────────────────────────────────────────────────────────────────

function executeDryRun(config: LoadedConfig): RunResult {
  log('DRY RUN — no commands will be executed\n');

  log(`Repositories (${config.config.repos.length}):`);
  for (const repo of config.config.repos) {
    log(`  ${repo.name.padEnd(28)} branch=${repo.branch}  type=${repo.type}  mode=${repo.mode ?? 'cdxgen'}`);
  }

  log(`\nOutput directory     : ${config.outputDir}`);
  log(`Git token (generic)  : ${!!config.gitToken}`);
  log(`GitHub token         : ${!!config.githubToken}`);
  log(`Bitbucket token      : ${!!config.bitbucketToken}`);
  log(`Slack webhook        : ${config.slackWebhookUrl ? 'configured' : 'not set'}`);
  log(`Email recipients     : ${config.emailTo.length > 0 ? config.emailTo.join(', ') : 'not set'}`);
  log(`Storage provider     : ${config.storageConfigs.length > 0 ? config.storageConfigs.map((c) => c.provider).join(', ') : 'not set'}`);

  const sbomExportEnabled = config.config.sbomExport?.enabled !== false;
  if (sbomExportEnabled) {
    const prefix = config.config.sbomExport?.filePrefix ?? 'sbom-export';
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    log(`SBOM export          : ${prefix}-${yyyy}_${mm}_${dd}.csv  (prefix: ${prefix})`);
  } else {
    log(`SBOM export          : disabled`);
  }

  const tokenExpiry = config.config.tokenExpiry ?? {};
  if (Object.keys(tokenExpiry).length > 0) {
    log(`\nToken expiry:`);
    const now = new Date();
    for (const [name, date] of Object.entries(tokenExpiry)) {
      const expiresOn = new Date(date + 'T00:00:00Z');
      const daysLeft = isNaN(expiresOn.getTime())
        ? null
        : Math.ceil((expiresOn.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const status =
        daysLeft === null ? 'invalid date' :
        daysLeft <= 0    ? 'EXPIRED' :
        daysLeft <= 15   ? `WARNING — ${daysLeft}d remaining` :
        `${daysLeft}d remaining`;
      log(`  ${name.padEnd(24)} ${date}  (${status})`);
    }
  }

  const summary = buildSummary([], new Date());
  return { summary, reports: { json: '', html: '', txt: '' }, exitCode: 0 };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Picks the right token/user for a repo based on its hosting platform.
 * Resolution order (highest to lowest priority):
 *   1. BITBUCKET_TOKEN_<REPO_NAME> / GITHUB_TOKEN_<REPO_NAME> / GIT_TOKEN_<REPO_NAME>
 *      — per-repo token created from the repository's own access token settings
 *   2. BITBUCKET_TOKEN / GITHUB_TOKEN — shared platform token
 *   3. GIT_TOKEN — generic fallback
 * Exported for testing.
 */
export function resolveCredentials(
  repo: RepoConfig,
  config: LoadedConfig,
): { token: string; user: string } {
  const platform = detectPlatform(repo.cloneUrl);
  const perRepoToken = process.env[repoTokenEnvKey(platform, repo.name)] ?? '';

  if (platform === 'bitbucket') {
    if (perRepoToken) return { token: perRepoToken, user: 'x-token-auth' };
    if (config.bitbucketToken) return { token: config.bitbucketToken, user: config.bitbucketUser };
  }

  if (platform === 'github') {
    if (perRepoToken) return { token: perRepoToken, user: config.githubUser };
    if (config.githubToken) return { token: config.githubToken, user: config.githubUser };
  }

  if (perRepoToken) return { token: perRepoToken, user: config.gitUser };
  return { token: config.gitToken, user: config.gitUser };
}

// ── sbom-repository mode ──────────────────────────────────────────────────────

/**
 * Finds the most recent `sbom-DD-MM-YYYY` folder inside `repositoryPath`.
 * Returns null if no matching folder exists.
 * Exported for testing.
 */
export function findSbomRepositoryFolder(
  repositoryPath: string,
): { folderPath: string; folderDate: string } | null {
  const entries = readdirSync(repositoryPath).filter((d) => /^sbom-\d{2}-\d{2}-\d{4}$/.test(d));
  if (entries.length === 0) return null;

  entries.sort((a, b) => {
    const toMs = (d: string) => {
      const [dd, mm, yyyy] = d.slice(5).split('-').map(Number) as [number, number, number];
      return new Date(yyyy, mm - 1, dd).getTime();
    };
    return toMs(a) - toMs(b);
  });

  const latest = entries[entries.length - 1]!;
  return { folderPath: join(repositoryPath, latest), folderDate: latest };
}

interface SbomRepoPhaseResult {
  repoName: string;
  branch: string;
  commitSha: string;
  sbomFile: string | null;
  error: boolean;
  errorMessage?: string;
}

function processSbomRepository(repo: RepoConfig): SbomRepoPhaseResult[] {
  const repositoryPath = repo.path;
  if (!repositoryPath) {
    return [{ repoName: repo.name, branch: '', commitSha: '', sbomFile: null, error: true,
      errorMessage: 'sbom-repository mode requires "path" to be set to the local directory' }];
  }

  let folderInfo: ReturnType<typeof findSbomRepositoryFolder>;
  try {
    folderInfo = findSbomRepositoryFolder(repositoryPath);
  } catch (e) {
    return [{ repoName: repo.name, branch: '', commitSha: '', sbomFile: null, error: true,
      errorMessage: `Could not read directory "${repositoryPath}": ${e instanceof Error ? e.message : String(e)}` }];
  }

  if (!folderInfo) {
    return [{ repoName: repo.name, branch: '', commitSha: '', sbomFile: null, error: true,
      errorMessage: `No sbom-DD-MM-YYYY folder found in "${repositoryPath}"` }];
  }

  const { folderPath, folderDate } = folderInfo;

  let jsonFiles: string[];
  try {
    jsonFiles = readdirSync(folderPath).filter((f) => f.endsWith('.json')).sort();
  } catch (e) {
    return [{ repoName: repo.name, branch: folderDate, commitSha: folderDate, sbomFile: null, error: true,
      errorMessage: `Could not read folder "${folderPath}": ${e instanceof Error ? e.message : String(e)}` }];
  }

  if (jsonFiles.length === 0) {
    return [{ repoName: repo.name, branch: folderDate, commitSha: folderDate, sbomFile: null, error: true,
      errorMessage: `No .json SBOM files found in "${folderPath}"` }];
  }

  log(`  Detected ${folderDate} — ${jsonFiles.length} SBOM(s)`);

  return jsonFiles.map((f) => ({
    repoName: basename(f, '.json'),
    branch: folderDate,
    commitSha: folderDate,
    sbomFile: join(folderPath, f),
    error: false,
  }));
}

function formatCounts(counts: { CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number }): string {
  return (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const)
    .filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${s}`)
    .join(', ');
}
