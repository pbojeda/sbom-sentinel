import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadReports } from '../../src/storage.js';
import type { StorageConfig } from '../../src/storage.js';
import type { ReportFiles } from '../../src/report.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../src/logger.js', () => ({
  ok:   vi.fn(),
  warn: vi.fn(),
  err:  vi.fn(),
  dim:  vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    createReadStream: vi.fn().mockReturnValue('mock-stream'),
  };
});

import { warn, err } from '../../src/logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const REPORTS: ReportFiles = {
  json: '/artifacts/reports/summary__2024-04-14.json',
  html: '/artifacts/reports/summary__2024-04-14.html',
  txt:  '/artifacts/reports/summary__2024-04-14.txt',
};

// ── IBM COS ───────────────────────────────────────────────────────────────────

describe('uploadReports — ibm-cos', () => {
  const mockSend = vi.fn().mockResolvedValue({});
  const MockS3Client = vi.fn().mockImplementation(() => ({ send: mockSend }));
  const MockPutObjectCommand = vi.fn().mockImplementation((input) => input);

  beforeEach(() => {
    vi.resetModules();
    mockSend.mockResolvedValue({});
    MockS3Client.mockClear();
    MockPutObjectCommand.mockClear();
    vi.mocked(warn).mockClear();
    vi.mocked(err).mockClear();
  });

  it('uploads HTML and JSON with correct ContentType', async () => {
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: MockS3Client,
      PutObjectCommand: MockPutObjectCommand,
    }));

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'ibm-cos',
      endpoint: 'https://s3.eu-de.cloud-object-storage.appdomain.cloud',
      bucket: 'my-bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    };

    await upload(REPORTS, config);

    expect(MockPutObjectCommand).toHaveBeenCalledTimes(2);
    const [htmlCall, jsonCall] = MockPutObjectCommand.mock.calls;
    expect(htmlCall[0]).toMatchObject({ Key: 'reports/summary__2024-04-14.html', ContentType: 'text/html' });
    expect(jsonCall[0]).toMatchObject({ Key: 'reports/summary__2024-04-14.json', ContentType: 'application/json' });
  });

  it('constructs URL from endpoint and bucket when publicBaseUrl is not set', async () => {
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: MockS3Client,
      PutObjectCommand: MockPutObjectCommand,
    }));

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'ibm-cos',
      endpoint: 'https://s3.eu-de.cloud-object-storage.appdomain.cloud',
      bucket: 'my-bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    };

    const url = await upload(REPORTS, config);
    expect(url).toBe(
      'https://s3.eu-de.cloud-object-storage.appdomain.cloud/my-bucket/reports/summary__2024-04-14.html',
    );
  });

  it('uses publicBaseUrl when set', async () => {
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: MockS3Client,
      PutObjectCommand: MockPutObjectCommand,
    }));

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'ibm-cos',
      endpoint: 'https://s3.eu-de.cloud-object-storage.appdomain.cloud',
      bucket: 'my-bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      publicBaseUrl: 'https://my-bucket.public.eu-de.cloud-object-storage.appdomain.cloud',
    };

    const url = await upload(REPORTS, config);
    expect(url).toBe(
      'https://my-bucket.public.eu-de.cloud-object-storage.appdomain.cloud/my-bucket/reports/summary__2024-04-14.html',
    );
  });

  it('strips trailing slash from base URL', async () => {
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: MockS3Client,
      PutObjectCommand: MockPutObjectCommand,
    }));

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'ibm-cos',
      endpoint: 'https://s3.eu-de.cloud-object-storage.appdomain.cloud/',
      bucket: 'my-bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    };

    const url = await upload(REPORTS, config);
    expect(url).not.toContain('//my-bucket');
  });

  it('initialises S3Client with forcePathStyle: true', async () => {
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: MockS3Client,
      PutObjectCommand: MockPutObjectCommand,
    }));

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'ibm-cos',
      endpoint: 'https://s3.eu-de.cloud-object-storage.appdomain.cloud',
      bucket: 'my-bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    };

    await upload(REPORTS, config);
    expect(MockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({ forcePathStyle: true }),
    );
  });

  it('returns undefined and warns when @aws-sdk/client-s3 is not installed', async () => {
    vi.doMock('@aws-sdk/client-s3', () => { throw new Error('Cannot find module'); });

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'ibm-cos',
      endpoint: 'https://s3.eu-de.cloud-object-storage.appdomain.cloud',
      bucket: 'my-bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    };

    const url = await upload(REPORTS, config);
    expect(url).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('@aws-sdk/client-s3'));
  });

  it('returns undefined and logs error when upload throws', async () => {
    mockSend.mockRejectedValueOnce(new Error('Access denied'));
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: MockS3Client,
      PutObjectCommand: MockPutObjectCommand,
    }));

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'ibm-cos',
      endpoint: 'https://s3.eu-de.cloud-object-storage.appdomain.cloud',
      bucket: 'my-bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    };

    const url = await upload(REPORTS, config);
    expect(url).toBeUndefined();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Access denied'));
  });
});

// ── Google Drive ──────────────────────────────────────────────────────────────

describe('uploadReports — google-drive', () => {
  const mockFilesCreate = vi.fn();
  const mockPermissionsCreate = vi.fn().mockResolvedValue({});
  const MockGoogleAuth = vi.fn().mockImplementation(() => ({}));

  const mockDrive = {
    files:       { create: mockFilesCreate },
    permissions: { create: mockPermissionsCreate },
  };

  const mockGoogle = {
    auth:  { GoogleAuth: MockGoogleAuth },
    drive: vi.fn().mockReturnValue(mockDrive),
  };

  beforeEach(() => {
    vi.resetModules();
    mockFilesCreate.mockReset();
    mockPermissionsCreate.mockResolvedValue({});
    MockGoogleAuth.mockClear();
    vi.mocked(warn).mockClear();
    vi.mocked(err).mockClear();
  });

  it('uploads HTML and sets public read permission', async () => {
    mockFilesCreate
      .mockResolvedValueOnce({ data: { id: 'file123', webViewLink: 'https://drive.google.com/file/d/file123/view' } })
      .mockResolvedValueOnce({ data: { id: 'file456' } });

    vi.doMock('googleapis', () => ({ google: mockGoogle }));

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'google-drive',
      credentials: '{"client_email":"sa@project.iam.gserviceaccount.com","private_key":"key"}',
    };

    const url = await upload(REPORTS, config);
    expect(url).toBe('https://drive.google.com/file/d/file123/view');
    expect(mockPermissionsCreate).toHaveBeenCalledWith({
      fileId: 'file123',
      requestBody: { role: 'reader', type: 'anyone' },
    });
  });

  it('requests fields: "id, webViewLink" on HTML upload', async () => {
    mockFilesCreate
      .mockResolvedValueOnce({ data: { id: 'file123', webViewLink: 'https://drive.google.com/file/d/file123/view' } })
      .mockResolvedValueOnce({ data: { id: 'file456' } });

    vi.doMock('googleapis', () => ({ google: mockGoogle }));

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'google-drive',
      credentials: '{"client_email":"sa@project.iam.gserviceaccount.com","private_key":"key"}',
    };

    await upload(REPORTS, config);
    const htmlCall = mockFilesCreate.mock.calls[0][0];
    expect(htmlCall.fields).toBe('id, webViewLink');
  });

  it('passes credentials as JSON when value starts with {', async () => {
    mockFilesCreate
      .mockResolvedValueOnce({ data: { id: 'file123', webViewLink: 'https://drive.google.com/file/d/file123/view' } })
      .mockResolvedValueOnce({ data: { id: 'file456' } });

    vi.doMock('googleapis', () => ({ google: mockGoogle }));

    const { uploadReports: upload } = await import('../../src/storage.js');
    const credsJson = '{"client_email":"sa@project.iam.gserviceaccount.com","private_key":"key"}';
    const config: StorageConfig = { provider: 'google-drive', credentials: credsJson };

    await upload(REPORTS, config);
    expect(MockGoogleAuth).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: JSON.parse(credsJson) }),
    );
  });

  it('passes credentials as keyFile when value is a file path', async () => {
    mockFilesCreate
      .mockResolvedValueOnce({ data: { id: 'file123', webViewLink: 'https://drive.google.com/file/d/file123/view' } })
      .mockResolvedValueOnce({ data: { id: 'file456' } });

    vi.doMock('googleapis', () => ({ google: mockGoogle }));

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'google-drive',
      credentials: '/secrets/service-account.json',
    };

    await upload(REPORTS, config);
    expect(MockGoogleAuth).toHaveBeenCalledWith(
      expect.objectContaining({ keyFile: '/secrets/service-account.json' }),
    );
  });

  it('passes folderId as parent when set', async () => {
    mockFilesCreate
      .mockResolvedValueOnce({ data: { id: 'file123', webViewLink: 'https://drive.google.com/file/d/file123/view' } })
      .mockResolvedValueOnce({ data: { id: 'file456' } });

    vi.doMock('googleapis', () => ({ google: mockGoogle }));

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'google-drive',
      credentials: '{"client_email":"sa@project.iam.gserviceaccount.com","private_key":"key"}',
      folderId: 'folder123',
    };

    await upload(REPORTS, config);
    const htmlCall = mockFilesCreate.mock.calls[0][0];
    expect(htmlCall.requestBody.parents).toEqual(['folder123']);
  });

  it('returns undefined and logs error when no file ID is returned', async () => {
    mockFilesCreate.mockResolvedValueOnce({ data: { id: null } });

    vi.doMock('googleapis', () => ({ google: mockGoogle }));

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'google-drive',
      credentials: '{"client_email":"sa@project.iam.gserviceaccount.com","private_key":"key"}',
    };

    const url = await upload(REPORTS, config);
    expect(url).toBeUndefined();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('file ID'));
  });

  it('returns the HTML URL even when JSON upload fails', async () => {
    mockFilesCreate
      .mockResolvedValueOnce({ data: { id: 'file123', webViewLink: 'https://drive.google.com/file/d/file123/view' } })
      .mockRejectedValueOnce(new Error('quota exceeded'));

    vi.doMock('googleapis', () => ({ google: mockGoogle }));

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'google-drive',
      credentials: '{"client_email":"sa@project.iam.gserviceaccount.com","private_key":"key"}',
    };

    const url = await upload(REPORTS, config);
    expect(url).toBe('https://drive.google.com/file/d/file123/view');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('JSON upload failed'));
  });

  it('returns undefined and warns when googleapis is not installed', async () => {
    vi.doMock('googleapis', () => { throw new Error('Cannot find module'); });

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'google-drive',
      credentials: '{"client_email":"sa@project.iam.gserviceaccount.com","private_key":"key"}',
    };

    const url = await upload(REPORTS, config);
    expect(url).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('googleapis'));
  });

  it('returns undefined and logs error when upload throws', async () => {
    mockFilesCreate.mockRejectedValueOnce(new Error('Auth failed'));

    vi.doMock('googleapis', () => ({ google: mockGoogle }));

    const { uploadReports: upload } = await import('../../src/storage.js');
    const config: StorageConfig = {
      provider: 'google-drive',
      credentials: '{"client_email":"sa@project.iam.gserviceaccount.com","private_key":"key"}',
    };

    const url = await upload(REPORTS, config);
    expect(url).toBeUndefined();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Auth failed'));
  });
});
