export const CLIENT_DOCUMENT_ACCEPT =
  'image/*,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.pdf,.doc,.docx,application/pdf';

const GENERIC_MIME = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

export function isUnknownMimeType(type?: string | null): boolean {
  return GENERIC_MIME.has((type || '').toLowerCase().trim());
}

export function inferDocumentContentType(file: { name: string; type?: string | null }): string {
  if (!isUnknownMimeType(file.type)) return file.type as string;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return EXT_MIME[ext] || 'application/octet-stream';
}

export function withInferredMime(file: File): File {
  const type = inferDocumentContentType(file);
  if (type === file.type) return file;
  return new File([file], file.name, { type, lastModified: file.lastModified });
}

function isHeicLike(file: File): boolean {
  const type = inferDocumentContentType(file).toLowerCase();
  const name = file.name.toLowerCase();
  return type.includes('heic') || type.includes('heif') || name.endsWith('.heic') || name.endsWith('.heif');
}

function convertImageFileToJpeg(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Falha ao converter imagem'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(objectUrl);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Falha ao converter imagem'));
            return;
          }
          const jpegName = file.name.replace(/\.(heic|heif|jpe?g|png|webp|gif)$/i, '') + '.jpg';
          resolve(new File([blob], jpegName, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.92,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Falha ao carregar imagem'));
    };
    img.src = objectUrl;
  });
}

export async function prepareClientUploadFile(file: File): Promise<File> {
  if (isHeicLike(file)) {
    try {
      return await convertImageFileToJpeg(file);
    } catch {
      return withInferredMime(file);
    }
  }
  return withInferredMime(file);
}
