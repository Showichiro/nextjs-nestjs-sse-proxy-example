/**
 * Next.js Route Handler for SSE Proxy
 * バックエンド（NestJS）のSSEエンドポイントにプロキシする
 */
export async function GET() {
  // バックエンドのSSEエンドポイントに接続
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3100';
  const response = await fetch(`${backendUrl}/sse`);

  if (!response.ok) {
    return new Response('Backend SSE endpoint error', { status: 500 });
  }

  // バックエンドからのストリームを取得
  const stream = response.body;

  if (!stream) {
    return new Response('No stream available', { status: 500 });
  }

  // ストリームをそのままクライアントに転送
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
