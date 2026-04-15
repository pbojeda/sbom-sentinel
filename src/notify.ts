import { warn, err, ok } from './logger.js';
import { generateText } from './report.js';
import { SEVERITY_ORDER } from './types.js';
import type { GlobalSummary, TokenExpiryWarning } from './types.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface NotifyConfig {
  slackWebhookUrl?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  emailFrom?: string;
  emailTo?: string[];
  notifications?: {
    onVulnerabilities?: boolean;
    onErrors?: boolean;
    slack?: { enabled?: boolean };
    email?: { enabled?: boolean };
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Sends notifications when the summary has CRITICAL/HIGH findings or scan errors.
 * Supported channels: Slack (native fetch) and email (optional nodemailer).
 *
 * Never throws — notification failures are logged and swallowed so the runner
 * can still exit with the correct code.
 */
export async function notify(summary: GlobalSummary, config: NotifyConfig): Promise<void> {
  const notifCfg = config.notifications ?? {};
  const triggerVulns  = notifCfg.onVulnerabilities !== false && summary.hasCriticalOrHigh;
  const triggerErrors = notifCfg.onErrors !== false && summary.hasErrors;

  if (!triggerVulns && !triggerErrors) return;

  const tasks: Promise<void>[] = [];

  // Slack — native fetch (Node 20), no extra dependencies
  if (notifCfg.slack?.enabled !== false && config.slackWebhookUrl) {
    tasks.push(sendSlack(config.slackWebhookUrl, buildSlackMessage(summary)));
  }

  // Email — optional nodemailer
  const emailEnabled =
    notifCfg.email?.enabled === true &&
    !!config.smtpHost &&
    (config.emailTo?.length ?? 0) > 0;

  if (emailEnabled) {
    tasks.push(sendEmailRaw(buildEmailSubject(summary), buildEmailBody(summary), config));
  }

  await Promise.all(tasks);
}

// ── Token expiry notifications ─────────────────────────────────────────────────

/**
 * Sends a token expiry warning via all configured channels (Slack, email).
 * Called at the start of each scan when any token is within 15 days of expiry.
 * Never throws — notification failures are logged and swallowed.
 */
export async function notifyTokenExpiry(
  warnings: TokenExpiryWarning[],
  config: NotifyConfig,
): Promise<void> {
  const tasks: Promise<void>[] = [];
  const notifCfg = config.notifications ?? {};

  if (notifCfg.slack?.enabled !== false && config.slackWebhookUrl) {
    tasks.push(sendSlack(config.slackWebhookUrl, buildTokenExpirySlackMessage(warnings)));
  }

  const emailEnabled =
    notifCfg.email?.enabled === true &&
    !!config.smtpHost &&
    (config.emailTo?.length ?? 0) > 0;

  if (emailEnabled) {
    const expired = warnings.filter((w) => w.daysLeft <= 0);
    const subject =
      expired.length > 0
        ? '[SBOM Sentinel] Token(s) EXPIRED — action required'
        : `[SBOM Sentinel] Token expiry warning — ${Math.min(...warnings.map((w) => w.daysLeft))} day(s) remaining`;
    tasks.push(sendEmailRaw(subject, buildTokenExpiryEmailBody(warnings), config));
  }

  await Promise.all(tasks);
}

/**
 * Builds the Slack message for token expiry warnings. Exported for testing.
 */
export function buildTokenExpirySlackMessage(warnings: TokenExpiryWarning[]): string {
  const lines = ['*SBOM Sentinel — TOKEN EXPIRY WARNING*', ''];
  for (const w of warnings) {
    const status =
      w.daysLeft <= 0
        ? `*EXPIRED* on ${w.expiresOn}`
        : `expires in *${w.daysLeft}* day(s) (${w.expiresOn})`;
    lines.push(`• \`${w.tokenName}\` ${status}`);
  }
  lines.push('');
  lines.push('Update the token and set the new expiry date in `tokenExpiry` in your configuration.');
  return lines.join('\n');
}

/**
 * Builds the plain-text email body for token expiry warnings. Exported for testing.
 */
export function buildTokenExpiryEmailBody(warnings: TokenExpiryWarning[]): string {
  const lines = ['SBOM Sentinel — Token Expiry Warning', ''];
  for (const w of warnings) {
    const status =
      w.daysLeft <= 0
        ? `EXPIRED on ${w.expiresOn}`
        : `expires in ${w.daysLeft} day(s) on ${w.expiresOn}`;
    lines.push(`• ${w.tokenName}: ${status}`);
  }
  lines.push('');
  lines.push(
    'Update the affected token(s) and set the new expiry date in tokenExpiry in your sbom-sentinel.config.json.',
  );
  return lines.join('\n');
}

// ── Slack ─────────────────────────────────────────────────────────────────────

async function sendSlack(webhookUrl: string, text: string): Promise<void> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      warn(`Slack notification failed: HTTP ${res.status} ${res.statusText}`);
    } else {
      ok('Slack notification sent.');
    }
  } catch (e) {
    // Network errors must never crash the runner
    err(`Slack notification error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Builds the plain-text Slack message. Exported for testing.
 */
export function buildSlackMessage(summary: GlobalSummary): string {
  const lines: string[] = [];

  if (summary.hasCriticalOrHigh) {
    lines.push('*SBOM Sentinel — CRITICAL / HIGH VULNERABILITIES DETECTED*');
  }
  if (summary.hasErrors) {
    lines.push('*SBOM Sentinel — SCAN ERRORS*');
  }

  lines.push(`Date: ${summary.date}`);
  lines.push('');

  // Totals
  const totalsLine = SEVERITY_ORDER
    .filter((s) => summary.totals[s] > 0)
    .map((s) => `${summary.totals[s]} ${s}`)
    .join('  |  ');
  if (totalsLine) lines.push(`Totals: ${totalsLine}`);

  // Repos with CRITICAL/HIGH
  if (summary.reposWithIssues.length > 0) {
    lines.push('');
    lines.push('Affected repositories:');
    for (const r of summary.reposWithIssues) {
      lines.push(`• *${r.repo}* (${r.branch}): ${r.critical} CRITICAL, ${r.high} HIGH`);
      // Show top findings
      const top = r.findings
        .filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
        .slice(0, 5);
      for (const f of top) {
        lines.push(`  - ${f.id} ${f.pkg} ${f.installed} [${f.severity}]`);
      }
      if (r.findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').length > 5) {
        const rest = r.findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').length - 5;
        lines.push(`  - … and ${rest} more`);
      }
    }
  }

  // Repos with errors
  if (summary.reposWithErrors.length > 0) {
    lines.push('');
    lines.push('Failed repositories:');
    for (const e of summary.reposWithErrors) {
      lines.push(`• *${e.repo}* (${e.branch}): ${e.errorMessage}`);
    }
  }

  return lines.join('\n');
}

// ── Email ─────────────────────────────────────────────────────────────────────

async function sendEmailRaw(
  subject: string,
  text: string,
  config: NotifyConfig,
): Promise<void> {
  // nodemailer is an optional dependency — attempt dynamic import
  let createTransport: (options: Record<string, unknown>) => {
    sendMail: (opts: Record<string, unknown>) => Promise<unknown>;
  };

  try {
    const nm = await import('nodemailer') as { createTransport: typeof createTransport };
    createTransport = nm.createTransport;
  } catch {
    warn('Email notifications require nodemailer. Install it with: npm install nodemailer');
    return;
  }

  const transporter = createTransport({
    host: config.smtpHost,
    port: config.smtpPort ?? 587,
    secure: (config.smtpPort ?? 587) === 465,
    auth: config.smtpUser
      ? { user: config.smtpUser, pass: config.smtpPass }
      : undefined,
  });

  try {
    await transporter.sendMail({
      from: config.emailFrom,
      to: (config.emailTo ?? []).join(', '),
      subject,
      text,
    });
    ok('Email notification sent.');
  } catch (e) {
    err(`Email notification error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Builds the email subject line. Exported for testing.
 */
export function buildEmailSubject(summary: GlobalSummary): string {
  const parts: string[] = ['[SBOM Sentinel]'];

  if (summary.hasCriticalOrHigh) {
    const c = summary.totals.CRITICAL;
    const h = summary.totals.HIGH;
    const counts = [c && `${c} CRITICAL`, h && `${h} HIGH`].filter(Boolean).join(', ');
    parts.push(`${counts} vulnerabilities found`);
  }

  if (summary.hasErrors) {
    parts.push('scan errors detected');
  }

  parts.push(`— ${summary.date}`);
  return parts.join(' ');
}

function buildEmailBody(summary: GlobalSummary): string {
  return generateText(summary);
}

