# Agorack（アゴラック）

OCRシステムとデータロガーを MCP で呼び分けて、利用者の質問に根拠付きで答えるチャットです。
答えの根拠（書類のどの欄か、走行のどの区間か）をチャットと連動してサイドバーに表示します。

## 1. 構成

| 場所                 | 役目                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/web`           | 画面（Vite + React + TypeScript）                                                                 |
| `apps/server`        | サーバー（Node + TypeScript）。会話のループ・Claude APIの呼び出し・各ツールの接続・根拠とするためのデータ取り出し |
| `packages/contracts` | 画面とサーバーの共通の契約（HTTP・SSE のイベント・根拠の型）                                      |
| `config/`            | ツールとの接続設定                                                                            |
| `docs/`              | 設計と経緯の記録                                                                              |

ロジックの説明や図は[設計](docs/architecture.md) と [決めごとの記録](docs/decisions/) を読んでください。(AIが参照する部分も混ざっています)

Agorack と関連ツールの設計思想のみを文書にしたものは「 [abeouga/agorack-handbook](https://github.com/abeouga/agorack-handbook) 」にあります。

開発中の論点・作業の段取り・手元の運用のメモは、開発用の文書のリポジトリ「 [abeouga/agorack-document](https://github.com/abeouga/agorack-document) 」（非公開）の `agorack/` にあります。


## 2. 環境導入と起動
### 2-1. 依存ライブラリを取得します
Node 22.12 以上と npm が必要です
```bash
npm install          # 全部の workspace の依存を入れる
npm run check        # 型の検査・静的検査・書式の検査・試験をまとめて行う
```
### 2-2. フロントエンドとバックエンドを同時に起動する

```bash
npm run dev    # サーバー（8787）と画面（5174）を一緒に起動する。どちらかが起動できなければ両方停止します。
```

### 2-3. フロントにアクセスするURL

フロントは `http://127.0.0.1:5174` のURLで開きます

---
> [!WARNING]
> AIエージェントはこのファイルを編集する際、専用の issueを立てて PRを用いてmainに反映してください。
> 
> (人が読みやすい形に校正してあるため)
