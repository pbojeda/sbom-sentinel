import { describe, it, expect, vi } from 'vitest';
import { checkTokenExpiry } from '../../src/runner.js';

// ── checkTokenExpiry ──────────────────────────────────────────────────────────

vi.mock('../../src/logger.js', () => ({
  ok:   vi.fn(),
  warn: vi.fn(),
  err:  vi.fn(),
  log:  vi.fn(),
  dim:  vi.fn(),
  run:  vi.fn(),
}));

vi.mock('../../src/git.js', () => ({
  cloneRepo:        vi.fn(),
  cleanupRepo:      vi.fn(),
  detectPlatform:   vi.fn(),
  makeSanitizer:    vi.fn(() => (s: string) => s),
}));

vi.mock('../../src/sbom.js',    () => ({ generateSbom:   vi.fn() }));
vi.mock('../../src/scanner.js', () => ({ scanSbom:       vi.fn() }));
vi.mock('../../src/report.js',  () => ({ buildSummary:   vi.fn(() => ({})), generateReports: vi.fn(() => ({})) }));
vi.mock('../../src/notify.js',  () => ({ notify: vi.fn(), notifyTokenExpiry: vi.fn() }));

describe('checkTokenExpiry', () => {
  const now = new Date('2026-04-15T12:00:00Z');

  it('returns empty array when no tokens are configured', () => {
    expect(checkTokenExpiry({}, now)).toEqual([]);
  });

  it('returns empty when all tokens expire more than 15 days from now', () => {
    expect(checkTokenExpiry({ MY_TOKEN: '2026-05-10' }, now)).toEqual([]);
  });

  it('returns a warning when a token expires in exactly 15 days', () => {
    const warnings = checkTokenExpiry({ MY_TOKEN: '2026-04-30' }, now);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ tokenName: 'MY_TOKEN', expiresOn: '2026-04-30', daysLeft: 15 });
  });

  it('returns a warning when a token expires within 15 days', () => {
    const warnings = checkTokenExpiry({ MY_TOKEN: '2026-04-20' }, now);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.daysLeft).toBe(5);
  });

  it('returns a warning with negative daysLeft for an already-expired token', () => {
    const warnings = checkTokenExpiry({ MY_TOKEN: '2026-04-01' }, now);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.daysLeft).toBeLessThan(0);
  });

  it('silently skips tokens with invalid date strings', () => {
    const warnings = checkTokenExpiry({ BAD_TOKEN: 'not-a-date', GOOD_TOKEN: '2026-04-16' }, now);
    expect(warnings.some((w) => w.tokenName === 'BAD_TOKEN')).toBe(false);
    expect(warnings.some((w) => w.tokenName === 'GOOD_TOKEN')).toBe(true);
  });

  it('returns multiple warnings when multiple tokens are expiring soon', () => {
    const expiry = {
      TOKEN_A: '2026-04-18',
      TOKEN_B: '2026-04-25',
      TOKEN_C: '2026-06-01',  // far away — no warning
    };
    const warnings = checkTokenExpiry(expiry, now);
    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.tokenName).sort()).toEqual(['TOKEN_A', 'TOKEN_B']);
  });
});
