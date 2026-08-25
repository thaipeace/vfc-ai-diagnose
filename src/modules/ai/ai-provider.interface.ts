/** Dữ liệu gửi cho AI để chẩn đoán */
export interface DiagnosisInput {
  userImages: string[]; // base64 ảnh farmer gửi (đã resize bởi Next.js)
  referenceData: ReferenceData[]; // Ảnh + text bệnh tham khảo từ DB
  cropType?: string; // Loại cây (VD: "Lúa")
  promptText: string; // Câu hỏi gửi cho AI
}

/** Ảnh tham khảo từ bảng PlanStageDisease */
export interface ReferenceData {
  text: string; // Mô tả bệnh, giải pháp VFC
  base64Image?: string | null; // Ảnh minh họa (nếu có)
}

/** Kết quả AI trả về */
export interface DiagnosisResult {
  disease?: string;
  severity?: string;
  summary?: string;
  confidence?: number;
  vfcSolutionText?: string;
  solutionSets?: { name: string; products: string[] }[];
  suggestedProducts?: string[];
  reasons?: Record<string, string>;
  provider?: string; // "gemini" hoặc "openrouter"
  fallbackFrom?: string; // Provider đầu tiên bị lỗi (nếu có)
}

/** Hợp đồng mà mọi AI Provider phải implement */
export interface AIProvider {
  readonly name: string; // "gemini" hoặc "openrouter"
  diagnose(input: DiagnosisInput): Promise<DiagnosisResult>;
  healthCheck(): Promise<boolean>;
}
