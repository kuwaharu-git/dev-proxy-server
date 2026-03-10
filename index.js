#!/usr/bin/env node

"use strict";

const fs = require("fs");
const https = require("https");
const httpProxy = require("http-proxy");
const YAML = require("yaml");

// ─── CLI argument parsing ────────────────────────────────────────────────────

const configFile = process.argv[2];

if (!configFile) {
  console.error("Usage: dev-proxy <config.yaml>");
  process.exit(1);
}

// ─── Load configuration ──────────────────────────────────────────────────────

let config;
try {
  const raw = fs.readFileSync(configFile, "utf8");
  config = YAML.parse(raw);
} catch (err) {
  console.error(`[ERROR] Failed to read config file "${configFile}": ${err.message}`);
  process.exit(1);
}

const { tls, https_ports } = config;

if (!tls || !tls.cert || !tls.key) {
  console.error("[ERROR] Config must include tls.cert and tls.key");
  process.exit(1);
}

if (!Array.isArray(https_ports) || https_ports.length === 0) {
  console.error("[ERROR] Config must include at least one entry in https_ports");
  process.exit(1);
}

// ─── Load TLS credentials ────────────────────────────────────────────────────

let tlsOptions;
try {
  tlsOptions = {
    cert: fs.readFileSync(tls.cert),
    key: fs.readFileSync(tls.key),
  };
} catch (err) {
  console.error(`[ERROR] Failed to read TLS files: ${err.message}`);
  process.exit(1);
}

// ─── Path matching ───────────────────────────────────────────────────────────

/**
 * Returns true if the request URL matches the given route path pattern.
 *
 * Rules:
 *   - "/"         → matches every path (fallback)
 *   - "/foo/*"    → prefix match: matches /foo/ and /foo/anything
 *   - "/foo/bar"  → exact match
 */
function matchPath(routePath, requestUrl) {
  // Strip query string for matching
  const url = requestUrl.split("?")[0];

  if (routePath === "/") {
    return true;
  }

  if (routePath.endsWith("/*")) {
    const prefix = routePath.slice(0, -2); // remove "/*"
    return url === prefix || url.startsWith(prefix + "/");
  }

  return url === routePath;
}

/**
 * Find the first matching route for a given URL among the port's routes.
 * Returns the route object or null if no match is found.
 */
function findRoute(routes, requestUrl) {
  for (const route of routes) {
    if (matchPath(route.path, requestUrl)) {
      return route;
    }
  }
  return null;
}

function normalizeTarget(target) {
  let parsedUrl;

  try {
    parsedUrl = new URL(target);
  } catch (err) {
    throw new Error(`Invalid target URL "${target}"`);
  }

  if (parsedUrl.protocol === "ws:") {
    parsedUrl.protocol = "http:";
  } else if (parsedUrl.protocol === "wss:") {
    parsedUrl.protocol = "https:";
  } else if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      `Unsupported target protocol "${parsedUrl.protocol}" for "${target}". Use http://, https://, ws://, or wss://`
    );
  }

  return parsedUrl.toString();
}

// ─── Proxy setup ─────────────────────────────────────────────────────────────

const proxy = httpProxy.createProxyServer({
  secure: false,
  changeOrigin: true,
});

proxy.on("error", (err, req, res) => {
  console.error(`[ERROR] Proxy error: ${err.message}`);
  if (res && !res.headersSent) {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Bad Gateway");
  }
});

// ─── Start HTTPS servers ──────────────────────────────────────────────────────

for (const portConfig of https_ports) {
  const { port, routes } = portConfig;

  if (!port || !Array.isArray(routes)) {
    console.error(`[ERROR] Each https_ports entry must have a port and routes array`);
    process.exit(1);
  }

  try {
    for (const route of routes) {
      route.target = normalizeTarget(route.target);
    }
  } catch (err) {
    console.error(`[ERROR] Invalid route configuration on port ${port}: ${err.message}`);
    process.exit(1);
  }

  // Log routes for this port
  for (const route of routes) {
    console.log(`[ROUTE] ${route.path} → ${route.target}`);
  }

  const server = https.createServer(tlsOptions, (req, res) => {
    const route = findRoute(routes, req.url);

    if (!route) {
      console.warn(`[${port}] No route matched: ${req.method} ${req.url}`);
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway: no matching route");
      return;
    }

    console.log(`[${port}] ${req.method} ${req.url} → ${route.target}`);
    proxy.web(req, res, { target: route.target });
  });

  // WebSocket upgrade support
  server.on("upgrade", (req, socket, head) => {
    const route = findRoute(routes, req.url);

    if (!route) {
      console.warn(`[${port}] WS no route matched: ${req.url}`);
      // Send a WebSocket close frame (1008 Policy Violation) before destroying
      const closeFrame = Buffer.from([0x88, 0x02, 0x03, 0xf0]);
      socket.write(closeFrame);
      socket.destroy();
      return;
    }

    console.log(`[${port}] WS ${req.url} → ${route.target}`);
    proxy.ws(req, socket, head, { target: route.target });
  });

  server.listen(port, () => {
    console.log(`[INFO] HTTPS server started: https://localhost:${port}`);
  });

  server.on("error", (err) => {
    console.error(`[ERROR] Server on port ${port} failed: ${err.message}`);
  });
}
