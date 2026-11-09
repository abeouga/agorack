# 0001 TypeScript の monorepo（画面は Vite + React、サーバーは Node）

- 状態：決定
- 日付：2026-11-09

## 決めること

Agorack の画面とサーバーを、どの言語・どの構成で作るか。

## 背景

- Agorack が持つ処理は、会話のループ・部品（MCP）の呼び出し・画面への流し込みだけで、画像処理や機械学習の部品は使わない。
- 部品（文之助・カブロガー）はどちらも Python（FastAPI）で、画面は Vite + React + TypeScript。
- チャットの画面は文之助のもの（Vite + React）から移す。

## 選択肢

| 案 | 長所 | 短所 |
|---|---|---|
| TypeScript（Vite + Node） | 画面と同じ言語で、根拠や SSE のイベントの型を共有できる。MCP の TypeScript SDK は公式の参照実装で、いちばん整っている。文之助のチャットをそのまま移せる | 業務の基幹システムとしての例は Java より少ない |
| Java（Spring Boot） | Spring AI と MCP の Java SDK で必要なことは足りる。業務システムに乗せる形を示しやすい | 画面と言語が違い、型を共有できない。例が少なく、ビルドも重め |
| Python（FastAPI） | AI の部品がいちばん多い | 部品と同じ言語で、部品のコードを流用したくなり、境界が崩れやすい |
| Next.js でまとめる | 画面とサーバーが1つのアプリで済む | 文之助のチャットを Next.js の作りに合わせて書き直す必要がある。画面とサーバーの境目があいまいになりやすい |

## 決定

TypeScript の monorepo（npm workspaces）にする。

- `apps/web`：Vite + React
- `apps/server`：Node（HTTP は軽い枠組みを使う）
- `packages/contracts`：画面とサーバーの共通の契約（型と検証のスキーマ）

部品とは MCP だけでつなぎ、部品のコードは import しない。言語が部品と違うことは、この境界を守る助けにもなる。

## 影響

- 画面とサーバーが同じ契約の型を使うので、SSE のイベントや根拠の形の食い違いを型の検査で見つけられる。
- 部品が Python のままでも、MCP でつながるので影響はない。
