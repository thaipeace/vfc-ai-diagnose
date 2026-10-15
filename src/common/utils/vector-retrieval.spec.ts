import {
  averageVectors,
  cosineSimilarity,
  normalizeVector,
  rankDiseasesBySimilarity,
} from './vector-retrieval';

const disease = (key: string, urls: string[]) => ({
  diseaseKey: key,
  imageUrls: urls,
});
const drive = (id: string) => `https://drive.google.com/uc?id=${id}`;

describe('vector-retrieval', () => {
  it('cosineSimilarity: giống nhau = 1, vuông góc = 0, vector 0 = 0', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('averageVectors trả về vector đơn vị', () => {
    const v = averageVectors([
      [1, 0],
      [0, 1],
    ]);
    expect(Math.hypot(v[0], v[1])).toBeCloseTo(1);
    expect(v[0]).toBeCloseTo(v[1]);
    expect(normalizeVector([3, 4])).toEqual([0.6, 0.8]);
  });

  it('xếp bệnh theo ảnh giống nhất, không phụ thuộc thứ tự đầu vào', () => {
    const emb = new Map<string, number[]>([
      ['drive:a', [1, 0]],
      ['drive:b', [0.9, 0.1]],
      ['drive:c', [0, 1]],
    ]);
    const diseases = [
      disease('c-disease', [drive('c')]),
      disease('a-disease', [drive('a')]),
      disease('b-disease', [drive('b')]),
    ];
    const { ranked } = rankDiseasesBySimilarity(diseases, emb, [1, 0], {
      topDiseases: 3,
      imagesPerDisease: 1,
      maxImages: 10,
    });
    expect(ranked.map((r) => r.disease.diseaseKey)).toEqual([
      'a-disease',
      'b-disease',
      'c-disease',
    ]);
  });

  it('một bệnh nhiều ảnh: chấm bằng ảnh giống nhất và chỉ lấy tối đa imagesPerDisease', () => {
    const emb = new Map<string, number[]>([
      ['drive:r1', [0.6, 0.8]],
      ['drive:r2', [1, 0]],
      ['drive:r3', [0.9, 0.1]],
      ['drive:x', [0.5, 0.5]],
    ]);
    const { ranked } = rankDiseasesBySimilarity(
      [
        disease('rong-tao', [drive('r1'), drive('r2'), drive('r3')]),
        disease('khac', [drive('x')]),
      ],
      emb,
      [1, 0],
      { topDiseases: 2, imagesPerDisease: 2, maxImages: 10 },
    );
    expect(ranked[0].disease.diseaseKey).toBe('rong-tao');
    expect(ranked[0].images.map((i) => i.key)).toEqual(['drive:r2', 'drive:r3']);
    expect(ranked[1].images).toHaveLength(1);
  });

  it('maxImages: vòng 1 cấp ảnh tốt nhất cho từng bệnh trước khi cấp ảnh thứ hai', () => {
    const emb = new Map<string, number[]>([
      ['drive:a1', [1, 0]],
      ['drive:a2', [0.99, 0.01]],
      ['drive:b1', [0.8, 0.2]],
    ]);
    const { ranked } = rankDiseasesBySimilarity(
      [disease('a', [drive('a1'), drive('a2')]), disease('b', [drive('b1')])],
      emb,
      [1, 0],
      { topDiseases: 2, imagesPerDisease: 2, maxImages: 2 },
    );
    expect(ranked[0].images.map((i) => i.key)).toEqual(['drive:a1']);
    expect(ranked[1].images.map((i) => i.key)).toEqual(['drive:b1']);
  });

  it('chỉ lấy topDiseases bệnh đầu', () => {
    const emb = new Map<string, number[]>([
      ['drive:a', [1, 0]],
      ['drive:b', [0.5, 0.5]],
      ['drive:c', [0, 1]],
    ]);
    const { ranked } = rankDiseasesBySimilarity(
      [disease('a', [drive('a')]), disease('b', [drive('b')]), disease('c', [drive('c')])],
      emb,
      [1, 0],
      { topDiseases: 2, imagesPerDisease: 1, maxImages: 10 },
    );
    expect(ranked.map((r) => r.disease.diseaseKey)).toEqual(['a', 'b']);
  });

  it('coverage: đếm ảnh duy nhất, link khác dạng nhưng cùng Drive ID là một ảnh', () => {
    const emb = new Map<string, number[]>([['drive:a', [1, 0]]]);
    const result = rankDiseasesBySimilarity(
      [
        disease('a', [
          'https://drive.google.com/file/d/a/view?usp=sharing',
          'https://drive.google.com/uc?id=a',
        ]),
        disease('b', [drive('missing')]),
      ],
      emb,
      [1, 0],
      { topDiseases: 5, imagesPerDisease: 1, maxImages: 10 },
    );
    expect(result.totalImages).toBe(2);
    expect(result.embeddedImages).toBe(1);
    expect(result.ranked).toHaveLength(1);
  });

  it('excludeKeys loại ảnh khỏi xếp hạng và khỏi tổng số (leave-one-out)', () => {
    const emb = new Map<string, number[]>([
      ['drive:self', [1, 0]],
      ['drive:other', [0.7, 0.7]],
    ]);
    const result = rankDiseasesBySimilarity(
      [disease('a', [drive('self')]), disease('b', [drive('other')])],
      emb,
      [1, 0],
      {
        topDiseases: 5,
        imagesPerDisease: 1,
        maxImages: 10,
        excludeKeys: new Set(['drive:self']),
      },
    );
    expect(result.ranked.map((r) => r.disease.diseaseKey)).toEqual(['b']);
    expect(result.totalImages).toBe(1);
  });

  it('kết quả ổn định khi điểm bằng nhau (theo diseaseKey)', () => {
    const emb = new Map<string, number[]>([
      ['drive:1', [1, 0]],
      ['drive:2', [1, 0]],
    ]);
    const { ranked } = rankDiseasesBySimilarity(
      [disease('z', [drive('1')]), disease('a', [drive('2')])],
      emb,
      [1, 0],
      { topDiseases: 2, imagesPerDisease: 1, maxImages: 10 },
    );
    expect(ranked.map((r) => r.disease.diseaseKey)).toEqual(['a', 'z']);
  });
});
