# Tenjo

LM Studio / Ollama などのローカルLLMサーバーに対応した、セルフホスト型のAIチャット・エージェント環境です。MCP（Model Context Protocol）、Web検索、知識、コード実行、ブラウザ/GUIプレビューに対応しています。

<table align="center">
  <tr>
    <td colspan="2" align="center"><img width="520" alt="スクリーンショット" src="https://github.com/user-attachments/assets/699ff1a9-e691-4319-a7a1-7554e9656c12" /></td>
  </tr>
  <tr>
    <td><img width="240" alt="スクリーンショット" src="https://github.com/user-attachments/assets/0b1f2045-7e77-43dc-9e76-c1c85697d7b5" /></td>
    <td><img width="240" alt="スクリーンショット" src="https://github.com/user-attachments/assets/699b0fc8-5b85-473c-9e11-d3793b578625" /></td>
  </tr>
  <tr>
    <td><img width="240" alt="スクリーンショット" src="https://github.com/user-attachments/assets/1a3eeb45-b930-4f7c-b730-e50139422ea6" /></td>
    <td><img width="240" alt="スクリーンショット" src="https://github.com/user-attachments/assets/6bff6897-adbe-4f71-a739-589aeaca8353" /></td>
  </tr>
</table>

## 必要なソフトウェア

- Node.js（v24推奨）
- PostgreSQL（v18推奨）
- Docker

## セットアップ

### 1. 依存パッケージのインストール

初回セットアップでは、基本的に次を実行してください。

```bash
npm run setup
```

これは各workspaceの依存関係を `npm ci` でインストールしたあと、`npm -w chat-engine run setup:browser-deps` で Playwright Chromium の実行に必要なOSパッケージをインストールします。Web検索やブラウザ操作を使う場合はこちらを使ってください。

コアのチャットUIだけを使う場合や、Chromiumの実行環境がすでに整っている場合は次でも構いません。

```bash
npm ci
```

### 2. 環境変数の設定

サンプルから `server/.env` を作成し、環境に合わせて値を変更してください。

```bash
cp server/.env.sample server/.env
```

設定例:

```
NODE_ENV=production
DATABASE_URL=postgresql://user:password@localhost:5432/tenjo
DATABASE_SCHEMA=tenjo
SESSION_SECRET=your-secret-key-here
LISTEN_HOST=127.0.0.1
LISTEN_PORT=3000
ENCRYPTION_KEY=your-encryption-key-here
BASE_URL=https://chat.example.com
```

| 変数 | 説明 |
|---|---|
| `NODE_ENV` | `development`、`production`、`test` のいずれか |
| `DATABASE_URL` | PostgreSQL接続文字列 |
| `DATABASE_SCHEMA` | PostgreSQLスキーマ名。未指定時は `public` |
| `SESSION_SECRET` | セッション暗号化に使用するシークレット |
| `LISTEN_HOST` | バインドするホストアドレス |
| `LISTEN_PORT` | 待ち受けるポート番号 |
| `DATA_DIR` | データディレクトリのパス（デフォルト: サーバー実行ディレクトリ直下の `files/`） |
| `SINGLE_USER_MODE` | `true` に設定するとシングルユーザーモードで動作 |
| `ENCRYPTION_KEY` | DBに保存される認証情報（APIキー、OAuthトークン等）の暗号化キー |
| `BASE_URL` | アプリケーションの公開ベースURL |

### 3. ビルドと起動

```bash
npm run build
npm start
```
## 開発

```bash
npm run dev
```

> **注意:** 開発時は環境変数 `LISTEN_PORT` を `3000` にしてください。Viteの開発サーバーはAPIリクエストを `localhost:3000` にプロキシするため、ポートを変更するとプロキシが動作しなくなります。

## サンドボックス（エージェント）

エージェントはサンドボックスコンテナ内で動作するため、Dockerが必要です。

Linuxでは、Tenjoのサーバープロセスの実行ユーザーにDockerを操作する権限が必要です。たとえば、そのユーザーを `docker` グループに追加するなどの設定が必要です。

Tenjoは以下のDockerリソースを作成・管理します。

- コンテナ: `tenjo-sandbox`
- イメージ: `tenjo-agent-sandbox:*`
- ボリューム: `tenjo-sandbox-data`

## FAQ

**ユーザーを追加するには？**
最初に登録したユーザーが自動的に管理者になります。それ以降の登録には招待コードが必要です。管理者は設定画面から招待コードの発行・管理ができます。招待コードは1回限り有効で、新規ユーザーのロール（管理者/一般）を指定できます。

**画像を含むプロンプトがうまく動かない**
接続先のモデルがビジョンに対応している必要があります。画像を使用する場合はビジョン対応モデルを使用してください。

**MCPのツールが動かない**
接続先のモデルがfunction callingに対応している必要があります。対応していないモデルではツール呼び出しは機能しません。対応していても、モデルの性能によってはうまく呼び出せないことがあります。

## ライセンス

[MIT](LICENSE) &copy; netalkGB
