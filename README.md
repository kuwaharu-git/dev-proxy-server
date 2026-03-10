# dev-proxy-server

パスベースのルーティングとWebSocketに対応した、ローカル開発用のHTTPSリバースプロキシです。

## 機能

- 1つのYAML設定から複数のHTTPSポートを起動
- パスベースのルーティングに対応（`/*` の前方一致または完全一致、上から順に評価）
- `http-proxy` によるHTTPリバースプロキシ転送
- `server.on("upgrade")` によるWebSocket / Socket.IO対応
- `target` には `http://`、`https://`、`ws://`、`wss://` を指定可能
- 一致しないパスは `502 Bad Gateway` を返却
- ポートごとのリクエストログ出力

## 前提条件

- Node.js >= 14
- TLS証明書と秘密鍵のペア（例: [mkcert](https://github.com/FiloSottile/mkcert) で生成）

生成コマンド例:

```bash
mkcert -install && mkcert -cert-file cert.pem -key-file key.pem localhost 127.0.0.1 ::1
```

- `mkcert -install` は mkcert のローカルCAをOSの信頼ストアへ登録し、生成した証明書をブラウザやツールから信頼できるようにします。
- `-cert-file cert.pem` は証明書を `cert.pem` に出力します。
- `-key-file key.pem` は秘密鍵を `key.pem` に出力します。
- `localhost 127.0.0.1 ::1` は、よく使うローカルホスト名とループバックアドレスを証明書のSANに含めます。
- 出力されるファイル名は、`gateway.yaml` の既定設定と一致しています。

## インストール

```bash
npm install
npm link          # `dev-proxy` コマンドをグローバルに使えるようにする場合のみ
```

## 使い方

```bash
node index.js gateway.yaml
# または npm link 後:
dev-proxy gateway.yaml
```

### 出力例

```
[ROUTE] /socket.io/* → http://localhost:3000
[ROUTE] /api/* → http://localhost:3000
[ROUTE] / → http://localhost:3001
[INFO] HTTPS server started: https://localhost:3002
[INFO] HTTPS server started: https://localhost:3003

[3002] GET /api/users → http://localhost:3000
```

## 設定例 (`gateway.yaml`)

```yaml
tls:
  cert: cert.pem
  key: key.pem

https_ports:
  - port: 3002
    routes:
      - path: /socket.io/*
        target: http://localhost:3001

      - path: /api/*
        target: http://localhost:3001

      - path: /
        target: http://localhost:4001

  - port: 3003
    routes:
      - path: /
        target: http://localhost:3000

```

### WebSocket設定

- WebSocket用ルートは `/` のフォールバックより前に配置してください。
- `/ws/*` や `/socket.io/*` のような専用パスを使うと、upgradeリクエストを意図したバックエンドへ確実に振り分けられます。
- `target` は `http://localhost:3000` と `ws://localhost:3000` のどちらでも指定できます。

例:

```yaml
https_ports:
  - port: 3002
    routes:
      - path: /socket.io/*
        target: ws://localhost:3001

      - path: /api/*
        target: http://localhost:3001

      - path: /
        target: http://localhost:4001
```

### パスマッチングルール

| パターン    | 一致するパス                             |
|-------------|------------------------------------------|
| `/`         | すべてのパス（フォールバック用）         |
| `/api/*`    | `/api/` および `/api/anything`           |
| `/foo/bar`  | `/foo/bar` に完全一致                    |

ルートは **上から順に** 評価され、最初に一致したものが使われます。