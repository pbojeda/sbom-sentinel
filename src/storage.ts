import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { warn, err, ok, dim } from './logger.js';
import type { ReportFiles } from './report.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface StorageConfig {
  provider: 'ibm-cos' | 'google-drive';
  // IBM COS — HMAC credentials (S3-compatible API)
  endpoint?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  /** Separate public base URL for the uploaded files (e.g. static website endpoint).
   *  Defaults to `endpoint` when not set. */
  publicBaseUrl?: string;
  // Google Drive — service account
  /** Path to a service-account.json file, or the JSON content as an inline string. */
  credentials?: string;
  /** Google Drive folder ID for the uploaded files. Defaults to the service account's root drive. */
  folderId?: string;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Uploads the HTML and JSON summary reports to the configured storage provider.
 * Returns the public URL of the HTML report, or undefined if upload fails or is
 * not configured. Never throws — failures are logged so the runner can still
 * notify and exit with the correct code.
 */
export async function uploadReports(
  reports: ReportFiles,
  config: StorageConfig,
): Promise<string | undefined> {
  try {
    if (config.provider === 'ibm-cos')     return await uploadToIbmCos(reports, config);
    if (config.provider === 'google-drive') return await uploadToGoogleDrive(reports, config);
  } catch (e) {
    err(`Storage upload failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return undefined;
}

// ── IBM COS ───────────────────────────────────────────────────────────────────

// Minimal type stubs for the optional @aws-sdk/client-s3 dependency
type CosStream = ReturnType<typeof createReadStream>;
type PutInput = { Bucket?: string; Key?: string; Body?: CosStream; ContentType?: string };
type CosClientInstance = { send: (cmd: unknown) => Promise<void> };
type CosClientCtor = new (cfg: {
  endpoint?: string;
  region?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  forcePathStyle?: boolean;
}) => CosClientInstance;
type PutCommandCtor = new (input: PutInput) => unknown;

async function uploadToIbmCos(
  reports: ReportFiles,
  config: StorageConfig,
): Promise<string | undefined> {
  let S3Client: CosClientCtor;
  let PutObjectCommand: PutCommandCtor;

  try {
    const mod = await import('@aws-sdk/client-s3') as {
      S3Client: CosClientCtor;
      PutObjectCommand: PutCommandCtor;
    };
    S3Client = mod.S3Client;
    PutObjectCommand = mod.PutObjectCommand;
  } catch {
    warn('IBM COS storage requires @aws-sdk/client-s3. Install it with: npm install @aws-sdk/client-s3');
    return undefined;
  }

  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region ?? 'us-south',
    credentials: {
      accessKeyId: config.accessKeyId!,
      secretAccessKey: config.secretAccessKey!,
    },
    forcePathStyle: true,
  });

  const htmlKey = `reports/${basename(reports.html)}`;
  const jsonKey = `reports/${basename(reports.json)}`;

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: htmlKey,
    Body: createReadStream(reports.html),
    ContentType: 'text/html',
  }));
  dim(`  COS: uploaded ${basename(reports.html)}`);

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: jsonKey,
    Body: createReadStream(reports.json),
    ContentType: 'application/json',
  }));
  dim(`  COS: uploaded ${basename(reports.json)}`);

  // When publicBaseUrl is set it uses virtual-hosted style (bucket name is in the domain),
  // so the key path must NOT include the bucket prefix.
  // When falling back to the endpoint, path-style is used and the bucket must be in the path.
  // Use || (not ??) so that an empty-string env var falls through to endpoint
  const base = (config.publicBaseUrl || config.endpoint || '').replace(/\/$/, '');
  const url = config.publicBaseUrl
    ? `${base}/${htmlKey}`
    : `${base}/${config.bucket}/${htmlKey}`;
  ok(`Report uploaded to IBM COS: ${url}`);
  return url;
}

// ── Google Drive ──────────────────────────────────────────────────────────────

// Minimal type stubs for the optional googleapis dependency
type DriveStream = ReturnType<typeof createReadStream>;
type DriveFileData = { id?: string | null; webViewLink?: string | null };
type DriveCreateOpts = {
  requestBody?: Record<string, unknown>;
  media?: { mimeType?: string; body?: DriveStream };
  fields?: string;
};
type DrivePermissionOpts = { fileId?: string; requestBody?: Record<string, unknown> };
type DriveClientInstance = {
  files:       { create: (opts: DriveCreateOpts) => Promise<{ data: DriveFileData }> };
  permissions: { create: (opts: DrivePermissionOpts) => Promise<unknown> };
};
type GoogleAuthCtor = new (opts: {
  credentials?: Record<string, unknown>;
  keyFile?: string;
  scopes?: string[];
}) => unknown;
type GoogleModule = {
  auth:  { GoogleAuth: GoogleAuthCtor };
  drive: (opts: { version: string; auth: unknown }) => DriveClientInstance;
};

async function uploadToGoogleDrive(
  reports: ReportFiles,
  config: StorageConfig,
): Promise<string | undefined> {
  let google: GoogleModule;

  try {
    const mod = await import('googleapis') as { google: GoogleModule };
    google = mod.google;
  } catch {
    warn('Google Drive storage requires googleapis. Install it with: npm install googleapis');
    return undefined;
  }

  // credentials: inline JSON string (starts with '{') or path to a service-account.json file
  const credStr = config.credentials ?? '';
  const authOpts = credStr.trimStart().startsWith('{')
    ? { credentials: JSON.parse(credStr) as Record<string, unknown> }
    : { keyFile: credStr };

  const auth = new google.auth.GoogleAuth({
    ...authOpts,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  const drive = google.drive({ version: 'v3', auth });

  // Upload HTML report — primary file; the URL we return
  const htmlRes = await drive.files.create({
    requestBody: {
      name: basename(reports.html),
      mimeType: 'text/html',
      ...(config.folderId ? { parents: [config.folderId] } : {}),
    },
    media: { mimeType: 'text/html', body: createReadStream(reports.html) },
    fields: 'id, webViewLink',
  });

  const fileId = htmlRes.data.id;
  if (!fileId) {
    err('Google Drive upload returned no file ID.');
    return undefined;
  }

  // Make the HTML report publicly readable
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });
  dim(`  Drive: uploaded ${basename(reports.html)}`);

  // Upload JSON report — best-effort; failure does not block returning the HTML URL
  try {
    await drive.files.create({
      requestBody: {
        name: basename(reports.json),
        mimeType: 'application/json',
        ...(config.folderId ? { parents: [config.folderId] } : {}),
      },
      media: { mimeType: 'application/json', body: createReadStream(reports.json) },
      fields: 'id',
    });
    dim(`  Drive: uploaded ${basename(reports.json)}`);
  } catch (e) {
    warn(`Google Drive: JSON upload failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const url = htmlRes.data.webViewLink ?? undefined;
  if (url) ok(`Report uploaded to Google Drive: ${url}`);
  return url;
}
