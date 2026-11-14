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

詳しくは [設計](docs/architecture.md) と [決めごとの記録](docs/decisions/) を読んでください。Agorack とつなぐ部品（文之助・drive-logger）の設計の考え方・仕組み・ロジック、3つの開発の経緯は、解説のリポジトリ [abeouga/agorack-handbook](https://github.com/abeouga/agorack-handbook) にあります。

開発中の論点・作業の段取り・手元の運用のメモは、開発用の文書のリポジトリ [abeouga/agorack-document](https://github.com/abeouga/agorack-document)（非公開）の `agorack/` に置いています。

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

### 画面を開く

画面は `http://127.0.0.1:5174` で開きます（5173 は文之助の画面）。

| コマンド | 内容 |
|---|---|
| `npm run dev:web` | 画面を開く。`/api` はサーバー（`http://127.0.0.1:8787`）へ中継する |
| `npm run dev:mock -w @agorack/web` | 決まったイベントを流す偽のサーバーで画面を開く（サーバーなしで試せる） |
| `npm run screenshots -w @agorack/web` | 偽のサーバーにつないだ画面を、手元の Microsoft Edge で撮る（出力は `apps/web/screenshots/`） |
| `npm run end-to-end -w @agorack/web` | 動いている本物の画面に通しの確認の4問を送り、答え・根拠・スクショを残す（Claude の API を使う。`-- 1 3` で問いを選べる） |

偽のサーバーは、質問の言葉で流すイベントを選びます（`apps/web/dev/mock-api/scenarios.ts`）。

| 質問に含める言葉 | 流れるもの |
|---|---|
| （下のどれも含まない） | 根拠付きの答え（表あり。こよみの売却子牛の価格の枠が出る） |
| 「毛色」「父」「母」 | 書類の欄の根拠（get_document） |
| 「画像」 | ページ画像の読めない根拠（ラベルと値の表示に戻る） |
| 「走行」 | 画面が表示を知らない kind の根拠（ラベルと値だけ） |
| 「失敗」「見つから」 | 道具の失敗（書類が見つからない） |
| 「障害」「エラー」 | `turn.failed`（Claude の呼び出しの失敗） |
| 「ゆっくり」「止め」 | 時間のかかる答え（停止を試す） |

書類のページ画像は、手元の文之助（`http://127.0.0.1:8010`）から読みます。

### 画面とサーバーを一緒に起動する

```bash
npm run dev    # サーバー（8787）と画面（5174）を一緒に起動する。片方が起動できなければ両方止める
```

上の「サーバーを起動する」の設定（`config/sources.json`・`apps/server/.env`）を先に作っておきます。2つの出力は、頭に名前を付けずにそのまま出します（名前を付ける形では、サーバーの `tsx watch` が起動の途中で止まるため）。

## 状態

設計を終え、最初の版を作っているところです。進み具合は Issue を見てください。
