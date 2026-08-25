/** Dữ liệu gửi cho AI để chẩn đoán */
export interface DiagnosisInput {
  userImages: string[]; // base64 ảnh farmer gửi (đã resize bởi Next.js)
  referenceData: ReferenceData[]; // Ảnh + text bệnh tham khảo từ DB
  cropType?: string; // Loại cây (VD: "Lúa")
  promptText: string; // Câu hỏi gửi cho AI
}

/** Dữ liệu gửi cho AI để validate ảnh */
export interface ImageValidationInput {
  base64Images: string[]; // Ảnh nhỏ 256×256 để validate nhanh
  cropType?: string;
  allowedStages: string[]; // Giai đoạn hợp lệ: ["Mạ", "Đẻ nhánh", ...]
  allowedPestDiseases: string[]; // Dịch hại hợp lệ
  allowedSeverityLevels: string[]; // Mức độ hợp lệ: ["Nhẹ", "Trung bình", "Nặng"]
}

/** Ảnh tham khảo từ bảng PlanStageDisease */
export interface ReferenceData {
  text: string; // Mô tả bệnh, giải pháp VFC
  base64Image?: string; // Ảnh minh họa (nếu có)
}

/** Kết quả AI trả về (đã validate bằng Zod) */
export interface DiagnosisResult {
  disease: string;
  severity: string;
  summary: string;
  confidence: number;
  vfcSolutionText?: string;
  solutionSets?: { name: string; products: string[] }[];
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
