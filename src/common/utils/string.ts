/**
 * Removes accents and normalizes a string for comparison.
 */
export const normalizeStr = (s: string): string => {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
};

/**
 * Compares two strings case-insensitively and accent-insensitively.
 */
export const eqStr = (a?: string | null, b?: string | null): boolean => {
  return normalizeStr(a ?? '') === normalizeStr(b ?? '');
};

/**
 * Checks if a string contains another string case-insensitively and accent-insensitively.
 */
export const includesStr = (
  container?: string | null,
  search?: string | null,
): boolean => {
  return normalizeStr(container ?? '').includes(normalizeStr(search ?? ''));
};

/**
 * Converts Google Drive URLs to their embeddable preview version
 */
export const getPreviewUrl = (url: string): string => {
  if (!url || !url.includes('google.com')) return url;

  let id = '';
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    id = fileMatch[1];
  } else {
    const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      id = idMatch[1];
    }
  }

  if (id) {
    return `https://drive.google.com/thumbnail?id=${id}&sz=w1000`;
  }

  return url;
};

/**
 * Extracts and parses JSON from markdown code block or raw string
 */
export const parseJsonBlock = <T = any>(text: string): T => {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
  return JSON.parse(jsonStr) as T;
};
