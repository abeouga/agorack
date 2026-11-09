# Agorack（アゴラック）

業務の部品（文之助：帳票、カブロガー：走行の記録 など）を MCP で呼び分けて、利用者の質問に根拠付きで答えるチャットです。答えの根拠（書類のどの欄か、走行のどの区間か）を画面の右の欄に表示します。

## 守る約束

- 答えに使う値は、部品の道具が返したものだけ。推測で埋めたり、言い換えたりしない。
- 答えには、部品が返した根拠を必ず添える。
- Agorack では値を直さない。値の確認・修正は部品の画面で行う。
- 部品とは MCP だけでつなぎ、部品のコードを import しない。

## 構成

| 場所                 | 役目                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/web`           | 画面（Vite + React + TypeScript）                                                                 |
| `apps/server`        | サーバー（Node + TypeScript）。会話のループ・Claude の呼び出し・部品（MCP）の接続・根拠の取り出し |
| `packages/contracts` | 画面とサーバーの共通の契約（HTTP・SSE のイベント・根拠の型）                                      |
| `config/`            | つなぐ部品の設定の見本                                                                            |
| `docs/`              | 設計と決めごとの記録                                                                              |

詳しくは [設計](docs/architecture.md) と [決めごとの記録](docs/decisions/) を読んでください。

## 最初に打つコマンド

Node 22.12 以上と npm が要ります。

```bash
npm install          # 全部の workspace の依存を入れる
npm run check        # 型の検査・静的検査・書式の検査・試験をまとめて行う
```

個別に回すときは次のとおりです。

| コマンド | 内容 |
|---|---|
| `npm run typecheck` | 全部の workspace の型の検査（`tsc`） |
| `npm run lint` | 静的検査（ESLint）。画面とサーバーが互いを import していないかも確かめる |
| `npm run format` | 書式をそろえる（Prettier） |
| `npm run format:check` | 書式がそろっているかだけを確かめる |
| `npm test` | 全部の workspace の試験（Vitest） |

### サーバーを起動する

```bash
cp config/sources.example.json config/sources.json   # つなぐ部品の設定。手元の場所に合わせて直す
cp apps/server/.env.example apps/server/.env         # サーバーの設定（API キー・モデル・待ち受けの番号など）
npm run dev:server                                   # http://127.0.0.1:8787 で待ち受ける（tsx watch）
```

- `GET /api/health` が `{"status":"ok"}` を返せば動いています。
- 設定が足りない・形が違うときは、どのファイルのどの項目が悪いかを出して止まります。
- 受け付けるのは、画面の開発時の住所（`http://127.0.0.1:5174`・`http://localhost:5174`）からの要求だけです。
- 本番用は `npm run build -w @agorack/server` で `apps/server/dist/main.js` にまとめ、`npm run start -w @agorack/server` で起動します。

画面を起動するコマンドは、画面の土台（#9）で足します。

## 状態

設計を終え、最初の版を作っているところです。進み具合は Issue を見てください。
