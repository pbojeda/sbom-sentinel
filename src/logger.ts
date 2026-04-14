import { execSync, type ExecSyncOptions } from 'node:child_process';

// ANSI color codes — no external dependencies
const C = {
  reset:  '\x1b[0m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  dim:    '\x1b[2m',
};

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
};

function currentLevel(): number {
  const raw = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase();
  return LEVEL_RANK[raw as LogLevel] ?? LEVEL_RANK.info;
}

function enabled(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= currentLevel();
}

/** General info message. */
export function log(msg: string): void {
  if (enabled('info')) {
    process.stdout.write(`${C.cyan}[info]${C.reset}  ${msg}\n`);
  }
}

/** Success / positive outcome. */
export function ok(msg: string): void {
  if (enabled('info')) {
    process.stdout.write(`${C.green}[ok]${C.reset}    ${msg}\n`);
  }
}

/** Non-fatal warning. */
export function warn(msg: string): void {
  if (enabled('warn')) {
    process.stdout.write(`${C.yellow}[warn]${C.reset}  ${msg}\n`);
  }
}

/** Error message (goes to stderr). */
export function err(msg: string): void {
  if (enabled('error')) {
    process.stderr.write(`${C.red}[err]${C.reset}   ${msg}\n`);
  }
}

/** Debug / verbose message, only shown when LOG_LEVEL=debug. */
export function dim(msg: string): void {
  if (enabled('debug')) {
    process.stdout.write(`${C.dim}[debug]  ${msg}${C.reset}\n`);
  }
}

/**
 * Wrapper around execSync with structured logging and error sanitization.
 *
 * @param cmd      Shell command to execute.
 * @param opts     execSync options (cwd, env, timeout, …).
 * @param sanitize Optional function to redact sensitive data (e.g. tokens)
 *                 from logged command strings and error messages.
 * @returns        stdout as a trimmed string.
 * @throws         Error with sanitized message on non-zero exit.
 */
export function run(
  cmd: string,
  opts: ExecSyncOptions = {},
  sanitize?: (s: string) => string,
): string {
  const displayCmd = sanitize ? sanitize(cmd) : cmd;
  dim(`$ ${displayCmd}`);

  try {
    const out = execSync(cmd, { encoding: 'utf8', ...opts }) as string;
    return (out ?? '').trim();
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : String(e);
    const cleaned = sanitize ? sanitize(raw) : raw;
    throw new Error(cleaned);
  }
}
