/**
 * イベント一覧取得APIのプロキシ
 * バックエンドからDBに保存されたイベント一覧を取得
 */
export async function GET() {
  try {
    // バックエンドのeventsエンドポイントに接続
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3100';
    const response = await fetch(`${backendUrl}/events`);

    if (!response.ok) {
      return new Response('Backend events endpoint error', { status: 500 });
    }

    const events = await response.json();

    return Response.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    return new Response('Failed to fetch events', { status: 500 });
  }
}
