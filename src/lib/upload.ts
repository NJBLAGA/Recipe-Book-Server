import multer from 'multer';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

const JPEG_MAGIC  = [0xFF, 0xD8, 0xFF];
const PNG_MAGIC   = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const GIF_MAGIC   = [0x47, 0x49, 0x46, 0x38];
const RIFF_MAGIC  = [0x52, 0x49, 0x46, 0x46];
const WEBP_MAGIC  = [0x57, 0x45, 0x42, 0x50];

function startsWith(buf: Buffer, bytes: number[]): boolean {
  return bytes.every((b, i) => buf[i] === b);
}

export function validateImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (startsWith(buffer, JPEG_MAGIC)) return true;
  if (startsWith(buffer, PNG_MAGIC))  return true;
  if (startsWith(buffer, GIF_MAGIC))  return true;
  if (startsWith(buffer, RIFF_MAGIC) &&
      buffer[8] === WEBP_MAGIC[0] && buffer[9] === WEBP_MAGIC[1] &&
      buffer[10] === WEBP_MAGIC[2] && buffer[11] === WEBP_MAGIC[3]) return true;
  return false;
}
