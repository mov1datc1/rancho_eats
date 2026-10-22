/**
 * Supabase Storage utilities for PideYa Web Admin.
 *
 * Menu item photos are uploaded to the `menu-images` bucket.
 * This mirrors the storage.ts utility in pideya-restaurant for consistency.
 *
 * The bucket must be created in Supabase with public access:
 *   INSERT INTO storage.buckets (id, name, public) VALUES ('menu-images', 'menu-images', true);
 *   
 *   -- Allow public reads
 *   CREATE POLICY "Public read menu images" ON storage.objects
 *     FOR SELECT USING (bucket_id = 'menu-images');
 *   
 *   -- Allow authenticated users to upload/update
 *   CREATE POLICY "Authenticated upload menu images" ON storage.objects
 *     FOR INSERT WITH CHECK (bucket_id = 'menu-images');
 *   CREATE POLICY "Authenticated update menu images" ON storage.objects
 *     FOR UPDATE USING (bucket_id = 'menu-images');
 */

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
    const blob = await response.blob();

    const contentType = blob.type || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const fileName = itemId
      ? `${restaurantId}/${itemId}.${ext}`
      : `${restaurantId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, blob, {
        contentType,
        upsert: true,
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
