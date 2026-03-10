# dev-proxy-server

Local development HTTPS reverse proxy with path-based routing and WebSocket support.

## Features

- Multiple HTTPS ports from a single YAML config
- Path-based routing (prefix `/*` or exact match), evaluated top-to-bottom
- HTTP reverse proxy forwarding with `http-proxy`
- WebSocket / Socket.IO upgrade support via `server.on("upgrade")`
- `target` accepts `http://`, `https://`, `ws://`, and `wss://`
- Unmatched paths return `502 Bad Gateway`
- Request logging per port

## Prerequisites

- Node.js >= 14
- A TLS certificate + key pair (e.g. generated with [mkcert](https://github.com/FiloSottile/mkcert))

## Installation

```bash
npm install
npm link          # makes `dev-proxy` available globally (optional)
```

## Usage

```bash
node index.js gateway.yaml
# or, after npm link:
dev-proxy gateway.yaml
```

### Output example

```
[ROUTE] /socket.io/* → http://localhost:3000
[ROUTE] /api/* → http://localhost:3000
[ROUTE] / → http://localhost:3001
[INFO] HTTPS server started: https://localhost:3002
[INFO] HTTPS server started: https://localhost:3003

[3002] GET /api/users → http://localhost:3000
```

## Configuration (`gateway.yaml`)

```yaml
tls:
  cert: cert.pem   # path to TLS certificate
  key: key.pem     # path to TLS private key

https_ports:
  - port: 3002
    routes:
      - path: /socket.io/*     # prefix match
        target: http://localhost:3000

      - path: /api/*           # prefix match
        target: http://localhost:3000

      - path: /                # fallback (matches everything)
        target: http://localhost:3001

  - port: 3003
    routes:
      - path: /ws/*
        target: ws://localhost:4000

      - path: /
        target: http://localhost:4001
```

### WebSocket configuration

- Put WebSocket routes before the `/` fallback route.
- Use a dedicated path such as `/ws/*` or `/socket.io/*` so upgrade requests match the intended backend.
- `target` can be written as `http://localhost:3000` or `ws://localhost:3000`. Both are accepted.

Example:

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

### Path matching rules

| Pattern      | Matches                                  |
|--------------|------------------------------------------|
| `/`          | Every path (use as fallback)             |
| `/api/*`     | `/api/` and `/api/anything`              |
| `/foo/bar`   | Exactly `/foo/bar`                       |

Routes are evaluated **top-to-bottom**; the first match wins.