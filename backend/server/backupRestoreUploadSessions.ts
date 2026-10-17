import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_CHUNKS = 8192;
/** Preferred raw chunk size for clients (JSON/base64 over HTTP — avoids Render multipart HTTP/2 resets). */
export const RESTORE_UPLOAD_CHUNK_SIZE = 256 * 1024;

export type RestoreUploadSession = {
  id: string;
  token: string;
  fileName: string;
  totalChunks: number;
  totalBytes: number;
  received: Set<number>;
  dir: string;
  createdBy: string;
  createdAt: number;
};

type SessionDiskMeta = {
  id: string;
  token: string;
  fileName: string;
  totalChunks: number;
  totalBytes: number;
  received: number[];
  createdBy: string;
  createdAt: number;
};

const sessions = new Map<string, RestoreUploadSession>();

function pruneExpired(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) {
      cleanupSessionFiles(session);
      sessions.delete(id);
    }
  }
  // Also prune abandoned session dirs on disk.
  try {
    const root = getBackupIncomingDir();
    for (const name of fs.readdirSync(root)) {
      if (!name.startsWith('session-')) continue;
      const dir = path.join(root, name);
      const metaPath = path.join(dir, 'session.json');
      try {
        if (!fs.existsSync(metaPath)) {
          const st = fs.statSync(dir);
          if (Date.now() - st.mtimeMs > SESSION_TTL_MS) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
          continue;
        }
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SessionDiskMeta;
        if (!meta.createdAt || meta.createdAt < cutoff) {
          fs.rmSync(dir, { recursive: true, force: true });
          sessions.delete(meta.id);
        }
      } catch {
        /* ignore corrupt session dirs */
      }
    }
  } catch {
    /* ignore */
  }
}

function cleanupSessionFiles(session: RestoreUploadSession): void {
  try {
    if (fs.existsSync(session.dir)) {
      fs.rmSync(session.dir, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
}

export function getBackupIncomingDir(): string {
  const dir = path.join('uploads', 'backup-incoming');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function metaPathFor(dir: string): string {
  return path.join(dir, 'session.json');
}

function persistSession(session: RestoreUploadSession): void {
  const meta: SessionDiskMeta = {
    id: session.id,
    token: session.token,
    fileName: session.fileName,
    totalChunks: session.totalChunks,
    totalBytes: session.totalBytes,
    received: [...session.received].sort((a, b) => a - b),
    createdBy: session.createdBy,
    createdAt: session.createdAt,
  };
  fs.writeFileSync(metaPathFor(session.dir), JSON.stringify(meta), 'utf8');
}

function loadSessionFromDisk(id: string): RestoreUploadSession | undefined {
  const dir = path.join(getBackupIncomingDir(), `session-${id}`);
  const metaPath = metaPathFor(dir);
  if (!fs.existsSync(metaPath)) return undefined;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SessionDiskMeta;
    if (meta.id !== id) return undefined;
    if (!meta.createdAt || Date.now() - meta.createdAt > SESSION_TTL_MS) {
      fs.rmSync(dir, { recursive: true, force: true });
      return undefined;
    }
    const session: RestoreUploadSession = {
      id: meta.id,
      token: meta.token,
      fileName: meta.fileName,
      totalChunks: meta.totalChunks,
      totalBytes: meta.totalBytes,
      received: new Set(Array.isArray(meta.received) ? meta.received : []),
      dir,
      createdBy: meta.createdBy,
      createdAt: meta.createdAt,
    };
    sessions.set(id, session);
    return session;
  } catch {
    return undefined;
  }
}

export function createRestoreUploadSession(input: {
  fileName: string;
  totalChunks: number;
  totalBytes: number;
  createdBy: string;
}): RestoreUploadSession {
  pruneExpired();

  const fileName = String(input.fileName || 'upload.sql').trim() || 'upload.sql';
  if (!/\.sql$/i.test(fileName)) {
    throw Object.assign(new Error('Only .sql backup files are allowed'), { status: 400 });
  }
  const totalChunks = Math.floor(Number(input.totalChunks));
  const totalBytes = Math.floor(Number(input.totalBytes));
  if (!Number.isFinite(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS) {
    throw Object.assign(new Error(`totalChunks must be between 1 and ${MAX_CHUNKS}`), {
      status: 400,
    });
  }
  if (!Number.isFinite(totalBytes) || totalBytes < 64 || totalBytes > MAX_TOTAL_BYTES) {
    throw Object.assign(
      new Error(`Backup must be between 64 bytes and ${MAX_TOTAL_BYTES} bytes`),
      { status: 400 }
    );
  }

  const id = randomUUID();
  const dir = path.join(getBackupIncomingDir(), `session-${id}`);
  fs.mkdirSync(dir, { recursive: true });

  const session: RestoreUploadSession = {
    id,
    token: randomBytes(24).toString('hex'),
    fileName,
    totalChunks,
    totalBytes,
    received: new Set(),
    dir,
    createdBy: String(input.createdBy),
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  persistSession(session);
  return session;
}

export function getRestoreUploadSession(id: string): RestoreUploadSession | undefined {
  pruneExpired();
  return sessions.get(id) ?? loadSessionFromDisk(id);
}

export function isValidRestoreUploadToken(id: string, token: string): boolean {
  const session = getRestoreUploadSession(id);
  return Boolean(session && token && session.token === token);
}

export function saveRestoreUploadChunk(
  session: RestoreUploadSession,
  chunkIndex: number,
  data: Buffer
): { received: number; totalChunks: number } {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
    throw Object.assign(new Error('Invalid chunk index'), { status: 400 });
  }
  if (!data?.length) {
    throw Object.assign(new Error('Empty chunk'), { status: 400 });
  }
  // Hard cap per chunk (JSON/base64 or legacy multipart).
  if (data.length > 1024 * 1024) {
    throw Object.assign(new Error('Chunk exceeds the 1 MB limit'), { status: 413 });
  }

  const chunkPath = path.join(session.dir, `chunk-${String(chunkIndex).padStart(5, '0')}`);
  fs.writeFileSync(chunkPath, data);
  session.received.add(chunkIndex);
  persistSession(session);
  return { received: session.received.size, totalChunks: session.totalChunks };
}

/** Assemble received chunks into a single .sql file on disk. */
export function assembleRestoreUploadSession(session: RestoreUploadSession): string {
  if (session.received.size !== session.totalChunks) {
    throw Object.assign(
      new Error(
        `Incomplete upload: ${session.received.size}/${session.totalChunks} chunks received`
      ),
      { status: 400 }
    );
  }

  const safeBase = session.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const withExt = /\.sql$/i.test(safeBase) ? safeBase : `${safeBase}.sql`;
  const outPath = path.resolve(getBackupIncomingDir(), `restore-${Date.now()}-${withExt}`);

  const fd = fs.openSync(outPath, 'w');
  let total = 0;
  try {
    for (let i = 0; i < session.totalChunks; i += 1) {
      const chunkPath = path.join(session.dir, `chunk-${String(i).padStart(5, '0')}`);
      if (!fs.existsSync(chunkPath)) {
        throw Object.assign(new Error(`Missing chunk file ${i}`), { status: 400 });
      }
      const buf = fs.readFileSync(chunkPath);
      fs.writeSync(fd, buf);
      total += buf.length;
    }
  } finally {
    fs.closeSync(fd);
  }
  if (total < 64) {
    try {
      fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
    throw Object.assign(new Error('Assembled backup is empty or too small'), { status: 400 });
  }
  if (session.totalBytes > 0) {
    const drift = Math.abs(total - session.totalBytes);
    if (drift > Math.max(1024, session.totalBytes * 0.01)) {
      try {
        fs.unlinkSync(outPath);
      } catch {
        /* ignore */
      }
      throw Object.assign(
        new Error(
          `Assembled size ${total} bytes does not match declared ${session.totalBytes} bytes`
        ),
        { status: 400 }
      );
    }
  }

  return outPath;
}

export function destroyRestoreUploadSession(id: string): void {
  const session = sessions.get(id) ?? loadSessionFromDisk(id);
  if (!session) return;
  cleanupSessionFiles(session);
  sessions.delete(id);
}

/** Decode a chunk from JSON body (`chunkBase64`) or legacy multipart file buffer. */
export function decodeRestoreUploadChunkBody(input: {
  body?: unknown;
  fileBuffer?: Buffer;
}): Buffer {
  if (input.fileBuffer?.length) return input.fileBuffer;
  const body = input.body as { chunkBase64?: unknown; data?: unknown } | undefined;
  const b64 = String(body?.chunkBase64 ?? body?.data ?? '').trim();
  if (!b64) {
    throw Object.assign(new Error('No chunk data uploaded'), { status: 400 });
  }
  try {
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) {
      throw new Error('empty');
    }
    return buf;
  } catch {
    throw Object.assign(new Error('Invalid chunkBase64 payload'), { status: 400 });
  }
}
