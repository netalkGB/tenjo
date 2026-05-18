# Tenjo

複数のAIプロバイダー（LM Studio、Ollama）、MCP（Model Context Protocol）、Web検索機能、コード実行機能、HTMLプレビュー機能に対応したセルフホスト型AIチャットインターフェースです。

<table align="center">
  <tr>
    <td colspan="2" align="center"><img width="600" alt="スクリーンショット" src="https://github.com/user-attachments/assets/7fbdc9fa-9785-4be3-97b8-4ab28b1053f7" /></td>
  </tr>
  <tr>
    <td><img width="450" alt="スクリーンショット" src="https://github.com/user-attachments/assets/12852608-122a-4f4d-9bba-6c717ee2b800" /></td>
    <td><img width="450" alt="スクリーンショット" src="https://github.com/user-attachments/assets/3c81b0d9-28df-4f31-836e-ad4d396b380a" /></td>
  </tr>
</table>

## 必要なソフトウェア

- Node.js（v24推奨）
- PostgreSQL（v18推奨）

## セットアップ

### 1. 依存パッケージのインストール

**ブラウザエージェント（Web検索機能）を使用する場合:**

```bash
npm run setup
```

すべての依存パッケージをインストールし、ブラウザエージェントに必要なChromiumもインストールします。

**ブラウザエージェントを使用しない場合:**

```bash
npm ci
```

### 2. 環境変数の設定

`server/.env` を作成してください。以下は設定例です。値はご自身の環境に合わせて変更してください。

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
| `DATABASE_URL` | PostgreSQL接続文字列 |
| `DATABASE_SCHEMA` | PostgreSQLスキーマ名 |
| `SESSION_SECRET` | セッション暗号化に使用するシークレット |
| `LISTEN_HOST` | バインドするホストアドレス |
| `LISTEN_PORT` | 待ち受けるポート番号 |
| `DATA_DIR` | データディレクトリのパス（デフォルト: サーバー実行ディレクトリ直下の `files/`） |
| `SINGLE_USER_MODE` | `true` に設定するとシングルユーザーモードで動作 |
| `ENCRYPTION_KEY` | DBに保存される認証情報（APIキー、OAuthトークン等）の暗号化キー |
| `BASE_URL` | アプリケーションの公開ベースURL（例: `https://chat.example.com`） |

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

## FAQ

**ユーザーを追加するには？**
最初に登録したユーザーが自動的に管理者になります。それ以降の登録には招待コードが必要です。管理者は設定画面から招待コードの発行・管理ができます。招待コードは1回限り有効で、新規ユーザーのロール（管理者/一般）を指定できます。

**画像を含むプロンプトがうまく動かない**
接続先のモデルがビジョンに対応している必要があります。画像を使用する場合はビジョン対応モデルを使用してください。

**MCPのツールが動かない**
接続先のモデルがfunction callingに対応している必要があります。対応していないモデルではツール呼び出しは機能しません。対応していても、モデルの性能によってはうまく呼び出せないことがあります。

## ライセンス

[MIT](LICENSE) &copy; netalkGB
