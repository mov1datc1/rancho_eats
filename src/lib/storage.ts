// Catalog images are stored as objects, never embedded in database rows.
import { supabase } from './supabase';

const BUCKET = 'menu-images';

/**
 * Upload a base64/data-url image (from FileReader) to Supabase Storage.
 * Works in web browsers where Blob is available.
 *
 * @param dataUrl - Full data URL string (e.g. "data:image/jpeg;base64,/9j/4AAQ...")
 * @param restaurantId - Restaurant ID for folder organization
 * @param itemId - Optional menu item ID for stable file naming
 * @returns Public URL of the uploaded image, or null on failure
 */
export const uploadMenuImageWeb = async (
  dataUrl: string,
  restaurantId: string,
  itemId?: string,
): Promise<string | null> => {
  try {
    // Convert data URL to Blob (web-native approach)
    const response = await fetch(dataUrl);
    const source = await response.blob();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(source.type) || source.size > 10 * 1024 * 1024) throw new Error('Usa JPG, PNG o WebP de hasta 10 MB.');
    const bitmap = await createImageBitmap(source);
    let blob: Blob;
    try {
      if (bitmap.width * bitmap.height > 40000000) throw new Error('Imagen demasiado grande.');
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No se pudo procesar la foto.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo comprimir la foto.')), 'image/jpeg', 0.82));
    } finally { bitmap.close(); }

    const contentType = blob.type || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const fileName = `${restaurantId}/${itemId || 'photo'}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, blob, {
        contentType,
        upsert: false,
        cacheControl: "31536000",
      });

    if (uploadError) {
      console.error('[PideYa Storage] Upload error:', uploadError.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(fileName);

    return urlData?.publicUrl ?? null;
  } catch (err) {
    console.error('[PideYa Storage] Upload exception:', err);
    return null;
  }
};

/**
 * Check if a photo URL is a legacy base64 string or a proper URL.
 */
export const isBase64Image = (url: string | null): boolean => {
  if (!url) return false;
  return url.startsWith('data:image/');
};
