import express from "express";
import { createServer as createViteServer } from "vite";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Health check for Cloud Run
  app.get("/health", (req, res) => {
    res.status(200).send("OK");
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Proxy for public endpoints and Spot/Margin/Wallet signed endpoints
  app.use(
    "/proxy-spot",
    createProxyMiddleware({
      target: "https://api.binance.com",
      changeOrigin: true,
      pathRewrite: {
        "^/proxy-spot": "",
      },
    })
  );

  // Proxy for signed Futures endpoints
  app.use(
    "/proxy-futures",
    createProxyMiddleware({
      target: "https://fapi.binance.com",
      changeOrigin: true,
      pathRewrite: {
        "^/proxy-futures": "",
      },
    })
  );

  const spotWsProxy = createProxyMiddleware({
    target: "wss://stream.binance.com:9443",
    changeOrigin: true,
    ws: true,
    pathRewrite: {
      "^/proxy-spot-ws": "",
    },
  });

  const futuresWsProxy = createProxyMiddleware({
    target: "wss://fstream.binance.com",
    changeOrigin: true,
    ws: true,
    pathRewrite: {
      "^/proxy-futures-ws": "",
    },
  });

  app.use("/proxy-spot-ws", spotWsProxy);
  app.use("/proxy-futures-ws", futuresWsProxy);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/proxy-spot-ws")) {
      spotWsProxy.upgrade(req, socket as any, head);
    } else if (req.url?.startsWith("/proxy-futures-ws")) {
      futuresWsProxy.upgrade(req, socket as any, head);
    }
  });
}

startServer();
