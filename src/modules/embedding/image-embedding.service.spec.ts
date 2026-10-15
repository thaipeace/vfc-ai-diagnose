import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import {
  EmbeddingUnavailableError,
  ImageEmbeddingService,
} from './image-embedding.service';
import { EMBEDDING_DIMENSIONS } from './embedding.constants';

async function tinyJpegBase64(): Promise<string> {
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 120, b: 30 } },
  })
    .jpeg()
    .toBuffer();
  return buf.toString('base64');
}

const okResponse = (len = EMBEDDING_DIMENSIONS) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ embedding: { values: new Array(len).fill(0.01) } }),
  }) as unknown as Response;

const status = (code: number) =>
  ({ ok: false, status: code, json: async () => ({}) }) as unknown as Response;

describe('ImageEmbeddingService', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  let service: ImageEmbeddingService;
  let img: string;

  beforeAll(async () => {
    img = await tinyJpegBase64();
  });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    service = new ImageEmbeddingService({
      get: (k: string) => (k === 'GEMINI_API_KEY' ? 'test-key' : undefined),
    } as unknown as ConfigService);
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('trả về vector 768 chiều và gửi đúng yêu cầu', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const v = await service.embedBase64(img);
    expect(v).toHaveLength(EMBEDDING_DIMENSIONS);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('gemini-embedding-2:embedContent');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    expect(JSON.parse(init.body).outputDimensionality).toBe(EMBEDDING_DIMENSIONS);
  });

  it('429: ném EmbeddingUnavailableError và mở circuit breaker (lần sau không gọi mạng)', async () => {
    fetchMock.mockResolvedValueOnce(status(429));
    await expect(service.embedBase64(img)).rejects.toBeInstanceOf(EmbeddingUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(service.embedBase64(img)).rejects.toBeInstanceOf(EmbeddingUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // không gọi thêm
  });

  it('5xx: thử lại rồi thành công', async () => {
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as any;
    }) as any);
    fetchMock.mockResolvedValueOnce(status(503)).mockResolvedValueOnce(okResponse());
    const v = await service.embedBase64(img);
    expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    (setTimeout as unknown as jest.SpyInstance).mockRestore();
  });

  it('lỗi 4xx (không phải 429): không thử lại', async () => {
    fetchMock.mockResolvedValueOnce(status(400));
    await expect(service.embedBase64(img)).rejects.toBeInstanceOf(EmbeddingUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('số chiều sai: bị từ chối', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(10));
    await expect(service.embedBase64(img)).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });

  it('thiếu API key: bị từ chối, không gọi mạng', async () => {
    const noKey = new ImageEmbeddingService({ get: () => undefined } as unknown as ConfigService);
    await expect(noKey.embedBase64(img)).rejects.toBeInstanceOf(EmbeddingUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
