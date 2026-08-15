import WebSocket from "ws";
import { createHmac } from "node:crypto";
import pg from "pg";

const secret = process.env.VOICE_SERVER_SHARED_SECRET;
const dbUrl = process.env.DATABASE_URL;
const callSid = "CAPREFLIGHTTEST" + Date.now();

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(
  `insert into calls (twilio_call_sid, status, caller_number_masked, persona, direction)
   values ($1, 'ringing', '+1 **** **** 00', 'default', 'inbound') returning id`,
  [callSid],
);
const callId = rows[0].id;
console.log("inserted preflight test call:", callId);

const expiresAt = Date.now() + 5 * 60 * 1000;
const signature = createHmac("sha256", secret).update(`${callSid}.${expiresAt}`).digest("hex");
const token = `${expiresAt}.${signature}`;

const url = `wss://scamsink-voice-production.up.railway.app/relay?callSid=${callSid}&token=${token}`;
const ws = new WebSocket(url);

let gotText = false;
let fullReply = "";
let closedCode = null;

const done = new Promise((resolve) => {
  ws.on("open", () => {
    console.log("ws open");
    ws.send(JSON.stringify({ type: "setup", callSid, from: "+15550000000", to: "+12184293208" }));
    setTimeout(() => {
      ws.send(
        JSON.stringify({
          type: "prompt",
          voicePrompt: "Hello, this is a pre-flight connectivity test. Please say hello back.",
          last: true,
        }),
      );
    }, 700);
  });

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "text") {
      gotText = true;
      fullReply += msg.token ?? "";
      if (msg.last) resolve("got-reply");
    } else {
      console.log("received:", msg.type);
    }
  });

  ws.on("close", (code) => {
    closedCode = code;
    resolve("closed");
  });
  ws.on("error", (err) => {
    console.log("ws error:", err.message);
    resolve("error");
  });

  setTimeout(() => resolve("timeout"), 12000);
});

const result = await done;
console.log("result:", result, "closedCode:", closedCode);
console.log("gotText:", gotText);
console.log("reply length:", fullReply.length);
if (fullReply) console.log("reply preview:", JSON.stringify(fullReply.slice(0, 160)));

ws.close();

await client.query(`delete from transcript_messages where call_id = $1`, [callId]);
await client.query(`delete from call_events where call_id = $1`, [callId]);
await client.query(`delete from calls where id = $1`, [callId]);
console.log("cleaned up preflight test call row");
await client.end();

process.exit(gotText && fullReply !== "Sorry, I'm having a bit of trouble hearing you right now. I'll have to call you back." ? 0 : 1);
