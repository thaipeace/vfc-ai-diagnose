-- Embedding cache cho ảnh đối chứng (Gemini multimodal embedding).
-- Khóa theo ẢNH (image_key), KHÔNG khóa ngoại tới plan_stage_diseases:
--   * Import CSV "thay thế toàn bộ" xóa và tạo lại dòng bệnh với id mới,
--     nhưng ảnh không đổi nên vector vẫn dùng lại được.
--   * Thông tin bệnh luôn đọc từ plan_stage_diseases (nguồn sự thật) lúc truy vấn.
-- Vector lưu real[]; cosine tính trong tiến trình (kho nhỏ, mỗi cây <= vài trăm ảnh),
-- nên không cần extension pgvector và chạy giống hệt ở local/staging/production.
-- Idempotent: chạy lại nhiều lần an toàn.

CREATE TABLE IF NOT EXISTS reference_image_embeddings (
  image_key     TEXT        PRIMARY KEY,           -- drive:<ID> hoặc URL gốc đã làm sạch
  image_url     TEXT        NOT NULL,              -- URL gốc lần embed gần nhất (để truy vết)
  image_hash    TEXT        NOT NULL,              -- sha256 byte ảnh gốc, phát hiện ảnh bị thay
  embedding     REAL[]      NOT NULL,
  dimensions    INTEGER     NOT NULL,
  model_version TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ref_emb_dims CHECK (cardinality(embedding) = dimensions)
);

CREATE INDEX IF NOT EXISTS idx_ref_emb_model ON reference_image_embeddings (model_version);
