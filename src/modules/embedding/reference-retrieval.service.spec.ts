import { ConfigService } from '@nestjs/config';
import { ReferenceRetrievalService } from './reference-retrieval.service';
import { EmbeddingUnavailableError } from './image-embedding.service';
import { AggregatedDisease } from '../../common/utils/disease-aggregator';

const drive = (id: string) => `https://drive.google.com/uc?id=${id}`;

const disease = (key: string, urls: string[]): AggregatedDisease => ({
  id: key,
  diseaseKey: key,
  detail: key,
  pestDisease: 'Bệnh',
  severityLevel: 'Trung bình',
  description: `mô tả ${key}`,
  vfcSolution: `thuốc ${key}`,
  imageUrls: urls,
  stagesCovered: ['Cơi đọt'],
});

function build(opts: {
  rows: { image_key: string; embedding: number[] }[];
  embed?: jest.Mock;
  config?: Record<string, string>;
}) {
  const queryRaw = jest.fn().mockResolvedValue(opts.rows);
  const prisma = { $queryRaw: queryRaw } as any;
  const embedder = { embedBase64: opts.embed ?? jest.fn().mockResolvedValue([1, 0]) } as any;
  const imageService = {
    fetchAndOptimize: jest.fn().mockImplementation(async (url: string) => `b64(${url})`),
  } as any;
  const config = {
    get: (k: string) => (opts.config ?? {})[k],
  } as unknown as ConfigService;
  const svc = new ReferenceRetrievalService(prisma, embedder, imageService, config);
  return { svc, queryRaw, embedder, imageService };
}

describe('ReferenceRetrievalService', () => {
  const rows = [
    { image_key: 'drive:a', embedding: [1, 0] },
    { image_key: 'drive:b', embedding: [0.8, 0.6] },
    { image_key: 'drive:c', embedding: [0, 1] },
  ];
  const diseases = [
    disease('c', [drive('c')]),
    disease('a', [drive('a')]),
    disease('b', [drive('b')]),
  ];

  it('isEnabled chỉ true khi ENABLE_VECTOR_RETRIEVAL=true', () => {
    expect(build({ rows }).svc.isEnabled()).toBe(false);
    expect(build({ rows, config: { ENABLE_VECTOR_RETRIEVAL: 'true' } }).svc.isEnabled()).toBe(true);
  });

  it('xếp bệnh theo độ giống ảnh truy vấn', async () => {
    const { svc, embedder } = build({ rows });
    const res = await svc.retrieve({ diseases, userImages: ['IMG'] });
    expect(embedder.embedBase64).toHaveBeenCalledWith('IMG');
    expect(res?.diseases.map((d) => d.disease.diseaseKey)).toEqual(['a', 'b', 'c']);
    expect(res?.coverage).toBe(1);
  });

  it('chỉ embed AI_QUERY_IMAGES ảnh đầu và gộp vector', async () => {
    const embed = jest.fn().mockResolvedValueOnce([1, 0]).mockResolvedValueOnce([0, 1]);
    const { svc } = build({ rows, embed, config: { AI_QUERY_IMAGES: '2' } });
    await svc.retrieve({ diseases, userImages: ['I1', 'I2', 'I3'] });
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('thiếu vector (độ phủ thấp): trả null và KHÔNG tốn lượt embedding', async () => {
    const { svc, embedder } = build({ rows: [{ image_key: 'drive:a', embedding: [1, 0] }] });
    const res = await svc.retrieve({ diseases, userImages: ['IMG'] });
    expect(res).toBeNull();
    expect(embedder.embedBase64).not.toHaveBeenCalled();
  });

  it('embedding lỗi/hết quota: trả null để dùng luồng dự phòng', async () => {
    const embed = jest.fn().mockRejectedValue(new EmbeddingUnavailableError('429'));
    const { svc } = build({ rows, embed });
    expect(await svc.retrieve({ diseases, userImages: ['IMG'] })).toBeNull();
  });

  it('DB lỗi (vd. chưa có bảng): trả null, không ném lỗi', async () => {
    const { svc, queryRaw } = build({ rows });
    queryRaw.mockRejectedValueOnce(new Error('relation does not exist'));
    expect(await svc.retrieve({ diseases, userImages: ['IMG'] })).toBeNull();
  });

  it('không có ảnh đối chứng: trả null', async () => {
    const { svc } = build({ rows });
    expect(await svc.retrieve({ diseases: [disease('x', [])], userImages: ['IMG'] })).toBeNull();
  });

  it('cache vector: lần gọi thứ hai không đọc lại DB', async () => {
    const { svc, queryRaw } = build({ rows });
    await svc.retrieve({ diseases, userImages: ['IMG'] });
    await svc.retrieve({ diseases, userImages: ['IMG'] });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('queryVector + excludeImageKeys: dùng cho đánh giá leave-one-out', async () => {
    const { svc, embedder } = build({ rows });
    const res = await svc.retrieve({
      diseases,
      queryVector: [1, 0],
      excludeImageKeys: new Set(['drive:a']),
    });
    expect(embedder.embedBase64).not.toHaveBeenCalled();
    expect(res?.diseases.map((d) => d.disease.diseaseKey)).toEqual(['b', 'c']);
  });

  it('buildReferenceData: một mục text/bệnh, ảnh phụ có mục riêng, không có dòng giai đoạn', async () => {
    const multi = [disease('a', [drive('a'), drive('b')]), disease('c', [drive('c')])];
    const { svc, imageService } = build({ rows, config: { AI_RETRIEVAL_IMAGES_PER_DISEASE: '2' } });
    const res = await svc.retrieve({ diseases: multi, queryVector: [1, 0] });
    const data = await svc.buildReferenceData(res!);

    expect(data).toHaveLength(3); // a (ảnh 1), a (ảnh 2), c
    expect(data[0].text).toContain('[Mẫu tham chiếu #1 [CÓ 2 ẢNH');
    expect(data[0].text).toContain('thuốc a');
    expect(data[0].text).not.toContain('Giai đoạn thường gặp');
    expect(data[1].text).toContain('Ảnh đối chứng 2 của Mẫu tham chiếu #1');
    expect(data[2].text).toContain('[Mẫu tham chiếu #2');
    expect(imageService.fetchAndOptimize).toHaveBeenCalledWith(
      expect.any(String),
      { size: 384, quality: 70 },
    );
  });

  it('buildReferenceData: ảnh tải lỗi thì chỉ còn mô tả văn bản', async () => {
    const { svc, imageService } = build({ rows });
    imageService.fetchAndOptimize.mockResolvedValue(null);
    const res = await svc.retrieve({ diseases, queryVector: [1, 0] });
    const data = await svc.buildReferenceData(res!);
    expect(data.every((d) => d.base64Image === null)).toBe(true);
    expect(data[0].text).toContain('CHỈ THAM KHẢO MÔ TẢ');
  });
});
