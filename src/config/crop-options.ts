import { CropGrowthStageOptions } from './crop-options.types';
import { eqStr } from '../common/utils/string';
import { PrismaClient } from '@prisma/client';

export const cropGrowthStageOptions: CropGrowthStageOptions[] = [
  {
    cropType: 'Hoa cúc/ly',
    growthStages: ['Ra hoa', 'Cơi đọt', 'Phát triển thân lá'],
    pestDiseases: ['Sâu', 'Không có', 'Bệnh'],
    severityLevels: ['Nhẹ', 'Trung bình', 'Nặng', 'Không có', 'Hết cứu'],
  },
  {
    cropType: 'Bầu bí dưa',
    growthStages: [
      'Cây con',
      'Phát triển thân lá',
      'Ra hoa',
      'Cơi đọt',
      'Nuôi trái',
    ],
    pestDiseases: ['Không có', 'Bệnh', 'Sâu'],
    severityLevels: ['Không có', 'Trung bình', 'Nặng', 'Nhẹ'],
  },
  {
    cropType: 'Cà phê',
    growthStages: ['Nuôi trái', 'Sau thu hoạch', 'Ra hoa', 'Cây con'],
    pestDiseases: ['Cỏ', 'Bệnh', 'Không có', 'Sâu'],
    severityLevels: ['Nhẹ', 'Trung bình', 'Nặng', 'Không có'],
  },
  {
    cropType: 'Ớt',
    growthStages: ['Cây con', 'Nuôi trái', 'Ra hoa', 'Phát triển thân lá'],
    pestDiseases: ['Bệnh', 'Không có', 'Sâu'],
    severityLevels: ['Trung bình', 'Nặng', 'Nhẹ', 'Không có'],
  },
  {
    cropType: 'Cà chua',
    growthStages: ['Cây con', 'Nuôi trái', 'Phát triển thân lá'],
    pestDiseases: ['Không có', 'Bệnh', 'Sâu', 'Cỏ'],
    severityLevels: ['Không có', 'Nhẹ', 'Trung bình', 'Nặng', 'Hết cứu'],
  },
  {
    cropType: 'Lúa',
    growthStages: [
      'Nuôi trái',
      'Sạ/ Xuống giống',
      'Mạ - Đẻ nhánh',
      'Đẻ nhánh - Đòng trổ',
      'Trổ/Chín',
    ],
    pestDiseases: ['Cỏ', 'Sâu', 'Bệnh'],
    severityLevels: ['Trung bình', 'Nặng', 'Nhẹ'],
  },
  {
    cropType: 'Bắp cải',
    growthStages: ['Phát triển thân lá'],
    pestDiseases: ['Sâu', 'Không có', 'Bệnh'],
    severityLevels: ['Nhẹ', 'Trung bình', 'Nặng', 'Không có'],
  },
  {
    cropType: 'Hành',
    growthStages: ['Cây con', 'Phát triển thân lá'],
    pestDiseases: ['Bệnh', 'Sâu'],
    severityLevels: ['Trung bình', 'Hết cứu', 'Nhẹ', 'Nặng'],
  },
  {
    cropType: 'Xoài',
    growthStages: [
      'Nuôi trái',
      'Sau thu hoạch',
      'Ra hoa',
      'Trái non',
      'Phát triển thân lá',
    ],
    pestDiseases: ['Không có', 'Bệnh', 'Sâu'],
    severityLevels: ['Không có', 'Nhẹ', 'Trung bình', 'Nặng'],
  },
  {
    cropType: 'Sầu riêng',
    growthStages: [
      'Sau thu hoạch',
      'Cơi đọt',
      'Ra hoa',
      'Nuôi trái',
      'Phát triển thân lá',
      'Chạy trái',
    ],
    pestDiseases: ['Bệnh', 'Không có', 'Sâu'],
    severityLevels: ['Nhẹ', 'Trung bình', 'Nặng', 'Không có'],
  },
  {
    cropType: 'Hồ tiêu',
    growthStages: ['Nuôi trái', 'Đẻ nhánh - Đòng trổ', 'Ra hoa'],
    pestDiseases: ['Không có', 'Sâu', 'Bệnh'],
    severityLevels: ['Không có', 'Trung bình', 'Nặng'],
  },
  {
    cropType: 'Đậu phộng',
    growthStages: ['Sạ/ Xuống giống', 'Phát triển thân lá'],
    pestDiseases: ['Sâu', 'Bệnh'],
    severityLevels: ['Trung bình'],
  },
  {
    cropType: 'Cây có múi (Cam, Quýt, Bưởi)',
    growthStages: ['Phát triển thân lá', 'Nuôi trái', 'Sau thu hoạch', 'Ra hoa'],
    pestDiseases: ['Bệnh', 'Sâu', 'Không có'],
    severityLevels: ['Nhẹ', 'Trung bình', 'Nặng', 'Không có'],
  },
  {
    cropType: 'Nhãn',
    growthStages: ['Sau thu hoạch', 'Nuôi trái', 'Phát triển thân lá'],
    pestDiseases: ['Bệnh', 'Sâu'],
    severityLevels: ['Trung bình'],
  },
  {
    cropType: 'Rau - Hoa',
    growthStages: ['Nuôi trái', 'Phát triển thân lá'],
    pestDiseases: ['Bệnh'],
    severityLevels: ['Trung bình'],
  },
];

const CONFIG_KEY = 'crop-options';
let cache: CropGrowthStageOptions[] | null = null;

export async function loadCropOptions(
  prisma?: PrismaClient,
): Promise<CropGrowthStageOptions[]> {
  if (cache) return cache;
  if (prisma) {
    try {
      const config = await prisma.systemConfig.findUnique({
        where: { key: CONFIG_KEY },
      });
      if (config && Array.isArray(config.value)) {
        cache = config.value as CropGrowthStageOptions[];
        return cache;
      }
    } catch (err) {
      console.error('[cropOptions] Failed to load from DB, using fallback:', err);
    }
  }
  return cropGrowthStageOptions;
}

export async function getCropOptionByType(
  cropType?: string | null,
  prisma?: PrismaClient,
): Promise<CropGrowthStageOptions | null> {
  if (!cropType) return null;
  const options = await loadCropOptions(prisma);
  return options.find((o) => eqStr(o.cropType, cropType)) ?? null;
}
