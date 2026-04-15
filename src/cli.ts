#!/usr/bin/env node
import { loadConfig } from './config.js';
import { scan, checkExternalTools } from './runner.js';
import { log, ok, err } from './logger.js';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Read version from package.json at runtime (ESM-compatible)
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const { version } = _require('../package.json') as { version: string };

const HELP = `
Usage: sbom-sentinel <command> [options]

Commands:
  scan         Run the full SBOM generation and vulnerability scan
  init         Generate a starter sbom-sentinel.config.json in the current directory
  check        Verify that required tools (git, cdxgen, trivy) are installed

Options (scan):
  --dry-run          Show what would be done without executing
  --repo <name>      Scan only a specific repository by name
  --config <path>    Path to config file (default: ./sbom-sentinel.config.json)

Global options:
  --version, -v      Show version
  --help, -h         Show this help message

Environment variables:
  GITHUB_TOKEN              Token for github.com repos (priority over GIT_TOKEN)
  GITHUB_TOKEN_<REPO_NAME>  Per-repo GitHub token (priority over GITHUB_TOKEN)
  BITBUCKET_TOKEN           Token for bitbucket.org repos (priority over GIT_TOKEN)
  BITBUCKET_USER            Bitbucket username (default: x-token-auth)
  BITBUCKET_TOKEN_<REPO_NAME>  Per-repo Bitbucket token, uses x-token-auth username
                            e.g. BITBUCKET_TOKEN_MY_BACKEND for repo "my-backend"
  GIT_TOKEN                 Fallback token for any platform not covered above
  GIT_TOKEN_<REPO_NAME>     Per-repo generic token (priority over GIT_TOKEN)
  GIT_USER                  Fallback git username (default: x-token-auth)
  SLACK_WEBHOOK_URL         Slack webhook for notifications
  SMTP_HOST                 SMTP server for email notifications
  SENTINEL_CONFIG           Path to config file (overrides --config)
  SENTINEL_OUTPUT_DIR       Output directory (default: ./artifacts)
  LOG_LEVEL                 debug | info | warn | error (default: info)

Examples:
  sbom-sentinel scan
  sbom-sentinel scan --dry-run
  sbom-sentinel scan --repo my-backend
  sbom-sentinel init
  sbom-sentinel check
`.trim();

const INIT_CONFIG = {
  $schema: 'https://raw.githubusercontent.com/pbojeda/sbom-sentinel/main/schema.json',
  manufacturer: 'My Company',
  outputDir: './artifacts',
  notifications: {
    onVulnerabilities: true,
    onErrors: true,
    slack: { enabled: false },
    email: { enabled: false },
  },
  repos: [
    {
      name: 'my-backend',
      cloneUrl: 'https://github.com/myorg/my-backend.git',
      branch: 'main',
      type: 'node',
    },
  ],
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // ── Global flags ───────────────────────────────────────────────────────────

  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(`sbom-sentinel v${version}`);
    process.exit(0);
  }

  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const command = argv[0];

  // ── check ──────────────────────────────────────────────────────────────────

  if (command === 'check') {
    log('Checking required external tools…\n');
    try {
      checkExternalTools();
      ok('All required tools are available.');
    } catch (e) {
      err(e instanceof Error ? e.message : String(e));
      process.exit(2);
    }
    return;
  }

  // ── init ───────────────────────────────────────────────────────────────────

  if (command === 'init') {
    const dest = resolve(process.cwd(), 'sbom-sentinel.config.json');
    if (existsSync(dest)) {
      err(`Config file already exists: ${dest}`);
      err('Remove it or specify a different directory.');
      process.exit(1);
    }
    writeFileSync(dest, JSON.stringify(INIT_CONFIG, null, 2) + '\n', 'utf8');
    ok(`Created: ${dest}`);
    log('Edit the repos array to add your repositories, then run: sbom-sentinel scan');
    return;
  }

  // ── scan ───────────────────────────────────────────────────────────────────

  if (command === 'scan') {
    let config;
    try {
      config = loadConfig(argv, process.cwd());
    } catch (e) {
      err(e instanceof Error ? e.message : String(e));
      process.exit(2);
    }

    let result;
    try {
      result = await scan(config);
    } catch (e) {
      err(`Fatal error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(2);
    }

    process.exit(result.exitCode);
    return;
  }

  // ── Unknown command ────────────────────────────────────────────────────────

  err(`Unknown command: ${command}`);
  err(`Run 'sbom-sentinel --help' for usage.`);
  process.exit(2);
}

main().catch((e: unknown) => {
  err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
});
