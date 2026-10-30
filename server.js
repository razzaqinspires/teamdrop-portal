import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = Number(process.env.PORT || 3000);
const APP_NAME = process.env.APP_NAME || 'TEAMDROP';
const APP_TAGLINE = process.env.APP_TAGLINE || 'Private Team Workspace';
const MAX_FILE_MB = Math.max(1, Math.min(Number(process.env.MAX_FILE_MB || 50), 100));
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const RETENTION_DAYS = Math.max(1, Number(process.env.RETENTION_DAYS || 14));
const UPLOAD_DIR = path.resolve(__dirname, process.env.UPLOAD_DIR || './uploads');
const DATA_DIR = path.resolve(__dirname, process.env.DATA_DIR || './data');
const DB_FILE = path.join(DATA_DIR, 'submissions.json');

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
  '.odt', '.ods', '.odp'
]);
const MIME_BY_EXTENSION = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword', 'application/octet-stream'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'],
  '.xls': ['application/vnd.ms-excel', 'application/octet-stream'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
  '.ppt': ['application/vnd.ms-powerpoint', 'application/octet-stream'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/octet-stream'],
  '.txt': ['text/plain', 'application/octet-stream'],
  '.csv': ['text/csv', 'application/csv', 'application/octet-stream'],
  '.odt': ['application/vnd.oasis.opendocument.text', 'application/octet-stream'],
  '.ods': ['application/vnd.oasis.opendocument.spreadsheet', 'application/octet-stream'],
  '.odp': ['application/vnd.oasis.opendocument.presentation', 'application/octet-stream']
};

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", 'data:'],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '1h' }));

await fs.mkdir(UPLOAD_DIR, { recursive: true });
await fs.mkdir(DATA_DIR, { recursive: true });

let submissions = [];
try {
  const raw = await fs.readFile(DB_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  submissions = Array.isArray(parsed) ? parsed : [];
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error('Could not read submissions database:', error.message);
    throw error;
  }
  await fs.writeFile(DB_FILE, '[]\n', 'utf8');
}

let saveQueue = Promise.resolve();
function persistSubmissions() {
  saveQueue = saveQueue.then(async () => {
    const tempFile = `${DB_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify(submissions, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tempFile, DB_FILE);
  });
  return saveQueue;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

function cleanText(value, maxLength = 250) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function sessionSignature(payload) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'missing-session-secret')
    .update(payload).digest('base64url');
}

function createAdminCookie() {
  const payload = Buffer.from(JSON.stringify({
    username: process.env.ADMIN_USERNAME || 'admin',
    expiresAt: Date.now() + 12 * 60 * 60 * 1000
  })).toString('base64url');
  return `${payload}.${sessionSignature(payload)}`;
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    const key = part.slice(0, index).trim();
    const rawValue = part.slice(index + 1).trim();
    let value = rawValue;
    try { value = decodeURIComponent(rawValue); } catch { value = ''; }
    return [key, value];
  }).filter(([key]) => key));
}

function isAdmin(req) {
  const token = parseCookies(req.headers.cookie).portal_session;
  if (!token || !process.env.SESSION_SECRET) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = sessionSignature(payload);
  if (!safeEqual(signature, expected)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.username === (process.env.ADMIN_USERNAME || 'admin') && session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Sesi admin tidak valid. Silakan masuk kembali.' });
  next();
}

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 18,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan unggah. Coba lagi beberapa saat.' }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan masuk. Coba lagi 15 menit lagi.' }
});

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
  filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`)
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 8, fieldSize: 3000 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowedMimes = MIME_BY_EXTENSION[extension];
    if (!ALLOWED_EXTENSIONS.has(extension) || !allowedMimes) {
      return callback(new Error('Format file tidak didukung. Gunakan PDF, Word, Excel, PowerPoint, TXT, CSV, atau OpenDocument.'));
    }
    if (!allowedMimes.includes(file.mimetype)) {
      return callback(new Error('Tipe file tidak cocok dengan ekstensi file.'));
    }
    callback(null, true);
  }
});

async function sendWhatsAppDocument({ filePath, filename, mimetype, caption, eventId }) {
  const endpoint = String(process.env.WHISKAY_BOT_WEBHOOK_URL || '').trim();
  const token = String(process.env.WHISKAY_BOT_WEBHOOK_TOKEN || '').trim();
  if (!endpoint || !token) {
    return { status: 'not_configured', error: 'Webhook Whiskay Bot belum dikonfigurasi.' };
  }
  let url;
  try { url = new URL(endpoint); }
  catch { return { status: 'not_configured', error: 'WHISKAY_BOT_WEBHOOK_URL tidak valid.' }; }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { status: 'not_configured', error: 'Endpoint Whiskay Bot harus menggunakan HTTP atau HTTPS.' };
  }

  const fileBuffer = await fs.readFile(filePath);
  const encoded = value => Buffer.from(String(value || ''), 'utf8').toString('base64url');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': mimetype || 'application/octet-stream',
      'Content-Length': String(fileBuffer.length),
      'X-Teamdrop-Id': String(eventId || crypto.randomUUID()),
      'X-Teamdrop-Filename': encoded(filename),
      'X-Teamdrop-Mimetype': mimetype || 'application/octet-stream',
      'X-Teamdrop-Caption': encoded(caption)
    },
    body: fileBuffer,
    signal: AbortSignal.timeout(90_000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const messages = {
      unauthorized: 'Token webhook Whiskay Bot tidak cocok.',
      teamdrop_not_configured: 'TEAMDROP_WEBHOOK_SECRET belum diatur pada Whiskay Bot.',
      whatsapp_not_ready: 'WhatsApp Whiskay Bot sedang offline atau belum tersambung.',
      whatsapp_recipient_not_configured: 'Nomor tujuan WhatsApp belum dikonfigurasi pada Whiskay Bot.',
      unsupported_document_type: 'Format dokumen ditolak oleh Whiskay Bot.',
      file_too_large: 'Ukuran dokumen melewati batas Whiskay Bot.',
      rate_limited: 'Batas pengiriman webhook tercapai. Coba kembali beberapa saat lagi.',
      whatsapp_send_failed: 'Whiskay Bot gagal mengirim dokumen ke WhatsApp.'
    };
    return {
      status: 'failed',
      error: messages[result.error] || `Webhook Whiskay Bot gagal (HTTP ${response.status}).`
    };
  }
  return { status: 'sent', messageId: result.messageId || null, duplicate: Boolean(result.duplicate) };
}

async function cleanupExpiredFiles() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const keep = [];
  let changed = false;
  for (const item of submissions) {
    const created = new Date(item.createdAt).getTime();
    if (Number.isFinite(created) && created < cutoff) {
      await fs.unlink(path.join(UPLOAD_DIR, item.storedName)).catch(() => {});
      changed = true;
    } else {
      keep.push(item);
    }
  }
  if (changed) {
    submissions = keep;
    await persistSubmissions();
  }
}
await cleanupExpiredFiles();
const retentionCleanup = setInterval(() => {
  cleanupExpiredFiles().catch((error) => console.error('Retention cleanup error:', error.message));
}, 6 * 60 * 60 * 1000);
retentionCleanup.unref();

app.get('/api/config', (_req, res) => {
  res.json({ appName: APP_NAME, tagline: APP_TAGLINE, maxFileMb: MAX_FILE_MB });
});

app.post('/api/upload', uploadLimiter, upload.single('file'), async (req, res, next) => {
  const file = req.file;
  try {
    if (!file) return res.status(400).json({ error: 'Pilih file dokumen terlebih dahulu.' });
    const accessCode = cleanText(req.body.accessCode, 200);
    if (!safeEqual(accessCode, process.env.TEAM_UPLOAD_CODE || '')) {
      await fs.unlink(file.path).catch(() => {});
      return res.status(403).json({ error: 'Kode akses tim salah.' });
    }

    const senderName = cleanText(req.body.senderName, 80);
    const teamName = cleanText(req.body.teamName, 80);
    const note = cleanText(req.body.note, 500);
    if (!senderName || !teamName) {
      await fs.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: 'Nama pengirim dan nama tim wajib diisi.' });
    }

    const originalName = path.basename(file.originalname).slice(0, 180);
    const extension = path.extname(originalName).toLowerCase();
    const safeFilename = `${cleanText(path.basename(originalName, extension), 100).replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'dokumen'}${extension}`;
    const entry = {
      id: crypto.randomUUID(),
      storedName: file.filename,
      originalName,
      whatsappFilename: safeFilename,
      mimetype: file.mimetype,
      size: file.size,
      senderName,
      teamName,
      note,
      createdAt: new Date().toISOString(),
      whatsappStatus: 'pending',
      whatsappMessageId: null,
      whatsappError: null
    };
    submissions.unshift(entry);
    await persistSubmissions();

    const caption = [
      `Dokumen baru dari ${teamName}`,
      `Pengirim: ${senderName}`,
      note ? `Catatan: ${note}` : null,
      `ID: ${entry.id.slice(0, 8)}`
    ].filter(Boolean).join('\n');

    try {
      const result = await sendWhatsAppDocument({
        filePath: file.path,
        filename: safeFilename,
        mimetype: file.mimetype,
        caption,
        eventId: entry.id
      });
      entry.whatsappStatus = result.status;
      entry.whatsappMessageId = result.messageId || null;
      entry.whatsappError = result.error || null;
      await persistSubmissions();
    } catch (error) {
      entry.whatsappStatus = 'failed';
      entry.whatsappError = cleanText(error.message || 'Kesalahan saat meneruskan dokumen.', 500);
      await persistSubmissions();
      console.error('WhatsApp forwarding error:', error.message);
    }

    const statusMessage = entry.whatsappStatus === 'sent'
      ? 'Dokumen berhasil diterima dan diteruskan ke WhatsApp.'
      : entry.whatsappStatus === 'not_configured'
        ? 'Dokumen tersimpan. Pengiriman WhatsApp belum dikonfigurasi; admin dapat mengelolanya dari dashboard.'
        : 'Dokumen tersimpan, tetapi penerusan WhatsApp belum berhasil. Admin dapat memeriksa dan mencoba kembali.';

    return res.status(201).json({
      success: true,
      id: entry.id,
      filename: originalName,
      whatsappStatus: entry.whatsappStatus,
      message: statusMessage
    });
  } catch (error) {
    if (file?.path) await fs.unlink(file.path).catch(() => {});
    next(error);
  }
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const username = cleanText(req.body?.username, 80);
  const password = String(req.body?.password ?? '');
  const validUser = safeEqual(username, process.env.ADMIN_USERNAME || 'admin');
  const validPassword = safeEqual(password, process.env.ADMIN_PASSWORD || '');
  if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD || !process.env.TEAM_UPLOAD_CODE || !validUser || !validPassword) {
    return res.status(401).json({ error: 'Username atau password tidak sesuai, atau konfigurasi server belum lengkap.' });
  }
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `portal_session=${encodeURIComponent(createAdminCookie())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
  res.json({ success: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ authenticated: isAdmin(req), username: isAdmin(req) ? (process.env.ADMIN_USERNAME || 'admin') : null });
});

app.post('/api/admin/logout', requireAdmin, (_req, res) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `portal_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
  res.json({ success: true });
});

app.get('/api/admin/submissions', requireAdmin, (_req, res) => {
  const rows = submissions.map(({ storedName, ...item }) => ({
    ...item,
    sizeLabel: formatBytes(item.size)
  }));
  res.json({
    submissions: rows,
    stats: {
      total: submissions.length,
      sent: submissions.filter((item) => item.whatsappStatus === 'sent').length,
      pending: submissions.filter((item) => item.whatsappStatus === 'pending' || item.whatsappStatus === 'not_configured').length,
      failed: submissions.filter((item) => item.whatsappStatus === 'failed').length
    }
  });
});

app.get('/api/admin/submissions/:id/download', requireAdmin, async (req, res, next) => {
  try {
    const item = submissions.find((submission) => submission.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
    const filePath = path.join(UPLOAD_DIR, item.storedName);
    await fs.access(filePath);
    return res.download(filePath, item.originalName);
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'File sudah tidak tersedia.' });
    next(error);
  }
});

app.post('/api/admin/submissions/:id/retry', requireAdmin, async (req, res) => {
  const item = submissions.find((submission) => submission.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
  if (item.whatsappStatus === 'sent') return res.status(409).json({ error: 'Dokumen ini sudah berhasil dikirim.' });
  const filePath = path.join(UPLOAD_DIR, item.storedName);
  try {
    await fs.access(filePath);
    const caption = [
      `Dokumen dari ${item.teamName}`,
      `Pengirim: ${item.senderName}`,
      item.note ? `Catatan: ${item.note}` : null,
      `ID: ${item.id.slice(0, 8)}`
    ].filter(Boolean).join('\n');
    const result = await sendWhatsAppDocument({
      filePath,
      filename: item.whatsappFilename || item.originalName,
      mimetype: item.mimetype,
      caption,
      eventId: item.id
    });
    item.whatsappStatus = result.status;
    item.whatsappMessageId = result.messageId || null;
    item.whatsappError = result.error || null;
    await persistSubmissions();
    return res.json({ success: result.status === 'sent', status: result.status, error: result.error || null });
  } catch (error) {
    item.whatsappStatus = 'failed';
    item.whatsappError = cleanText(error.message, 500);
    await persistSubmissions();
    return res.status(500).json({ error: item.whatsappError });
  }
});

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Ukuran file melebihi batas ${MAX_FILE_MB} MB.`
      : 'Unggahan tidak dapat diproses.';
    return res.status(400).json({ error: message });
  }
  if (error.message?.includes('Format file') || error.message?.includes('Tipe file')) {
    return res.status(400).json({ error: error.message });
  }
  console.error('Server error:', error);
  return res.status(500).json({ error: 'Terjadi kesalahan pada server. Silakan coba kembali.' });
});

app.listen(PORT, () => {
  console.log(`\n${APP_NAME} running at http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
  console.log(`Upload limit: ${MAX_FILE_MB} MB | Retention: ${RETENTION_DAYS} days`);
  if (!process.env.WHISKAY_BOT_WEBHOOK_URL || !process.env.WHISKAY_BOT_WEBHOOK_TOKEN) {
    console.warn('Whiskay Bot forwarding is not configured. Uploaded files will be stored in the portal.');
  }
});
