// Configuration
export interface SentinelConfig {
  manufacturer?: string;
  outputDir?: string;
  notifications?: NotificationConfig;
  repos: RepoConfig[];
}

export interface NotificationConfig {
  onVulnerabilities?: boolean;
  onErrors?: boolean;
  slack?: { enabled?: boolean };
  email?: { enabled?: boolean };
}

export interface RepoConfig {
  name: string;
  cloneUrl: string;
  branch: string;
  type: 'node' | 'swift' | 'gradle' | 'python' | 'go' | 'rust';
  mode?: 'cdxgen' | 'command';
  path?: string;
  sbomCommand?: string;
  sbomOutput?: string;
  enabled?: boolean;
  private?: boolean;
  notes?: string;
}

// Results
export interface Finding {
  id: string;
  pkg: string;
  installed: string;
  fixed: string | null;
  severity: Severity;
  title: string;
  url: string;
  target: string;
  type: string;
}

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

export interface SeverityCounts {
  CRITICAL: number;
  HIGH: number;
  MEDIUM: number;
  LOW: number;
  UNKNOWN: number;
}

export interface RepoResult {
  repo: string;
  branch: string;
  commitSha: string;
  sbomFile: string | null;
  trivyFile: string | null;
  findings: Finding[];
  error: boolean;
  errorMessage?: string;
}

export interface GlobalSummary {
  generatedAt: string;
  date: string;
  totals: SeverityCounts;
  hasCriticalOrHigh: boolean;
  hasErrors: boolean;
  reposWithIssues: Array<{
    repo: string;
    branch: string;
    critical: number;
    high: number;
    findings: Finding[];
  }>;
  reposWithErrors: Array<{
    repo: string;
    branch: string;
    errorMessage: string;
  }>;
  repositories: RepoSummary[];
}

export interface RepoSummary {
  repo: string;
  branch: string;
  commitSha: string;
  counts: SeverityCounts;
  error: boolean;
  findingsCount: number;
}
