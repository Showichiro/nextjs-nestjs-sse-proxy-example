## SSEイベントのモックアップ作成

frotend側でEventSourceを利用してNestJSのbackendSSEエンドポイントと接続する.

### 条件

- Next.jsのRouteHandler経由でバックエンドを呼び出す（フロントから直接バックエンドを呼び出さない）
- SSEのイベントは複数送信してUI側も切り替える