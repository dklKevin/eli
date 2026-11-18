import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MISSING_KEY,
  MISSING_LEASE,
  MISSING_STATUTE,
  complete,
  leaseMessages,
  loadCorpus,
  parseModelJson,
  problemMessages,
  redact,
  validateLeaseReply,
  validateProblem,
} from "./eli.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 200_000;
const CALL_TIMEOUT_MS = 120_000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res, status, body, type) {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("That upload is too large."), { status: 413 }));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("The request was not readable."), { status: 400 }));
      }
    });
    req.on("error", () => {
      reject(Object.assign(new Error("The request was not readable."), { status: 400 }));
    });
  });
}

function cleanName(value) {
  if (typeof value !== "string") return "";
  const name = value.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) return "";
  return name;
}

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\u0000/g, "").trim();
  if (!text || text.length > max) return "";
  return text;
}

function safeFile(publicDir, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = decoded.replace(/^\/+/, "");
  const full = path.resolve(publicDir, relative);
  if (full !== publicDir && !full.startsWith(publicDir + path.sep)) return null;
  return full;
}

export function createApp({
  root = ROOT,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const publicDir = path.join(root, "public");

  return async function handle(req, res) {
    const corpus = loadCorpus(root);
    const url = new URL(req.url || "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/api/status") {
        sendJson(res, 200, {
          keyConfigured: Boolean(env.XAI_API_KEY),
          leasePresent: corpus.sampleLease != null,
          statutePresent: corpus.statute != null,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/lease/sample-lease.md") {
        if (corpus.sampleLease == null) {
          sendText(res, 404, `${MISSING_LEASE}\n`, "text/plain; charset=utf-8");
          return;
        }
        sendText(res, 200, corpus.sampleLease, "text/markdown; charset=utf-8");
        return;
      }

      if (req.method === "POST" && (url.pathname === "/api/lease" || url.pathname === "/api/problem")) {
        if (!env.XAI_API_KEY) {
          sendJson(res, 503, { error: MISSING_KEY });
          return;
        }
        if (corpus.statute == null) {
          sendJson(res, 503, { error: MISSING_STATUTE });
          return;
        }
        if (corpus.sampleLease == null) {
          sendJson(res, 503, { error: MISSING_LEASE });
          return;
        }
        const body = await readJson(req);
        const studentName = cleanName(body.studentName);
        const leaseText = cleanText(body.leaseText ?? body.text, 60_000);
        if (!studentName || !leaseText) {
          sendJson(res, 400, { error: "Send your name and the lease text." });
          return;
        }

        const signal = AbortSignal.timeout(CALL_TIMEOUT_MS);
        if (url.pathname === "/api/lease") {
          const content = await complete({
            apiKey: env.XAI_API_KEY,
            messages: leaseMessages({
              studentName,
              leaseText,
              statute: corpus.statute,
              sampleLease: corpus.sampleLease,
            }),
            effort: "low",
            fetchImpl,
            signal,
          });
          const checked = validateLeaseReply(content);
          if (!checked.ok) {
            sendJson(res, 502, { error: checked.error });
            return;
          }
          sendJson(res, 200, { reply: checked.reply });
          return;
        }

        const problem = cleanText(body.problem, 4_000);
        if (!problem) {
          sendJson(res, 400, { error: "Describe the appliance that broke." });
          return;
        }
        const content = await complete({
          apiKey: env.XAI_API_KEY,
          messages: problemMessages({
            studentName,
            leaseText,
            problem,
            statute: corpus.statute,
            sampleLease: corpus.sampleLease,
          }),
          json: true,
          effort: "medium",
          fetchImpl,
          signal,
        });
        let parsed;
        try {
          parsed = parseModelJson(content);
        } catch {
          sendJson(res, 502, {
            error: "Eli's reply could not be used because it was not in the expected shape.",
          });
          return;
        }
        const checked = validateProblem(parsed, { leaseText, statute: corpus.statute });
        if (!checked.ok) {
          sendJson(res, 502, { error: checked.error });
          return;
        }
        sendJson(res, 200, {
          paragraphs: checked.paragraphs,
          duty: checked.duty,
          letter: checked.letter,
          followup: checked.followup,
        });
        return;
      }

      if (req.method === "GET") {
        const requested = url.pathname === "/" ? "/index.html" : url.pathname;
        const full = safeFile(publicDir, requested);
        if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
          sendText(res, 404, "Not found\n", "text/plain; charset=utf-8");
          return;
        }
        const type = TYPES[path.extname(full)] || "application/octet-stream";
        sendText(res, 200, fs.readFileSync(full), type);
        return;
      }

      sendText(res, 405, "Method not allowed\n", "text/plain; charset=utf-8");
    } catch (error) {
      const status = error.status || 502;
      const message = redact(error.message || "The model call failed.", env.XAI_API_KEY);
      if (res.headersSent) return;
      sendJson(res, status, { error: message });
    }
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 4173;
  const host = "127.0.0.1";
  const server = http.createServer(createApp());
  server.listen(port, host, () => {
    console.log(`Eli is at http://${host}:${port}`);
  });
}

