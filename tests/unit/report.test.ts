import { describe, it, expect } from 'vitest';
import { buildSummary, generateJson, generateText, generateHtml } from '../../src/report.js';
import type { RepoResult } from '../../src/types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FINDING_CRITICAL = {
  id: 'CVE-2022-24434', pkg: 'dicer', installed: '0.3.0', fixed: null,
  severity: 'CRITICAL' as const, title: 'ReDoS in dicer',
  url: 'https://avd.aquasec.com/nvd/cve-2022-24434', target: 'package-lock.json', type: 'npm',
};

const FINDING_HIGH = {
  id: 'CVE-2023-45857', pkg: 'axios', installed: '0.21.1', fixed: '1.6.0',
  severity: 'HIGH' as const, title: 'Axios CSRF Vulnerability',
  url: 'https://avd.aquasec.com/nvd/cve-2023-45857', target: 'package-lock.json', type: 'npm',
};

const FINDING_MEDIUM = {
  id: 'CVE-2020-28500', pkg: 'lodash', installed: '4.17.20', fixed: '4.17.21',
  severity: 'MEDIUM' as const, title: 'lodash ReDoS',
  url: 'https://avd.aquasec.com/nvd/cve-2020-28500', target: 'package-lock.json', type: 'npm',
};

const RESULT_WITH_FINDINGS: RepoResult = {
  repo: 'my-backend',
  branch: 'main',
  commitSha: 'abc1234',
  sbomFile: '/artifacts/bom.cdx.json',
  trivyFile: '/artifacts/trivy.json',
  findings: [FINDING_CRITICAL, FINDING_HIGH, FINDING_MEDIUM],
  error: false,
};

const RESULT_CLEAN: RepoResult = {
  repo: 'my-library',
  branch: 'main',
  commitSha: 'def5678',
  sbomFile: '/artifacts/lib.bom.cdx.json',
  trivyFile: '/artifacts/lib.trivy.json',
  findings: [],
  error: false,
};

const RESULT_ERROR: RepoResult = {
  repo: 'my-broken-repo',
  branch: 'develop',
  commitSha: '',
  sbomFile: null,
  trivyFile: null,
  findings: [],
  error: true,
  errorMessage: 'Failed to clone: authentication failed',
};

const NOW = new Date('2024-04-14T13:00:00.000Z');

// ── buildSummary ──────────────────────────────────────────────────────────────

describe('buildSummary', () => {
  it('builds GlobalSummary with correct totals', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS, RESULT_CLEAN], NOW);

    expect(summary.totals.CRITICAL).toBe(1);
    expect(summary.totals.HIGH).toBe(1);
    expect(summary.totals.MEDIUM).toBe(1);
    expect(summary.totals.LOW).toBe(0);
    expect(summary.totals.UNKNOWN).toBe(0);
  });

  it('sets hasCriticalOrHigh when there are CRITICAL findings', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    expect(summary.hasCriticalOrHigh).toBe(true);
  });

  it('sets hasCriticalOrHigh when there are HIGH findings but no CRITICAL', () => {
    const onlyHigh: RepoResult = {
      ...RESULT_WITH_FINDINGS,
      findings: [FINDING_HIGH],
    };
    const summary = buildSummary([onlyHigh], NOW);
    expect(summary.hasCriticalOrHigh).toBe(true);
  });

  it('does not set hasCriticalOrHigh when only MEDIUM/LOW findings', () => {
    const onlyMedium: RepoResult = {
      ...RESULT_WITH_FINDINGS,
      findings: [FINDING_MEDIUM],
    };
    const summary = buildSummary([onlyMedium], NOW);
    expect(summary.hasCriticalOrHigh).toBe(false);
  });

  it('sets hasErrors when at least one repo has error: true', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS, RESULT_ERROR], NOW);
    expect(summary.hasErrors).toBe(true);
  });

  it('does not set hasErrors when all repos succeed', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS, RESULT_CLEAN], NOW);
    expect(summary.hasErrors).toBe(false);
  });

  it('excludes findings from errored repos in totals', () => {
    const errorWithFindings: RepoResult = {
      ...RESULT_ERROR,
      findings: [FINDING_CRITICAL], // should not be counted
      error: true,
    };
    const summary = buildSummary([errorWithFindings], NOW);
    expect(summary.totals.CRITICAL).toBe(0);
  });

  it('populates reposWithIssues for repos with CRITICAL/HIGH', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS, RESULT_CLEAN], NOW);

    expect(summary.reposWithIssues).toHaveLength(1);
    expect(summary.reposWithIssues[0].repo).toBe('my-backend');
    expect(summary.reposWithIssues[0].critical).toBe(1);
    expect(summary.reposWithIssues[0].high).toBe(1);
  });

  it('populates reposWithErrors for failed repos', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS, RESULT_ERROR], NOW);

    expect(summary.reposWithErrors).toHaveLength(1);
    expect(summary.reposWithErrors[0].repo).toBe('my-broken-repo');
    expect(summary.reposWithErrors[0].errorMessage).toBe('Failed to clone: authentication failed');
  });

  it('includes all repos in repositories array', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS, RESULT_CLEAN, RESULT_ERROR], NOW);
    expect(summary.repositories).toHaveLength(3);
  });

  it('sets generatedAt and date from the now parameter', () => {
    const summary = buildSummary([], NOW);
    expect(summary.generatedAt).toBe('2024-04-14T13:00:00.000Z');
    expect(summary.date).toBe('2024-04-14');
  });

  it('returns all-zero totals for empty results', () => {
    const summary = buildSummary([], NOW);
    expect(summary.totals).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 });
    expect(summary.hasCriticalOrHigh).toBe(false);
    expect(summary.hasErrors).toBe(false);
  });
});

// ── generateJson ──────────────────────────────────────────────────────────────

describe('generateJson', () => {
  it('returns valid JSON that can be parsed back', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    const json = generateJson(summary);

    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('parsed JSON matches the original summary', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS, RESULT_ERROR], NOW);
    const parsed = JSON.parse(generateJson(summary)) as typeof summary;

    expect(parsed.totals.CRITICAL).toBe(summary.totals.CRITICAL);
    expect(parsed.hasCriticalOrHigh).toBe(summary.hasCriticalOrHigh);
    expect(parsed.hasErrors).toBe(summary.hasErrors);
    expect(parsed.repositories).toHaveLength(2);
  });

  it('is pretty-printed (contains newlines)', () => {
    const summary = buildSummary([], NOW);
    expect(generateJson(summary)).toContain('\n');
  });
});

// ── generateText ──────────────────────────────────────────────────────────────

describe('generateText', () => {
  it('contains the report date', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    expect(generateText(summary)).toContain('2024-04-14');
  });

  it('shows CRITICAL/HIGH status when applicable', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    expect(generateText(summary)).toContain('CRITICAL');
  });

  it('shows OK status when no CRITICAL/HIGH and no errors', () => {
    const summary = buildSummary([RESULT_CLEAN], NOW);
    expect(generateText(summary)).toContain('STATUS: OK');
  });

  it('contains repo names in the repo table', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS, RESULT_CLEAN], NOW);
    const text = generateText(summary);

    expect(text).toContain('my-backend');
    expect(text).toContain('my-library');
  });

  it('contains CVE IDs for CRITICAL/HIGH findings', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    const text = generateText(summary);

    expect(text).toContain('CVE-2022-24434');
    expect(text).toContain('CVE-2023-45857');
  });

  it('does not include MEDIUM findings in the critical/high detail section', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    const text = generateText(summary);

    // CVE-2020-28500 is MEDIUM — should not appear in the CRITICAL/HIGH section
    // (it may appear in totals but not in the detailed list)
    const critHighSection = text.split('CRITICAL / HIGH FINDINGS')[1] ?? '';
    expect(critHighSection).not.toContain('CVE-2020-28500');
  });

  it('contains error messages when repos failed', () => {
    const summary = buildSummary([RESULT_ERROR], NOW);
    expect(generateText(summary)).toContain('Failed to clone: authentication failed');
  });

  it('contains the sbom-sentinel attribution footer', () => {
    const summary = buildSummary([], NOW);
    expect(generateText(summary)).toContain('sbom-sentinel');
  });
});

// ── generateHtml ──────────────────────────────────────────────────────────────

describe('generateHtml', () => {
  it('starts with <!DOCTYPE html>', () => {
    const summary = buildSummary([], NOW);
    expect(generateHtml(summary)).toMatch(/^<!DOCTYPE html>/);
  });

  it('includes the report date in the title and header', () => {
    const summary = buildSummary([], NOW);
    const html = generateHtml(summary);

    expect(html).toContain('2024-04-14');
  });

  it('uses the danger banner class when CRITICAL/HIGH are present', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    expect(generateHtml(summary)).toContain('class="banner danger"');
  });

  it('uses the ok banner class when no issues', () => {
    const summary = buildSummary([RESULT_CLEAN], NOW);
    expect(generateHtml(summary)).toContain('class="banner ok"');
  });

  it('uses the warning banner class when only errors (no CRITICAL/HIGH)', () => {
    const summary = buildSummary([RESULT_ERROR], NOW);
    expect(generateHtml(summary)).toContain('class="banner warning"');
  });

  it('renders the repository summary table', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    const html = generateHtml(summary);

    expect(html).toContain('<table>');
    expect(html).toContain('my-backend');
    expect(html).toContain('abc1234');
  });

  it('renders repository table with new column order: CRITICAL and HIGH before Status, MEDIUM and LOW after Commit', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    const html = generateHtml(summary);

    const theadMatch = html.match(/<thead>[\s\S]*?<\/thead>/);
    expect(theadMatch).not.toBeNull();
    const thead = theadMatch![0];
    const criticalPos = thead.indexOf('<th>CRITICAL</th>');
    const highPos     = thead.indexOf('<th>HIGH</th>');
    const statusPos   = thead.indexOf('<th>Status</th>');
    const branchPos   = thead.indexOf('<th>Branch</th>');
    const commitPos   = thead.indexOf('<th>Commit</th>');
    const mediumPos   = thead.indexOf('<th>MEDIUM</th>');
    const lowPos      = thead.indexOf('<th>LOW</th>');

    expect(criticalPos).toBeLessThan(highPos);
    expect(highPos).toBeLessThan(statusPos);
    expect(statusPos).toBeLessThan(branchPos);
    expect(branchPos).toBeLessThan(commitPos);
    expect(commitPos).toBeLessThan(mediumPos);
    expect(mediumPos).toBeLessThan(lowPos);
  });

  it('renders zero severity counts as dash in repo table', () => {
    const summary = buildSummary([RESULT_CLEAN], NOW);
    const html = generateHtml(summary);

    // RESULT_CLEAN has no findings so all counts are 0 → should show '-'
    expect(html).toContain('class="sev-CRITICAL">-<');
    expect(html).toContain('class="sev-HIGH">-<');
    expect(html).toContain('class="sev-MEDIUM">-<');
    expect(html).toContain('class="sev-LOW">-<');
  });

  it('renders CVE IDs as links in the findings table', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    const html = generateHtml(summary);

    expect(html).toContain('CVE-2022-24434');
    expect(html).toContain('href="https://avd.aquasec.com/nvd/cve-2022-24434"');
  });

  it('uses safeUrl: valid https URL is preserved in href', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    const html = generateHtml(summary);

    expect(html).toContain('href="https://avd.aquasec.com/nvd/cve-2022-24434"');
  });

  it('uses safeUrl: javascript: URL is replaced with # in href', () => {
    const xssResult: RepoResult = {
      ...RESULT_WITH_FINDINGS,
      findings: [
        { ...FINDING_CRITICAL, url: 'javascript:alert(1)' },
        FINDING_HIGH,
      ],
    };
    const summary = buildSummary([xssResult], NOW);
    const html = generateHtml(summary);

    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="#"');
  });

  it('uses safeUrl: valid-scheme URL with embedded quotes is HTML-escaped (attribute breakout blocked)', () => {
    const xssResult: RepoResult = {
      ...RESULT_WITH_FINDINGS,
      findings: [
        { ...FINDING_CRITICAL, url: 'https://example.com/" onclick="alert(1)' },
      ],
    };
    const summary = buildSummary([xssResult], NOW);
    const html = generateHtml(summary);

    // The injected onclick must not appear as a real attribute
    expect(html).not.toContain('onclick="alert(1)"');
    // The quote must be entity-escaped
    expect(html).toContain('&quot;');
  });

  it('shows findings count and unique CVE ID count in findings section header', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    const html = generateHtml(summary);

    // RESULT_WITH_FINDINGS has 1 CRITICAL + 1 HIGH = 2 findings, 2 unique CVE IDs
    expect(html).toContain('2 findings · 2 unique CVE IDs');
  });

  it('deduplicates CVE IDs in unique count when same CVE affects multiple installed versions', () => {
    const sameCveDifferentVersion: RepoResult = {
      ...RESULT_WITH_FINDINGS,
      findings: [
        FINDING_CRITICAL,
        { ...FINDING_CRITICAL, installed: '0.4.0' }, // same CVE, different version
        FINDING_HIGH,
      ],
    };
    const summary = buildSummary([sameCveDifferentVersion], NOW);
    const html = generateHtml(summary);

    // 3 findings total but only 2 unique CVE IDs
    expect(html).toContain('3 findings · 2 unique CVE IDs');
  });

  it('renders the errors section when repos failed', () => {
    const summary = buildSummary([RESULT_ERROR], NOW);
    const html = generateHtml(summary);

    expect(html).toContain('Scan Errors');
    expect(html).toContain('my-broken-repo');
    expect(html).toContain('Failed to clone: authentication failed');
  });

  it('does not render errors section when no errors', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    expect(generateHtml(summary)).not.toContain('Scan Errors');
  });

  it('does not contain external CSS or JS links', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS, RESULT_ERROR], NOW);
    const html = generateHtml(summary);

    expect(html).not.toMatch(/<link[^>]+href="https?:/);
    expect(html).not.toMatch(/<script[^>]+src="https?:/);
  });

  it('escapes HTML special characters in user data', () => {
    const xssResult: RepoResult = {
      ...RESULT_CLEAN,
      repo: '<script>alert("xss")</script>',
    };
    const summary = buildSummary([xssResult], NOW);
    const html = generateHtml(summary);

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes the severity badge elements', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    const html = generateHtml(summary);

    expect(html).toContain('class="badge critical"');
    expect(html).toContain('class="badge high"');
    expect(html).toContain('class="badge medium"');
    expect(html).toContain('class="badge low"');
  });

  it('renders blast-radius line when repos have CRITICAL/HIGH findings', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS, RESULT_CLEAN], NOW);
    const html = generateHtml(summary);

    expect(html).toContain('class="blast-radius"');
    expect(html).toContain('1 of 2 repositories affected');
  });

  it('renders blast-radius line when repos have errors', () => {
    const summary = buildSummary([RESULT_CLEAN, RESULT_ERROR], NOW);
    const html = generateHtml(summary);

    expect(html).toContain('class="blast-radius"');
    expect(html).toContain('1 scan error');
  });

  it('renders both affected and errors in blast-radius when both are present', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS, RESULT_ERROR], NOW);
    const html = generateHtml(summary);

    expect(html).toContain('class="blast-radius"');
    expect(html).toContain('affected');
    expect(html).toContain('scan error');
  });

  it('does not render blast-radius line when no issues and no errors', () => {
    const summary = buildSummary([RESULT_CLEAN], NOW);
    const html = generateHtml(summary);

    expect(html).not.toContain('class="blast-radius"');
  });

  it('wraps both tables in table-wrap div', () => {
    const summary = buildSummary([RESULT_WITH_FINDINGS], NOW);
    const html = generateHtml(summary);

    const wrapCount = (html.match(/class="table-wrap"/g) ?? []).length;
    expect(wrapCount).toBe(2);
  });
});
