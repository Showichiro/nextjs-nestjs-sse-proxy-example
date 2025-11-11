'use client';

import { useState } from 'react';

/**
 * SSEイベントの型定義
 */
interface SSEEvent {
  id: string;
  type: 'connecting' | 'message' | 'complete' | 'error';
  message: string;
  data?: unknown;
  timestamp: string;
}

/**
 * イベントカードコンポーネント
 */
function EventCard({ event }: { event: SSEEvent }) {
  // イベントタイプ別のスタイル定義
  const typeStyles = {
    connecting: {
      bg: 'bg-blue-950/20',
      ring: 'ring-1 ring-blue-500/30',
      text: 'text-blue-400',
      icon: '🔵',
    },
    message: {
      bg: 'bg-purple-950/20',
      ring: 'ring-1 ring-purple-500/30',
      text: 'text-purple-400',
      icon: '📨',
    },
    complete: {
      bg: 'bg-green-950/20',
      ring: 'ring-1 ring-green-500/30',
      text: 'text-green-400',
      icon: '✅',
    },
    error: {
      bg: 'bg-red-950/20',
      ring: 'ring-1 ring-red-500/30',
      text: 'text-red-400',
      icon: '❌',
    },
  };

  const style = typeStyles[event.type];

  return (
    <li
      className={`p-6 bg-[#1a1a1a] rounded-lg shadow-md ${style.bg} ${style.ring}
        animate-in slide-in-from-top-2 fade-in duration-300 ease-out`}
    >
      <div className="flex items-start gap-3">
        {/* アイコン */}
        <span className="text-2xl" aria-hidden="true">
          {style.icon}
        </span>

        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between gap-4">
            <h3 className={`text-base font-semibold ${style.text}`}>
              {event.type.charAt(0).toUpperCase() + event.type.slice(1)}
            </h3>
            <time className="text-xs font-mono text-zinc-500">
              {new Date(event.timestamp).toLocaleTimeString('ja-JP')}
            </time>
          </div>

          <p className="text-sm leading-relaxed text-zinc-300">
            {event.message}
          </p>

          {event.data ? (
            <pre className="mt-2 p-3 bg-zinc-900/50 rounded text-xs font-mono text-zinc-400 overflow-x-auto">
              {JSON.stringify(event.data, null, 2)}
            </pre>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * メインコンポーネント
 */
export default function Home() {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [eventSourceInstance, setEventSourceInstance] =
    useState<EventSource | null>(null);

  /**
   * SSE接続を開始
   */
  const startSSE = () => {
    if (isConnecting) return;

    setIsConnecting(true);
    setEvents([]);

    // EventSourceでNext.js Route Handlerに接続
    const eventSource = new EventSource('/api/sse');
    setEventSourceInstance(eventSource);

    // メッセージ受信
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const newEvent: SSEEvent = {
          id: `${Date.now()}-${Math.random()}`,
          type: data.type || 'message',
          message: data.message || '',
          data: data.data,
          timestamp: data.timestamp || new Date().toISOString(),
        };
        setEvents((prev) => [...prev, newEvent]);
      } catch (error) {
        console.error('Failed to parse SSE data:', error);
      }
    };

    // エラーハンドリング
    eventSource.onerror = () => {
      // 正常終了の場合（readyState === CLOSED）は何もしない
      if (eventSource.readyState === EventSource.CLOSED) {
        // completeイベントが既に受信されているはず
        eventSource.close();
        setIsConnecting(false);
        setEventSourceInstance(null);
        return;
      }

      // 実際のエラーの場合のみエラーイベントを追加
      const errorEvent: SSEEvent = {
        id: `${Date.now()}-error`,
        type: 'error',
        message: '接続エラーが発生しました',
        timestamp: new Date().toISOString(),
      };
      setEvents((prev) => [...prev, errorEvent]);
      eventSource.close();
      setIsConnecting(false);
      setEventSourceInstance(null);
    };

    // 完了時にクリーンアップ
    const checkComplete = setInterval(() => {
      const lastEvent = events[events.length - 1];
      if (lastEvent?.type === 'complete') {
        clearInterval(checkComplete);
        eventSource.close();
        setIsConnecting(false);
        setEventSourceInstance(null);
      }
    }, 500);
  };

  /**
   * SSE接続を停止
   */
  const stopSSE = () => {
    if (eventSourceInstance) {
      eventSourceInstance.close();
      setEventSourceInstance(null);
    }
    setIsConnecting(false);
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-zinc-200">
      {/* ヘッダーセクション */}
      <header className="p-8 space-y-4 border-b border-white/5">
        <h1 className="text-2xl font-bold">SSE Event Stream</h1>
        <p className="text-sm text-zinc-400">
          リアルタイムイベントストリームの表示
        </p>

        {/* 開始/停止ボタン */}
        <div className="flex gap-3">
          <button
            onClick={startSSE}
            disabled={isConnecting}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700
              disabled:text-zinc-500 disabled:cursor-not-allowed rounded-lg
              transition-all duration-200 active:scale-[0.97]
              focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none
              shadow-sm hover:shadow-md"
            aria-label="SSE接続を開始"
          >
            {isConnecting ? '接続中...' : '接続開始'}
          </button>

          {isConnecting && (
            <button
              onClick={stopSSE}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg
                transition-all duration-200 active:scale-[0.97]
                focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none
                shadow-sm hover:shadow-md"
              aria-label="SSE接続を停止"
            >
              停止
            </button>
          )}
        </div>
      </header>

      {/* イベントリスト */}
      <div className="p-8">
        {events.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-zinc-500">
              「接続開始」ボタンをクリックしてイベントストリームを開始してください
            </p>
          </div>
        ) : (
          <ul
            role="log"
            aria-live="polite"
            aria-label="SSEイベントログ"
            className="space-y-4 max-h-[600px] overflow-y-auto"
          >
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
