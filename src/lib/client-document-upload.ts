export const CLIENT_DOCUMENT_ACCEPT =
  'image/*,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.pdf,.doc,.docx,application/pdf';

export function inferDocumentContentType(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.heic') || name.endsWith('.heif')) return 'image/heic';
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.doc')) return 'application/msword';
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
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
      const type = inferDocumentContentType(file);
      return file.type ? file : new File([file], file.name, { type });
    }
  }
  if (!file.type) {
    const type = inferDocumentContentType(file);
    if (type !== 'application/octet-stream') {
      return new File([file], file.name, { type });
    }
  }
  return file;
}
