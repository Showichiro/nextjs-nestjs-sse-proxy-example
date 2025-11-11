## SSEイベントのモックアップ作成

frontend側でEventSourceを利用してNestJSのbackendSSEエンドポイントと接続する.

### 条件

- Next.jsのRouteHandler経由でバックエンドを呼び出す（フロントから直接バックエンドを呼び出さない）
- SSEのイベントは複数送信してUI側も切り替える

---

## アーキテクチャ概要

### システム構成

```
┌─────────────────┐
│  フロントエンド  │  Vercel (Next.js 16)
│  /app/page.tsx  │  ・EventSourceでSSE受信
│  /api/sse/*    │  ・Route HandlerでProxy
│  /api/events/* │  ・イベント一覧取得
└────────┬────────┘
         │ SSE / HTTP
         ↓
┌─────────────────┐
│  バックエンド    │  Google Cloud Run (NestJS)
│  /sse           │  ・RxJS ObservableでSSE送信
│  /events        │  ・Prisma + SQLiteでイベント保存
└─────────────────┘
```

### データフロー

1. **SSE接続開始**
   - フロントエンド: `EventSource('/api/sse')` で接続
   - Route Handler: バックエンドの `/sse` にプロキシ
   - バックエンド: 既存イベントをすべて削除 (`deleteMany()`)

2. **イベント送信**
   - バックエンド: RxJS Observableで以下を順次送信
     - `connecting` イベント（接続開始）
     - `message` イベント × 5回（1秒間隔）
     - `complete` イベント（送信完了）
   - 各イベントはPrismaでDBに保存

3. **接続クローズ**
   - フロントエンド: `complete` イベント受信時に即座に `eventSource.close()`
   - これにより、サーバー側の `observer.complete()` 前にクライアント側で接続を切断
   - レースコンディションを回避（`onerror` が誤発火しない）

4. **イベント一覧表示**
   - SSE完了後、自動的に `/api/events` からDBに保存されたイベントを取得
   - 保存済みイベントを時系列で表示

---

## 実装の変遷（コミット履歴より）

### v1: 初期実装
**コミット**: `f598b54` - SSE機能の初期実装
- NestJSの`@Sse`デコレータでSSEエンドポイントを実装
- Next.js Route HandlerでProxy層を構築
- EventSourceでクライアント側のSSE受信を実装

### v2: イベント永続化
**コミット**: `eeb421e` - eventsエンドポイント追加とDBロギング強化
- Prisma + SQLiteでイベントをDBに保存
- GET `/events` エンドポイントで保存済みイベントを取得
- フロントエンドに保存済みイベント表示UIを追加

### v3: エラーハンドリング改善
**コミット**: `7f8483c` - SSE正常終了とエラーを区別
- `EventSource.readyState === EventSource.CLOSED` で正常終了を判定
- 実際のエラー時のみエラーイベントを追加
- `onerror` の誤発火を防止

**コミット**: `45955a5` - completeイベントで即座に接続クローズ
- `onmessage` 内で `complete` イベントを検知したら即座に `eventSource.close()`
- `checkComplete` ポーリング間隔を削除（不要になった）
- サーバー側の `observer.complete()` 前にクライアント側で接続を切断

### v4: UI/UX改善
**コミット**: `4ee5cf7` - SSE完了後の保存イベント表示機能
- SSE完了時に自動的に `/api/events` から保存済みイベントを取得
- 手動リロードボタンを追加
- イベントタイプ別のアイコンとカラーリング

**コミット**: `0575230` - SSEストリーム開始前にイベントクリア
- SSE開始時に `deleteMany()` で既存イベントをすべて削除
- 前回実行時のノイズを防止
- 削除件数をコンソールにログ出力

---

## クラウドデプロイ時の考慮事項

### 前提
- **フロントエンド**: Vercel (Next.js)
- **バックエンド**: Google Cloud Run (NestJS)

### ⚠️ 重大な問題

#### 1. 【最重要】SQLiteの互換性問題 ❌

**問題点**:
- Cloud Runはエフェメラルファイルシステムを使用
- インスタンス再起動時にSQLiteファイル (`dev.db`) が消失
- 複数インスタンスが起動した場合、DBファイルが共有されない
- スケールアウト時にデータが一貫性を失う

**対策**:
```typescript
// prisma/schema.prisma を変更
datasource db {
  provider = "postgresql"  // SQLiteから変更
  url      = env("DATABASE_URL")
}
```

**推奨マネージドDB**:
- Cloud SQL (PostgreSQL)
- PlanetScale (MySQL)
- Supabase (PostgreSQL)
- Neon (PostgreSQL)

**移行手順**:
1. マネージドDBのインスタンスを作成
2. `DATABASE_URL` 環境変数をCloud Runに設定
3. `prisma/schema.prisma` のproviderを変更
4. `bunx prisma migrate dev` でマイグレーション実行

---

### タイムアウト問題

#### Vercelのタイムアウト制限 ⚠️

**問題点**:
- Hobby Plan: 10秒
- Pro Plan: 60秒
- 現在の実装: 約6秒（1秒×5メッセージ + 接続時間）
  → Hobbyプランでもギリギリ動作するが、メッセージ数を増やすとタイムアウトの可能性

**対策**:
1. **メッセージ送信間隔を調整** (推奨)
   ```typescript
   // app.controller.ts
   const interval = setInterval(() => {
     // ...
   }, 500); // 1000ms → 500ms に短縮
   ```

2. **Edge Runtimeを使用** (推奨)
   ```typescript
   // app/api/sse/route.ts
   export const runtime = 'edge'; // 追加
   ```

3. **Vercel Proプランにアップグレード**
   - 60秒のタイムアウト制限

4. **フロントエンドから直接Cloud Runに接続** (CORS設定が必要)
   ```typescript
   // app/page.tsx
   const eventSource = new EventSource(
     'https://your-cloud-run-url.run.app/sse'
   );
   ```

#### Cloud Runのタイムアウト設定

**デフォルト**: 300秒（5分）
**最大**: 3600秒（1時間）

長時間のSSE接続を想定する場合は調整可能:
```bash
gcloud run deploy backend \
  --timeout=3600 \
  --max-instances=10
```

---

### ストリーミングレスポンスのバッファリング ⚠️

**問題点**:
- Vercel Node.js Runtimeではストリーミングレスポンスがバッファリングされる可能性
- リアルタイム性が失われる
- プロキシチェーン（フロントエンド → Vercel → Cloud Run）で2段階のバッファリング

**対策**:
1. **Edge Runtimeを使用** (推奨)
   ```typescript
   // app/api/sse/route.ts
   export const runtime = 'edge';

   export async function GET() {
     const backendUrl = process.env.BACKEND_URL || 'http://localhost:3100';
     const response = await fetch(`${backendUrl}/sse`);

     return new Response(response.body, {
       headers: {
         'Content-Type': 'text/event-stream',
         'Cache-Control': 'no-cache',
         'Connection': 'keep-alive',
         'X-Accel-Buffering': 'no', // Nginxバッファリング無効化
       },
     });
   }
   ```

2. **フロントエンドから直接Cloud Runに接続**
   - プロキシ層を経由しないため、バッファリングが発生しない
   - ただし、CORS設定が必要

---

### Cold Start問題（Cloud Run）⚠️

**問題点**:
- 最小インスタンス数が0の場合、リクエストがないとインスタンスがシャットダウン
- 次回リクエスト時にCold Start（数秒の起動時間）が発生
- SSE接続中にCold Startが発生すると、接続が切れる可能性

**対策**:
1. **最小インスタンス数を1以上に設定** (推奨、ただしコスト増)
   ```bash
   gcloud run deploy backend \
     --min-instances=1 \
     --max-instances=10
   ```

2. **Keep-alive pingを実装**
   ```typescript
   // app.controller.ts
   @Sse('sse')
   sse(): Observable<MessageEvent> {
     return new Observable((observer) => {
       // 定期的にpingイベントを送信
       const pingInterval = setInterval(() => {
         observer.next({
           data: JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }),
         } as MessageEvent);
       }, 30000); // 30秒ごと

       // ...

       return () => {
         clearInterval(pingInterval);
       };
     });
   }
   ```

3. **Vercel Cron Jobでウォームアップ**
   ```typescript
   // app/api/warmup/route.ts
   export async function GET() {
     const backendUrl = process.env.BACKEND_URL;
     await fetch(`${backendUrl}/health`);
     return new Response('OK');
   }
   ```

   ```json
   // vercel.json
   {
     "crons": [{
       "path": "/api/warmup",
       "schedule": "*/5 * * * *"
     }]
   }
   ```

---

### 環境変数の設定 ✅

**必須設定**:

1. **Vercel環境変数**
   ```bash
   BACKEND_URL=https://your-cloud-run-url.run.app
   ```

2. **Cloud Run環境変数**
   ```bash
   DATABASE_URL=postgresql://user:password@host:port/database
   PORT=3100
   NODE_ENV=production
   ```

**設定方法**:
```bash
# Vercel
vercel env add BACKEND_URL production

# Cloud Run
gcloud run deploy backend \
  --set-env-vars DATABASE_URL="postgresql://..." \
  --set-env-vars NODE_ENV=production
```

---

### CORS設定（必要に応じて）

**フロントエンドから直接Cloud Runに接続する場合のみ必要**

```typescript
// app/backend/src/main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS設定
  app.enableCors({
    origin: [
      'https://your-vercel-app.vercel.app',
      'http://localhost:3000', // 開発環境用
    ],
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.listen(process.env.PORT ?? 3100);
}
```

**Route Handler経由の場合（現在の実装）はCORS不要** ✅

---

### マルチユーザー対応の問題 ⚠️

**現在の問題点**:
- SSE開始時に `deleteMany()` で**全ユーザーのイベント**を削除
- 複数ユーザーが同時にSSEを開始すると、他のユーザーのイベントも削除される

**対策**:
1. **セッションIDでイベントを分離** (推奨)
   ```typescript
   // prisma/schema.prisma
   model Event {
     id        Int      @default(autoincrement()) @id
     sessionId String   // 追加
     type      String
     message   String
     data      String?
     timestamp DateTime @default(now())

     @@index([sessionId]) // インデックス追加
   }
   ```

   ```typescript
   // app.controller.ts
   @Sse('sse')
   sse(@Query('sessionId') sessionId: string): Observable<MessageEvent> {
     return new Observable((observer) => {
       // セッションID別に削除
       this.prisma.event.deleteMany({
         where: { sessionId },
       });

       // イベント保存時にsessionIdを含める
       this.prisma.event.create({
         data: {
           sessionId,
           type: 'connecting',
           message: 'SSE接続を確立しています...',
         },
       });
     });
   }
   ```

2. **TTL（Time To Live）で自動削除**
   ```typescript
   // 古いイベントを削除（例: 1時間前より古いもの）
   this.prisma.event.deleteMany({
     where: {
       timestamp: {
         lt: new Date(Date.now() - 3600000),
       },
     },
   });
   ```

---

### 接続の安定性 ⚠️

**問題点**:
- プロキシチェーン: フロントエンド → Vercel Route Handler → Cloud Run
- 2つのプロキシを経由するため、接続が切れやすい
- インターネット経由の長時間接続は不安定

**対策**:
1. **ハートビート/Ping機能** (推奨)
   ```typescript
   // app.controller.ts
   const pingInterval = setInterval(() => {
     observer.next({
       data: JSON.stringify({ type: 'ping' }),
     } as MessageEvent);
   }, 30000); // 30秒ごと
   ```

2. **自動再接続機能**
   ```typescript
   // app/page.tsx
   const startSSE = () => {
     const eventSource = new EventSource('/api/sse');

     eventSource.onerror = () => {
       if (eventSource.readyState === EventSource.CLOSED) {
         // 自動再接続
         setTimeout(() => {
           console.log('Reconnecting...');
           startSSE();
         }, 3000);
       }
     };
   };
   ```

3. **WebSocketへの移行を検討**
   - SSEは単方向通信
   - 双方向通信が必要な場合はWebSocketが適切
   - Vercel、Cloud RunともにWebSocketをサポート

---

### コスト最適化 💰

**問題点**:
- SSEは長時間接続を維持するため、サーバーレス関数の実行時間が長くなる
- Vercel: 実行時間に応じて課金
- Cloud Run: CPU時間、メモリ使用量、リクエスト数に応じて課金

**対策**:
1. **イベント送信間隔を最適化**
   - 現在: 1秒間隔 → 必要に応じて調整

2. **メッセージ数を最小限に**
   - 現在: 5メッセージ → 必要な分だけ

3. **Polling方式への移行を検討**
   - 短いポーリング間隔（例: 5秒）でイベントを取得
   - SSEほどリアルタイム性は高くないが、コスト削減

4. **Cloud Run最大インスタンス数を制限**
   ```bash
   gcloud run deploy backend \
     --max-instances=5 \
     --concurrency=80
   ```

---

### スケーリング設定 📊

**Cloud Run推奨設定**:
```bash
gcloud run deploy backend \
  --min-instances=1 \          # Cold Start回避
  --max-instances=10 \         # コスト制限
  --concurrency=80 \           # 同時リクエスト数
  --cpu=1 \                    # CPU割り当て
  --memory=512Mi \             # メモリ割り当て
  --timeout=300                # タイムアウト（5分）
```

**Vercel推奨設定**:
- Edge Runtimeを使用
- Proプラン以上（タイムアウト60秒）

---

## デプロイ手順

### 1. データベース移行（必須）

```bash
# マネージドDBインスタンスを作成（例: Cloud SQL）
gcloud sql instances create sse-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=asia-northeast1

# Prismaスキーマを変更
# prisma/schema.prisma: provider = "postgresql"

# マイグレーション実行
bunx prisma migrate dev --name init
```

### 2. バックエンドデプロイ（Cloud Run）

```bash
cd app/backend

# Docker イメージをビルド
gcloud builds submit --tag gcr.io/PROJECT_ID/backend

# Cloud Runにデプロイ
gcloud run deploy backend \
  --image gcr.io/PROJECT_ID/backend \
  --platform managed \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars DATABASE_URL="postgresql://..." \
  --min-instances=1 \
  --max-instances=10 \
  --timeout=300
```

### 3. フロントエンドデプロイ（Vercel）

```bash
cd app/frontend

# 環境変数を設定
vercel env add BACKEND_URL production
# 値: https://backend-xxxxx.run.app

# デプロイ
vercel --prod
```

---

## 監視とログ

### Cloud Run
```bash
# ログ確認
gcloud run services logs read backend --limit=100

# メトリクス確認
gcloud monitoring dashboards list
```

### Vercel
- Vercel Dashboardでログとメトリクスを確認
- Edge Runtimeを使用している場合、ログは制限される

---

## テスト項目

### ローカル環境
- [ ] SSE接続が正常に確立される
- [ ] イベントが順次送信される
- [ ] `complete`イベント後に接続がクローズされる
- [ ] 保存済みイベントが表示される

### クラウド環境
- [ ] Vercel → Cloud Runの接続が成功する
- [ ] タイムアウトが発生しない
- [ ] ストリーミングがバッファリングされない
- [ ] Cold Startが適切に処理される
- [ ] 複数ユーザーの同時接続が動作する
- [ ] DBが永続化される（再起動後もデータが残る）
- [ ] CORS設定が正しく動作する（直接接続の場合）
- [ ] ログが正しく出力される

---

## トラブルシューティング

### SSE接続がタイムアウトする
→ Vercel Edge Runtimeを使用、またはメッセージ送信間隔を短縮

### イベントがリアルタイムで届かない
→ ストリーミングバッファリングが発生している可能性。Edge Runtimeを使用

### Cloud Runインスタンスが起動しない
→ Cold Start。最小インスタンス数を1に設定

### DBデータが消失する
→ SQLiteを使用している。マネージドDB（PostgreSQL）に移行

### 複数ユーザーのイベントが混在する
→ セッションIDでイベントを分離する実装を追加

---

## 参考資料

- [Next.js Route Handler](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [Vercel Edge Runtime](https://vercel.com/docs/functions/edge-functions)
- [Google Cloud Run](https://cloud.google.com/run/docs)
- [NestJS SSE](https://docs.nestjs.com/techniques/server-sent-events)
- [Prisma](https://www.prisma.io/docs)
- [EventSource API](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)