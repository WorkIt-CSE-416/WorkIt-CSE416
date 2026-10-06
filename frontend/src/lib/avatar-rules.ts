/**
Rules for accepting file, wrong type is rejected and max size
 */
export const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

// HEIC (iPhone's default) is left out on purpose: the API cannot decode it
// and most browsers cannot display it 
export const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function avatarFileError(file: File): string | null {
  if (!AVATAR_MIME_TYPES.includes(file.type)) return "Use a JPEG, PNG or WebP image.";
  if (file.size > MAX_AVATAR_BYTES) return "Image must be under 4 MB.";
  return null;
}
