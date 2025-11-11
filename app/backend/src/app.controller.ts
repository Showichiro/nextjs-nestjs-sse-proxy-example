import { Controller, Get, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * SSE（Server-Sent Events）エンドポイント
   * 複数のイベントを順次送信する
   */
  @Sse('sse')
  sse(): Observable<MessageEvent> {
    return new Observable((observer) => {
      let messageCount = 0;
      const maxMessages = 5;

      // 1. 接続イベント
      observer.next({
        data: JSON.stringify({
          type: 'connecting',
          message: 'SSE接続を確立しています...',
          timestamp: new Date().toISOString(),
        }),
      } as MessageEvent);

      // 2. メッセージイベントを定期的に送信
      const interval = setInterval(() => {
        messageCount++;
        observer.next({
          data: JSON.stringify({
            type: 'message',
            message: `メッセージ ${messageCount}/${maxMessages}`,
            data: {
              id: messageCount,
              content: `サンプルデータ ${messageCount}`,
              timestamp: new Date().toISOString(),
            },
          }),
        } as MessageEvent);

        // 3. 完了イベント
        if (messageCount >= maxMessages) {
          clearInterval(interval);
          observer.next({
            data: JSON.stringify({
              type: 'complete',
              message: 'すべてのイベント送信が完了しました',
              timestamp: new Date().toISOString(),
            }),
          } as MessageEvent);
          observer.complete();
        }
      }, 1000); // 1秒ごとにメッセージ送信

      // クリーンアップ
      return () => {
        clearInterval(interval);
      };
    });
  }
}
