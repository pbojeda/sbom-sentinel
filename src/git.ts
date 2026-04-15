import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { run, log } from './logger.js';
import type { RepoConfig } from './types.js';

export interface CloneResult {
  commitSha: string;
  localPath: string;
}

// ── Platform detection ────────────────────────────────────────────────────────

export type GitPlatform = 'github' | 'bitbucket' | 'other';

/**
 * Detects the hosting platform from a clone URL.
 * Returns 'github', 'bitbucket', or 'other' for everything else (GitLab, self-hosted, etc.).
 */
export function detectPlatform(cloneUrl: string): GitPlatform {
  if (cloneUrl.includes('github.com')) return 'github';
  if (cloneUrl.includes('bitbucket.org')) return 'bitbucket';
  return 'other';
}

// ── Per-repo token env key ────────────────────────────────────────────────────

/**
 * Returns the environment variable name for a per-repo token.
 * The prefix is derived from the platform; the repo name is uppercased with
 * non-alphanumeric characters replaced by underscores.
 *
 * Examples:
 *   ('bitbucket', 'my-backend')  → 'BITBUCKET_TOKEN_MY_BACKEND'
 *   ('github',    'api_service') → 'GITHUB_TOKEN_API_SERVICE'
 *   ('other',     'my-service')  → 'GIT_TOKEN_MY_SERVICE'
 */
export function repoTokenEnvKey(platform: GitPlatform, repoName: string): string {
  const prefix = platform === 'github' ? 'GITHUB' : platform === 'bitbucket' ? 'BITBUCKET' : 'GIT';
  return `${prefix}_TOKEN_${repoName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

// ── Credential sanitizer ──────────────────────────────────────────────────────

/**
 * Returns a function that replaces every occurrence of `token` in a string
 * with `***`. Used to redact credentials from logs and error messages.
 *
 * If `token` is empty the returned function is a no-op identity.
 */
export function makeSanitizer(token: string): (s: string) => string {
  if (!token) return (s) => s;
  // Escape special regex characters so the token is matched literally
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'g');
  return (s: string) => s.replace(re, '***');
}

// ── URL builder ───────────────────────────────────────────────────────────────

/**
 * Injects `user` and `token` into an HTTPS clone URL.
 *
 * Input:  https://github.com/org/repo.git
 * Output: https://x-token-auth:mytoken@github.com/org/repo.git
 *
 * Works with GitHub, GitLab, Bitbucket and any standard HTTPS Git URL.
 */
export function buildCloneUrl(cloneUrl: string, token: string, user: string): string {
  const url = new URL(cloneUrl);
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(token);
  return url.toString();
}

// ── Clone ─────────────────────────────────────────────────────────────────────

/**
 * Clones `repo` into `{workDir}/{repo.name}` at the specified branch using
 * a shallow clone (depth 1). Returns the 7-char HEAD commit SHA.
 *
 * The token is NEVER written to logs or error messages — every shell command
 * and every error string passes through the sanitizer before being shown.
 *
 * @throws if the clone or rev-parse command fails.
 */
export function cloneRepo(
  repo: RepoConfig,
  workDir: string,
  token: string,
  user = 'x-token-auth',
): CloneResult {
  const localPath = join(workDir, repo.name);
  const sanitize = makeSanitizer(token);
  const authUrl = buildCloneUrl(repo.cloneUrl, token, user);

  // Remove any stale clone from a previous run
  if (existsSync(localPath)) {
    rmSync(localPath, { recursive: true, force: true });
  }
  mkdirSync(localPath, { recursive: true });

  log(`Cloning ${repo.name} (${repo.branch})…`);

  // Shallow clone — the auth URL is sanitized before any logging inside run()
  run(
    `git clone --depth 1 --branch ${repo.branch} "${authUrl}" "${localPath}"`,
    { cwd: workDir },
    sanitize,
  );

  // Capture the 7-char commit SHA
  const commitSha = run('git rev-parse --short=7 HEAD', { cwd: localPath }, sanitize);

  return { commitSha, localPath };
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/**
 * Removes a cloned repository directory. Safe to call on a path that does
 * not exist.
 */
export function cleanupRepo(localPath: string): void {
  if (existsSync(localPath)) {
    rmSync(localPath, { recursive: true, force: true });
  }
}
