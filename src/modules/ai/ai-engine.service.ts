import { Injectable } from '@nestjs/common';

@Injectable()
export class AIEngineService {
  buildPrompt(cropType?: string): string {
    return `Bạn là chuyên gia nông nghiệp của VFC. Hãy phân tích hình ảnh cây trồng của nông dân${cropType ? ` (loại: ${cropType})` : ''} và so sánh với các dữ liệu bệnh tham khảo của VFC để:
1. Đưa ra chẩn đoán cuối cùng về loại nấm, vi khuẩn hoặc sâu hại gây bệnh, ưu tiên kết quả khớp với dữ liệu VFC nếu triệu chứng tương đồng.
2. Xác định chi tiết tên bệnh, mức độ bệnh.
3. Đề xuất hướng xử lý.
4. Trích xuất CHÍNH XÁC tên các sản phẩm (từ phần Giải pháp VFC / vfcSolution) và phân chia chúng thành các "bộ giải pháp" tương ứng nếu vfcSolution đề xuất nhiều lựa chọn (chữ "hoặc", "luân phiên"). Nếu "Không phun", để rỗng mảng.

Trả về kết quả dưới dạng JSON thuần túy (không có markdown) với format: 
{ 
  "disease": "tên bệnh", 
  "severity": "mức độ bệnh", 
  "summary": "tóm tắt ngắn gọn hướng xử lý", 
  "confidence": 0.9,
  "vfcSolutionText": "Câu Giải pháp VFC nguyên bản",
  "solutionSets": [
    { "name": "Tên bộ giải pháp (ví dụ: Bộ 1, Bộ luân phiên...)", "products": ["tên sản phẩm 1", "tên sản phẩm 2"] }
  ],
  "reasons": { "tên sản phẩm 1": "công dụng rõ ràng của sản phẩm đối với tình trạng cây" }
}`;
  }
}
