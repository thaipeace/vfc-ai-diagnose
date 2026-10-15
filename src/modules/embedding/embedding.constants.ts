/**
 * Cấu hình embedding dùng chung cho service runtime và script backfill (tránh lệch phiên bản).
 * Cố định trong code (không đọc từ env) vì các hằng này phải trùng khớp với vector đã lưu trong DB.
 */
export const EMBEDDING_MODEL = 'gemini-embedding-2';
export const EMBEDDING_DIMENSIONS = 768;
/** Lưu cùng vector; đổi model/số chiều ⇒ đổi version ⇒ vector cũ tự bị bỏ qua và cần backfill lại. */
export const EMBEDDING_MODEL_VERSION = `${EMBEDDING_MODEL}@${EMBEDDING_DIMENSIONS}`;
