// Vercel API Route - HTTP 백엔드 프록시
// pages/api/proxy/[...path].js 또는 api/[...path].js 위치에 생성

const BACKEND_URL = 'http://121.125.73.16:8787';

export default async function handler(req, res) {
  const { path } = req.query;
  const apiPath = Array.isArray(path) ? path.join('/') : path;

  try {
    // 쿼리 파라미터 처리
    const queryString = new URLSearchParams(req.query);
    // path 파라미터는 제외
    queryString.delete('path');
    const queryParam = queryString.toString() ? `?${queryString.toString()}` : '';

    const targetUrl = `${BACKEND_URL}/${apiPath}${queryParam}`;
    console.log('Proxying request to:', targetUrl);

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...req.headers,
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });

    const data = await response.json();

    // CORS 헤더 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    res.status(response.status).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Proxy request failed' });
  }
}