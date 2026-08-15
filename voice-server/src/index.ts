import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createAIProvider } from "./ai/index.js";
import { verifyRelayToken } from "./auth.js";
import { initPool } from "./db.js";
import { loadEnv } from "./env.js";
import { RelaySession } from "./relay-session.js";

const env = loadEnv();
initPool(env);
const aiProvider = createAIProvider(env);

const server = createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/healthz" || req.url === "/")) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const callSid = url.searchParams.get("callSid");
  const token = url.searchParams.get("token");

  // Per-call, short-lived HMAC token minted by the Next.js /api/twilio/voice
  // webhook (lib/relayAuth.ts) — not a static bearer secret in the URL, which
  // Twilio's own request logs would otherwise expose indefinitely.
  const authorized = url.pathname === "/relay" && callSid && token && verifyRelayToken(callSid, token, env.VOICE_SERVER_SHARED_SECRET);

  if (!authorized) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws) => {
  new RelaySession(ws, aiProvider);
});

server.listen(env.PORT, () => {
  console.log(`[voice-server] listening on :${env.PORT} (ws path: /relay)`);
});
