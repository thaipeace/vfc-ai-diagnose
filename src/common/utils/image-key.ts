/**
 * Chuẩn hóa URL ảnh thành khóa ổn định để tra cứu embedding.
 * Cùng một ảnh Google Drive có thể xuất hiện dưới nhiều dạng link
 * (/file/d/ID/view, uc?id=ID, thumbnail?id=ID...) nên quy về `drive:<ID>`.
 */
export function cleanImageUrl(rawUrl: string): string {
  return rawUrl
    .trim()
    .replace(/^\{|\}$|^\[|\]$/g, '')
    .replace(/^"|"$/g, '')
    .replace(/^'|'$/g, '')
    .trim();
}

export function extractDriveFileId(url: string): string | null {
  if (!url.includes('drive.google.com') && !url.includes('googleusercontent.com')) {
    return null;
  }
  const fileMatch = url.match(/\/file\/d\/([^/?\s]+)/);
  if (fileMatch) return fileMatch[1];
  const idMatch = url.match(/[?&]id=([^&\s]+)/);
  if (idMatch) return idMatch[1];
  const lhMatch = url.match(/googleusercontent\.com\/d\/([^/?\s=]+)/);
  return lhMatch ? lhMatch[1] : null;
}

export function toImageKey(rawUrl: string): string {
  const url = cleanImageUrl(rawUrl);
  const driveId = extractDriveFileId(url);
  return driveId ? `drive:${driveId}` : url;
}

/** Các URL tải trực tiếp, thử lần lượt theo thứ tự. */
export function toDownloadUrls(rawUrl: string): string[] {
  const url = cleanImageUrl(rawUrl);
  const driveId = extractDriveFileId(url);
  if (!driveId) return [url];
  return [
    `https://lh3.googleusercontent.com/d/${driveId}`,
    `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`,
  ];
}
