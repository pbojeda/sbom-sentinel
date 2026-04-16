import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ok } from './logger.js';
import { SEVERITY_ORDER } from './types.js';
import type { RepoResult, GlobalSummary, SeverityCounts, Finding, RepoSummary } from './types.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ReportFiles {
  json: string;
  html: string;
  txt: string;
}

// ── Summary builder ───────────────────────────────────────────────────────────

/**
 * Consolidates an array of per-repo scan results into a single GlobalSummary.
 */
export function buildSummary(results: RepoResult[], now: Date = new Date()): GlobalSummary {
  const totals: SeverityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };

  for (const r of results) {
    if (!r.error) {
      for (const f of r.findings) totals[f.severity]++;
    }
  }

  const hasCriticalOrHigh = totals.CRITICAL > 0 || totals.HIGH > 0;
  const hasErrors = results.some((r) => r.error);

  const reposWithIssues = results
    .filter((r) => !r.error && r.findings.some((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH'))
    .map((r) => ({
      repo: r.repo,
      branch: r.branch,
      critical: r.findings.filter((f) => f.severity === 'CRITICAL').length,
      high: r.findings.filter((f) => f.severity === 'HIGH').length,
      findings: r.findings,
    }));

  const reposWithErrors = results
    .filter((r) => r.error)
    .map((r) => ({
      repo: r.repo,
      branch: r.branch,
      errorMessage: r.errorMessage ?? 'Unknown error',
    }));

  const repositories: RepoSummary[] = results.map((r) => ({
    repo: r.repo,
    branch: r.branch,
    commitSha: r.commitSha,
    counts: countBySeverity(r.findings),
    error: r.error,
    findingsCount: r.findings.length,
  }));

  return {
    generatedAt: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    totals,
    hasCriticalOrHigh,
    hasErrors,
    reposWithIssues,
    reposWithErrors,
    repositories,
  };
}

// ── File writer ───────────────────────────────────────────────────────────────

/**
 * Writes JSON, HTML and TXT report files to `{outputDir}/reports/`.
 * Returns the absolute paths to each file.
 */
export function generateReports(summary: GlobalSummary, outputDir: string): ReportFiles {
  const reportsDir = join(outputDir, 'reports');
  mkdirSync(reportsDir, { recursive: true });

  const base = `summary__${summary.date}`;
  const paths: ReportFiles = {
    json: join(reportsDir, `${base}.json`),
    html: join(reportsDir, `${base}.html`),
    txt:  join(reportsDir, `${base}.txt`),
  };

  writeFileSync(paths.json, generateJson(summary), 'utf8');
  writeFileSync(paths.html, generateHtml(summary), 'utf8');
  writeFileSync(paths.txt,  generateText(summary), 'utf8');

  ok(`Reports written to ${reportsDir}`);
  return paths;
}

// ── Generators (exported for testing) ────────────────────────────────────────

export function generateJson(summary: GlobalSummary): string {
  return JSON.stringify(summary, null, 2);
}

export function generateText(summary: GlobalSummary): string {
  const SEP = '='.repeat(60);
  const lines: string[] = [];

  lines.push(SEP);
  lines.push('SBOM Sentinel Report');
  lines.push(`Date: ${summary.date}`);
  lines.push(SEP);
  lines.push('');

  // Status
  if (summary.hasCriticalOrHigh) {
    lines.push('STATUS: CRITICAL / HIGH VULNERABILITIES FOUND');
  } else if (summary.hasErrors) {
    lines.push('STATUS: SCAN ERRORS — some repositories could not be scanned');
  } else {
    lines.push('STATUS: OK — no critical or high vulnerabilities found');
  }
  lines.push('');

  // Totals
  lines.push('VULNERABILITY TOTALS');
  for (const s of SEVERITY_ORDER) {
    if (summary.totals[s] > 0) {
      lines.push(`  ${s.padEnd(10)} ${summary.totals[s]}`);
    }
  }
  if (SEVERITY_ORDER.every((s) => summary.totals[s] === 0)) {
    lines.push('  None');
  }
  lines.push('');

  // Repo table
  lines.push(`REPOSITORIES (${summary.repositories.length})`);
  lines.push(`  ${'REPO'.padEnd(24)} ${'BRANCH'.padEnd(16)} ${'COMMIT'.padEnd(8)} C  H  M  L  STATUS`);
  lines.push(`  ${'-'.repeat(72)}`);
  for (const r of summary.repositories) {
    const c = r.counts;
    const status = r.error ? 'ERROR' : 'OK';
    lines.push(
      `  ${r.repo.padEnd(24)} ${r.branch.padEnd(16)} ${r.commitSha.padEnd(8)} ` +
      `${String(c.CRITICAL).padEnd(3)}${String(c.HIGH).padEnd(3)}${String(c.MEDIUM).padEnd(3)}${String(c.LOW).padEnd(3)} ${status}`,
    );
  }
  lines.push('');

  // Critical / High findings detail
  const critHighFindings = summary.reposWithIssues.flatMap((r) =>
    r.findings
      .filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
      .map((f) => ({ ...f, repoName: r.repo })),
  );

  if (critHighFindings.length > 0) {
    const uniqueTxtCveCount = new Set(critHighFindings.map((f) => f.id)).size;
    lines.push(`CRITICAL / HIGH FINDINGS (${critHighFindings.length} findings · ${uniqueTxtCveCount} unique CVE IDs)`);
    lines.push(`  ${'CVE ID'.padEnd(22)} ${'PACKAGE'.padEnd(18)} ${'INSTALLED'.padEnd(14)} ${'FIXED'.padEnd(14)} SEV`);
    lines.push(`  ${'-'.repeat(80)}`);
    for (const f of critHighFindings) {
      const fixed = f.fixed ?? 'no fix';
      lines.push(
        `  ${f.id.padEnd(22)} ${f.pkg.padEnd(18)} ${f.installed.padEnd(14)} ${fixed.padEnd(14)} ${f.severity}`,
      );
      if (f.title) lines.push(`    ${f.title}`);
      if (f.url)   lines.push(`    ${f.url}`);
    }
    lines.push('');
  }

  // Errors
  if (summary.reposWithErrors.length > 0) {
    lines.push('SCAN ERRORS');
    for (const e of summary.reposWithErrors) {
      lines.push(`  ${e.repo} (${e.branch}): ${e.errorMessage}`);
    }
    lines.push('');
  }

  lines.push(SEP);
  lines.push(`Generated at: ${summary.generatedAt}`);
  lines.push('sbom-sentinel  https://github.com/pbojeda/sbom-sentinel');
  lines.push(SEP);

  return lines.join('\n');
}

export function generateHtml(summary: GlobalSummary): string {
  const bannerClass = summary.hasCriticalOrHigh ? 'danger' : summary.hasErrors ? 'warning' : 'ok';
  const bannerText = summary.hasCriticalOrHigh
    ? `Critical or high vulnerabilities detected — immediate attention required.`
    : summary.hasErrors
    ? `Some repositories could not be scanned. Review errors below.`
    : `All repositories scanned successfully. No critical or high vulnerabilities found.`;

  const badges = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const)
    .map((s) => `<span class="badge ${s.toLowerCase()}">${s}: ${summary.totals[s]}</span>`)
    .join('\n      ');

  const repoRows = summary.repositories
    .map((r) => {
      const c = r.counts;
      const status = r.error
        ? `<span class="status-error">ERROR</span>`
        : `<span class="status-ok">OK</span>`;
      return `
  <tr>
    <td><code>${esc(r.repo)}</code></td>
    <td class="sev-CRITICAL">${c.CRITICAL === 0 ? '-' : c.CRITICAL}</td>
    <td class="sev-HIGH">${c.HIGH === 0 ? '-' : c.HIGH}</td>
    <td>${status}</td>
    <td>${esc(r.branch)}</td>
    <td><code title="${esc(r.commitSha)}">${esc(r.commitSha.slice(0, 7))}</code></td>
    <td class="sev-MEDIUM">${c.MEDIUM === 0 ? '-' : c.MEDIUM}</td>
    <td class="sev-LOW">${c.LOW === 0 ? '-' : c.LOW}</td>
  </tr>`;
    })
    .join('');

  const errorsSection =
    summary.reposWithErrors.length === 0
      ? ''
      : `
    <h2>Scan Errors</h2>
    ${summary.reposWithErrors
      .map(
        (e) => `
    <div class="error-box">
      <strong>${esc(e.repo)}</strong> (${esc(e.branch)})<br>
      <code>${esc(e.errorMessage)}</code>
    </div>`,
      )
      .join('')}`;

  const allCritHighFindings: Array<Finding & { repoName: string }> =
    summary.reposWithIssues.flatMap((r) =>
      r.findings
        .filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
        .map((f) => ({ ...f, repoName: r.repo })),
    );

  const uniqueCritHighCveCount = new Set(allCritHighFindings.map((f) => f.id)).size;

  const blastRadius = (() => {
    const affected = summary.reposWithIssues.length;
    const total    = summary.repositories.length;
    const errors   = summary.reposWithErrors.length;
    const parts: string[] = [];
    if (affected > 0) parts.push(`${affected} of ${total} ${total === 1 ? 'repository' : 'repositories'} affected`);
    if (errors > 0)   parts.push(`${errors} scan ${errors === 1 ? 'error' : 'errors'}`);
    return parts.length > 0 ? parts.join(' · ') : '';
  })();

  const findingsSection =
    allCritHighFindings.length === 0
      ? ''
      : `
    <h2>Critical / High Findings <span class="findings-meta">${allCritHighFindings.length} findings · ${uniqueCritHighCveCount} unique CVE IDs</span></h2>
    <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>CVE ID</th><th>Package</th><th>Installed</th><th>Fixed</th>
          <th>Severity</th><th>Repository</th><th>Description</th>
        </tr>
      </thead>
      <tbody>
        ${allCritHighFindings
          .map(
            (f) => `
        <tr>
          <td><a href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener">${esc(f.id)}</a></td>
          <td><code>${esc(f.pkg)}</code></td>
          <td><code>${esc(f.installed)}</code></td>
          <td>${f.fixed ? `<code>${esc(f.fixed)}</code>` : '<em>no fix</em>'}</td>
          <td class="sev-${f.severity}">${f.severity}</td>
          <td><code>${esc(f.repoName)}</code></td>
          <td>${esc(f.title)}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SBOM Sentinel Report — ${esc(summary.date)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;color:#111827;padding:24px}
    .container{max-width:1000px;margin:0 auto}
    h1{font-size:22px;font-weight:700;margin-bottom:4px}
    h2{font-size:16px;font-weight:600;margin:28px 0 10px}
    .subtitle{color:#6b7280;font-size:14px}
    .banner{padding:14px 18px;border-radius:8px;margin:18px 0;font-weight:600;font-size:14px}
    .banner.danger{background:#fef2f2;color:#dc2626;border:1px solid #fca5a5}
    .banner.warning{background:#fffbeb;color:#d97706;border:1px solid #fcd34d}
    .banner.ok{background:#f0fdf4;color:#16a34a;border:1px solid #86efac}
    .badges{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
    .badge{padding:6px 14px;border-radius:6px;font-weight:700;font-size:13px}
    .badge.critical{background:#fef2f2;color:#dc2626;border:1px solid #fca5a5}
    .badge.high{background:#fff7ed;color:#ea580c;border:1px solid #fdba74}
    .badge.medium{background:#fefce8;color:#ca8a04;border:1px solid #fde047}
    .badge.low{background:#eff6ff;color:#2563eb;border:1px solid #93c5fd}
    .findings-meta{font-weight:400;color:#6b7280;font-size:13px;margin-left:8px}
    .blast-radius{font-size:13px;color:#374151;margin:-8px 0 14px}
    .table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:8px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{background:#f3f4f6;text-align:left;padding:8px 10px;font-weight:600;border-bottom:2px solid #e5e7eb}
    td{padding:7px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top}
    .sev-CRITICAL{color:#dc2626;font-weight:700}
    .sev-HIGH{color:#ea580c;font-weight:700}
    .sev-MEDIUM{color:#ca8a04}
    .sev-LOW{color:#2563eb}
    .sev-UNKNOWN{color:#6b7280}
    .status-ok{color:#16a34a;font-weight:700}
    .status-error{color:#dc2626;font-weight:700}
    a{color:#2563eb;text-decoration:none}
    a:hover{text-decoration:underline}
    code{font-family:ui-monospace,monospace;font-size:12px;background:#f3f4f6;padding:1px 5px;border-radius:3px}
    .error-box{background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:10px 14px;margin:6px 0;font-size:13px}
    footer{margin-top:36px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:14px}
    @media(prefers-color-scheme:dark){
      body{background:#111827;color:#f9fafb}
      th{background:#1f2937;border-bottom-color:#374151}
      td{border-bottom-color:#374151}
      code{background:#1f2937}
      .banner.ok{background:#052e16;color:#4ade80;border-color:#166534}
      .banner.danger{background:#450a0a;color:#f87171;border-color:#991b1b}
      .banner.warning{background:#451a03;color:#fbbf24;border-color:#92400e}
      .error-box{background:#450a0a;border-color:#991b1b}
      .badge.critical{background:#450a0a;color:#f87171;border-color:#991b1b}
      .badge.high{background:#431407;color:#fb923c;border-color:#9a3412}
      .badge.medium{background:#422006;color:#fbbf24;border-color:#92400e}
      .badge.low{background:#1e3a5f;color:#93c5fd;border-color:#1d4ed8}
      .sev-CRITICAL{color:#f87171}
      .sev-HIGH{color:#fb923c}
      .sev-MEDIUM{color:#fbbf24}
      .sev-LOW{color:#93c5fd}
      .subtitle{color:#9ca3af}
      .findings-meta{color:#9ca3af}
      footer{color:#9ca3af;border-top-color:#374151}
      a{color:#60a5fa}
      .blast-radius{color:#d1d5db}
      .status-ok{color:#4ade80}
      .status-error{color:#f87171}
    }
  </style>
</head>
<body>
<div class="container">
  <header>
    <h1>SBOM Sentinel</h1>
    <p class="subtitle">Vulnerability report — ${esc(summary.date)}</p>
  </header>

  <div class="banner ${bannerClass}">${bannerText}</div>
  ${blastRadius ? `<p class="blast-radius">${esc(blastRadius)}</p>` : ''}
  <div class="badges">
    ${badges}
  </div>

  <h2>Repositories (${summary.repositories.length})</h2>
  <div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Repository</th><th>CRITICAL</th><th>HIGH</th><th>Status</th>
        <th>Branch</th><th>Commit</th><th>MEDIUM</th><th>LOW</th>
      </tr>
    </thead>
    <tbody>${repoRows}
    </tbody>
  </table>
  </div>
  ${errorsSection}
  ${findingsSection}

  <footer>
    Generated at ${esc(summary.generatedAt)} &middot;
    <a href="https://github.com/pbojeda/sbom-sentinel" target="_blank" rel="noopener">sbom-sentinel</a>
  </footer>
</div>
</body>
</html>`;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function countBySeverity(findings: Finding[]): SeverityCounts {
  const counts: SeverityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

/** Escapes HTML special characters to prevent XSS in generated reports. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Validates URL scheme (http/https only) to block javascript: and data: injection. */
function safeUrl(url: string): string {
  const u = url.trim();
  return u.startsWith('http://') || u.startsWith('https://') ? u : '#';
}
