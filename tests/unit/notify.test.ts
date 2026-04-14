import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notify, buildSlackMessage, buildEmailSubject } from '../../src/notify.js';
import type { GlobalSummary } from '../../src/types.js';

// ── Mock logger ───────────────────────────────────────────────────────────────

vi.mock('../../src/logger.js', () => ({
  ok:   vi.fn(),
  warn: vi.fn(),
  err:  vi.fn(),
  log:  vi.fn(),
  dim:  vi.fn(),
  run:  vi.fn(),
}));

// Mock report.ts (used by notify for email body)
vi.mock('../../src/report.js', () => ({
  generateText: vi.fn(() => 'text report'),
}));

import { warn, err } from '../../src/logger.js';

// ── Mock fetch globally ───────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Test data helpers ─────────────────────────────────────────────────────────

function makeSummary(overrides: Partial<GlobalSummary> = {}): GlobalSummary {
  return {
    generatedAt: '2024-04-14T13:00:00.000Z',
    date: '2024-04-14',
    totals: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 },
    hasCriticalOrHigh: false,
    hasErrors: false,
    reposWithIssues: [],
    reposWithErrors: [],
    repositories: [],
    ...overrides,
  };
}

const SUMMARY_CRITICAL = makeSummary({
  hasCriticalOrHigh: true,
  totals: { CRITICAL: 1, HIGH: 2, MEDIUM: 1, LOW: 0, UNKNOWN: 0 },
  reposWithIssues: [{
    repo: 'my-backend',
    branch: 'main',
    critical: 1,
    high: 2,
    findings: [
      { id: 'CVE-2022-24434', pkg: 'dicer', installed: '0.3.0', fixed: null, severity: 'CRITICAL', title: 'ReDoS in dicer', url: 'https://avd.aquasec.com/nvd/cve-2022-24434', target: 'package-lock.json', type: 'npm' },
      { id: 'CVE-2023-45857', pkg: 'axios', installed: '0.21.1', fixed: '1.6.0', severity: 'HIGH', title: 'Axios CSRF', url: 'https://avd.aquasec.com/nvd/cve-2023-45857', target: 'package-lock.json', type: 'npm' },
    ],
  }],
});

const SUMMARY_ERRORS = makeSummary({
  hasErrors: true,
  reposWithErrors: [{
    repo: 'my-broken-repo',
    branch: 'main',
    errorMessage: 'Failed to clone: authentication failed',
  }],
});

const SUMMARY_CLEAN = makeSummary();

const WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/xxxx';

// ── notify — Slack ────────────────────────────────────────────────────────────

describe('notify — Slack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
  });

  it('sends to Slack when hasCriticalOrHigh is true', async () => {
    await notify(SUMMARY_CRITICAL, { slackWebhookUrl: WEBHOOK_URL });

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      WEBHOOK_URL,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends to Slack when hasErrors is true', async () => {
    await notify(SUMMARY_ERRORS, { slackWebhookUrl: WEBHOOK_URL });

    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('sends JSON with a text field in the request body', async () => {
    await notify(SUMMARY_CRITICAL, { slackWebhookUrl: WEBHOOK_URL });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { text: string };
    expect(typeof body.text).toBe('string');
    expect(body.text.length).toBeGreaterThan(0);
  });

  it('does not send when SLACK_WEBHOOK_URL is not configured', async () => {
    await notify(SUMMARY_CRITICAL, {}); // no webhookUrl

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not send when neither hasCriticalOrHigh nor hasErrors', async () => {
    await notify(SUMMARY_CLEAN, { slackWebhookUrl: WEBHOOK_URL });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not throw when the network request fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(
      notify(SUMMARY_CRITICAL, { slackWebhookUrl: WEBHOOK_URL }),
    ).resolves.not.toThrow();
  });

  it('logs an error (but does not throw) on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await notify(SUMMARY_CRITICAL, { slackWebhookUrl: WEBHOOK_URL });

    expect(vi.mocked(err)).toHaveBeenCalledWith(
      expect.stringContaining('connect ECONNREFUSED'),
    );
  });

  it('logs a warning on non-2xx HTTP response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });

    await notify(SUMMARY_CRITICAL, { slackWebhookUrl: WEBHOOK_URL });

    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining('403'));
  });

  it('respects onVulnerabilities: false and does not send for vulns', async () => {
    await notify(SUMMARY_CRITICAL, {
      slackWebhookUrl: WEBHOOK_URL,
      notifications: { onVulnerabilities: false },
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('respects onErrors: false and does not send for errors', async () => {
    await notify(SUMMARY_ERRORS, {
      slackWebhookUrl: WEBHOOK_URL,
      notifications: { onErrors: false },
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('respects slack.enabled: false', async () => {
    await notify(SUMMARY_CRITICAL, {
      slackWebhookUrl: WEBHOOK_URL,
      notifications: { slack: { enabled: false } },
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── buildSlackMessage ─────────────────────────────────────────────────────────

describe('buildSlackMessage', () => {
  it('includes CRITICAL headline for summaries with critical findings', () => {
    const msg = buildSlackMessage(SUMMARY_CRITICAL);
    expect(msg).toContain('CRITICAL');
    expect(msg).toContain('VULNERABILITIES');
  });

  it('includes ERRORS headline for summaries with scan errors', () => {
    const msg = buildSlackMessage(SUMMARY_ERRORS);
    expect(msg).toContain('ERRORS');
  });

  it('includes the report date', () => {
    const msg = buildSlackMessage(SUMMARY_CRITICAL);
    expect(msg).toContain('2024-04-14');
  });

  it('includes totals line when there are findings', () => {
    const msg = buildSlackMessage(SUMMARY_CRITICAL);
    expect(msg).toContain('1 CRITICAL');
    expect(msg).toContain('2 HIGH');
  });

  it('includes affected repo name and counts', () => {
    const msg = buildSlackMessage(SUMMARY_CRITICAL);
    expect(msg).toContain('my-backend');
  });

  it('includes CVE IDs of top findings', () => {
    const msg = buildSlackMessage(SUMMARY_CRITICAL);
    expect(msg).toContain('CVE-2022-24434');
  });

  it('includes failed repo and error message', () => {
    const msg = buildSlackMessage(SUMMARY_ERRORS);
    expect(msg).toContain('my-broken-repo');
    expect(msg).toContain('authentication failed');
  });
});

// ── buildEmailSubject ─────────────────────────────────────────────────────────

describe('buildEmailSubject', () => {
  it('includes [SBOM Sentinel] prefix', () => {
    expect(buildEmailSubject(SUMMARY_CRITICAL)).toContain('[SBOM Sentinel]');
  });

  it('mentions CRITICAL count when present', () => {
    expect(buildEmailSubject(SUMMARY_CRITICAL)).toContain('1 CRITICAL');
  });

  it('mentions HIGH count when present', () => {
    expect(buildEmailSubject(SUMMARY_CRITICAL)).toContain('2 HIGH');
  });

  it('mentions errors when hasErrors is true', () => {
    expect(buildEmailSubject(SUMMARY_ERRORS)).toContain('errors');
  });

  it('includes the date', () => {
    expect(buildEmailSubject(SUMMARY_CRITICAL)).toContain('2024-04-14');
  });
});
