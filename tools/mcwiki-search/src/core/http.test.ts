import { describe, expect, it, vi } from 'vitest';

import { WikiError } from './errors.js';
import { HttpClient, USER_AGENT } from './http.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SITE = {
  apiUrl: 'https://zh.minecraft.wiki/api.php',
  baseUrl: 'https://zh.minecraft.wiki',
};

describe('HttpClient', () => {
  it('buildUrl 带上模块、版本与参数，忽略 undefined', () => {
    const client = new HttpClient(SITE);
    const url = new URL(
      client.buildUrl('query', { list: 'search', srsearch: '苦力怕', ignored: undefined }),
    );
    expect(url.searchParams.get('action')).toBe('query');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('formatversion')).toBe('2');
    expect(url.searchParams.get('errorformat')).toBe('plaintext');
    expect(url.searchParams.get('srsearch')).toBe('苦力怕');
    expect(url.searchParams.has('ignored')).toBe(false);
  });

  it('发送可识别的 User-Agent', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const client = new HttpClient({ ...SITE, fetchImpl });
    await client.request('query');
    const init = fetchImpl.mock.calls[0]?.[1] ?? {};
    expect((init.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT);
  });

  it('成功时返回解析后的 JSON', async () => {
    const client = new HttpClient({ ...SITE, fetchImpl: async () => jsonResponse({ value: 1 }) });
    await expect(client.request('query')).resolves.toEqual({ value: 1 });
  });

  it('5xx 重试后成功', async () => {
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, 500) : jsonResponse({ ok: true });
    };
    const client = new HttpClient({ ...SITE, fetchImpl, sleep: async () => {} });
    await expect(client.request('query')).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('重试耗尽后抛出 server-error', async () => {
    let calls = 0;
    const client = new HttpClient({
      ...SITE,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({}, 503);
      },
      sleep: async () => {},
      retries: 2,
    });
    await expect(client.request('query')).rejects.toMatchObject({ code: 'server-error' });
    expect(calls).toBe(3);
  });

  it('超时归类为 timeout 且可重试', async () => {
    const timeoutError = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    let calls = 0;
    const client = new HttpClient({
      ...SITE,
      fetchImpl: async () => {
        calls += 1;
        if (calls < 2) {
          throw timeoutError;
        }
        return jsonResponse({ ok: true });
      },
      sleep: async () => {},
    });
    await expect(client.request('query')).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('429 归类为 rate-limited', async () => {
    const client = new HttpClient({
      ...SITE,
      fetchImpl: async () => jsonResponse({}, 429),
      sleep: async () => {},
      retries: 0,
    });
    await expect(client.request('query')).rejects.toMatchObject({ code: 'rate-limited' });
  });

  it('非法 JSON 抛出 invalid-response 且不重试', async () => {
    let calls = 0;
    const client = new HttpClient({
      ...SITE,
      fetchImpl: async () => {
        calls += 1;
        return new Response('<html>', { status: 200 });
      },
      sleep: async () => {},
    });
    await expect(client.request('query')).rejects.toBeInstanceOf(WikiError);
    expect(calls).toBe(1);
  });

  it('缺词条 API 错误归类为 missing-title 且不重试', async () => {
    let calls = 0;
    const client = new HttpClient({
      ...SITE,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ error: { code: 'missingtitle', text: '页面不存在' } });
      },
      sleep: async () => {},
    });
    await expect(client.request('parse', { page: 'nope' })).rejects.toMatchObject({
      code: 'missing-title',
    });
    expect(calls).toBe(1);
  });
});

describe('USER_AGENT（请求礼仪）', () => {
  it('只含 ASCII 可见字符，否则 fetch 会拒绝该请求头', () => {
    // fetch 会把请求头值转成 ByteString，任何非 ASCII 字符都会直接抛 TypeError。
    const nonAscii = [...USER_AGENT].filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint > 0x7e;
    });
    expect(nonAscii).toEqual([]);
  });
});
