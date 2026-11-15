// isomorphic-git http client for React Native: its own client needs response streams, which React Native's fetch does not have.
export const http = {
  async request({ url, method = 'GET', headers = {}, body }: { url: string; method?: string; headers?: Record<string, string>; body?: AsyncIterable<Uint8Array> | Uint8Array[] }) {
    let data: Uint8Array | undefined;
    if (body) {
      const parts: Uint8Array[] = [];
      for await (const c of body as any) parts.push(c);
      const len = parts.reduce((n, p) => n + p.length, 0);
      data = new Uint8Array(len);
      let o = 0; for (const p of parts) { data.set(p, o); o += p.length; }
    }
    const res = await fetch(url, { method, headers, body: data as any });
    const buf = new Uint8Array(await res.arrayBuffer());
    const h: Record<string, string> = {};
    res.headers.forEach((v, k) => { h[k] = v; });
    return { url: res.url, method, statusCode: res.status, statusMessage: res.statusText, headers: h, body: [buf] };
  },
};
