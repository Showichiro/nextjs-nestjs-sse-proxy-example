import { Controller, Get, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * 登録されたEventレコードを全件取得するエンドポイント
   * タイムスタンプの降順でソートして返す
   */
  @Get('events')
  async getEvents() {
    const events = await this.prisma.event.findMany({
      orderBy: {
        timestamp: 'desc',
      },
    });

    console.log(`[GET /events] ${events.length}件のイベントを取得しました`);

    return events;
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

      // 0. 既存のイベントレコードをすべて削除（ノイズ防止）
      this.prisma.event
        .deleteMany()
        .then((result) => {
          console.log(`[DB削除] ${result.count}件の既存イベントを削除しました`);
        })
        .catch((err) => {
          console.error('[DB削除エラー]:', err);
        });

      // 1. 接続イベント
      const connectingEvent = {
        type: 'connecting',
        message: 'SSE接続を確立しています...',
        timestamp: new Date().toISOString(),
      };

      // データベースに保存（awaitを使用して成功時にログ出力）
      this.prisma.event
        .create({
          data: {
            type: connectingEvent.type,
            message: connectingEvent.message,
          },
        })
        .then((savedEvent) => {
          console.log(
            `[DB保存成功] ID: ${savedEvent.id}, Type: ${savedEvent.type}, Message: ${savedEvent.message}`,
          );
        })
        .catch((err) => {
          console.error('[DB保存エラー] connecting event:', err);
        });

      observer.next({
        data: JSON.stringify(connectingEvent),
      } as MessageEvent);

      // 2. メッセージイベントを定期的に送信
      const interval = setInterval(() => {
        messageCount++;
        const messageEvent = {
          type: 'message',
          message: `メッセージ ${messageCount}/${maxMessages}`,
          data: {
            id: messageCount,
            content: `サンプルデータ ${messageCount}`,
            timestamp: new Date().toISOString(),
          },
        };

        // データベースに保存（awaitを使用して成功時にログ出力）
        this.prisma.event
          .create({
            data: {
              type: messageEvent.type,
              message: messageEvent.message,
              data: JSON.stringify(messageEvent.data),
            },
          })
          .then((savedEvent) => {
            console.log(
              `[DB保存成功] ID: ${savedEvent.id}, Type: ${savedEvent.type}, Message: ${savedEvent.message}, Data: ${savedEvent.data}`,
            );
          })
          .catch((err) => {
            console.error('[DB保存エラー] message event:', err);
          });

        observer.next({
          data: JSON.stringify(messageEvent),
        } as MessageEvent);

        // 3. 完了イベント
        if (messageCount >= maxMessages) {
          clearInterval(interval);
          const completeEvent = {
            type: 'complete',
            message: 'すべてのイベント送信が完了しました',
            timestamp: new Date().toISOString(),
          };

          // データベースに保存（awaitを使用して成功時にログ出力）
          this.prisma.event
            .create({
              data: {
                type: completeEvent.type,
                message: completeEvent.message,
              },
            })
            .then((savedEvent) => {
              console.log(
                `[DB保存成功] ID: ${savedEvent.id}, Type: ${savedEvent.type}, Message: ${savedEvent.message}`,
              );
            })
            .catch((err) => {
              console.error('[DB保存エラー] complete event:', err);
            });

          observer.next({
            data: JSON.stringify(completeEvent),
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
