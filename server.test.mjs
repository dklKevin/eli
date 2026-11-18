import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import os from "node:os";
import {
  CITY_QUOTE,
  COURT_QUOTE,
  MISSING_KEY,
  MISSING_LEASE,
  MISSING_STATUTE,
  MODEL,
  leaseMessages,
  loadCorpus,
  problemMessages,
  validateProblem,
} from "./eli.mjs";
import { createApp } from "./server.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const corpus = loadCorpus(root);
const statute = corpus.statute;
const sample = corpus.sampleLease;
const leaseClause = "The tenant keeps the appliances that came with the apartment in repair.";
const quote7a4 = "maintain in good and safe working order and condition all electrical, plumbing, sanitary, heating, ventilating and other facilities and appliances and elevators, supplied or required to be supplied by him";
const quote4a1 = "Agrees to waive or forfeit rights or remedies under this chapter and sections 47a-21, 47a-23 to 47a-23b, inclusive, 47a-26 to 47a-26g, inclusive, 47a-35 to 47a-35b, inclusive, 47a-41a, 47a-43 and 47a-46";
const quote7d = statute.split("\n\n").find((part) => part.trim().startsWith("(d) The landlord and tenant of a dwelling unit"));

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function withApp(env, fetchImpl, run) {
  const { server, port } = await listen(createApp({ root, env, fetchImpl }));
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("stored statute text is what the prompt and the follow-up quote", () => {
  assert.ok(statute.includes(quote7a4));
  assert.ok(statute.includes(quote4a1));
  assert.ok(quote7d.includes("specified repairs"));
  assert.ok(statute.includes(CITY_QUOTE));
  assert.ok(statute.includes(COURT_QUOTE));
  assert.equal(statute.includes("Scout record"), false);
  assert.ok(sample.includes("This is a sample lease."));
  assert.ok(sample.includes("a stove"));
  assert.ok(sample.includes("1800 dollars a month"));
  assert.ok(sample.includes(leaseClause));

  const messages = problemMessages({
    studentName: "Ada Marin",
    leaseText: sample,
    problem: "The stove broke. I also heard about 500 Chapel Street.",
    statute,
    sampleLease: sample,
  });
  const prompt = messages.map((message) => message.content).join("\n");
  assert.equal(messages[0].role, "system");
  assert.match(prompt, /Do not recall any statute from memory/);
  assert.ok(prompt.includes(quote7a4));
  assert.ok(prompt.includes("stay on the premises in this sample lease"));
  assert.ok(prompt.includes("18 Quill Street"));
  assert.ok(prompt.includes("500 Chapel Street"));
  assert.equal(MODEL, "grok-4.7");
});

test("a reply that invents statute text is rejected", () => {
  const invented = "The landlord must repaint the door in gold leaf every spring.";
  const result = validateProblem({
    paragraphs: [
      { type: "text", text: "The stove at 18 Quill Street, Apt 4 stopped working." },
      { type: "lease", text: leaseClause },
      { type: "statute", section: "47a-7(a)(4)", text: invented },
      { type: "statute", section: "47a-4(a)(1)", text: quote4a1 },
      { type: "statute", section: "47a-7(d)", text: quote7d },
    ],
    duty: "landlord",
    letter: {
      subject: "Stove",
      body: "Quill Harbor LLC, the stove at 18 Quill Street is broken and I am asking you to repair it this week.",
    },
  }, { leaseText: sample, statute });
  assert.equal(result.ok, false);
  assert.equal(result.error.includes(invented), false);
});

test("a faithful reply is kept, including the stored follow-up quotes", () => {
  const result = validateProblem({
    paragraphs: [
      { type: "text", text: "The stove that came with Apartment 4 at 18 Quill Street has stopped working." },
      { type: "lease", text: leaseClause },
      { type: "statute", section: "47a-7(a)(4)", text: quote7a4 },
      { type: "statute", section: "47a-4(a)(1)", text: quote4a1 },
      { type: "statute", section: "47a-7(d)", text: quote7d },
      { type: "text", text: "On these words, the repair is the landlord's duty." },
    ],
    duty: "landlord",
    letter: {
      subject: "Stove at 18 Quill Street, Apt 4",
      body: "Quill Harbor LLC\nPO Box 4188, New Haven, CT 06511\n\nThe stove at 18 Quill Street, Apt 4 stopped working. I am Ada Marin, the tenant, and I am asking you to repair it.\n",
    },
  }, { leaseText: sample, statute });
  assert.equal(result.ok, true);
  assert.equal(result.followup.city, CITY_QUOTE);
  assert.equal(result.followup.court, COURT_QUOTE);
  assert.equal(result.duty, "landlord");
});

test("missing key does not call the model", async () => {
  let called = false;
  await withApp({}, () => {
    called = true;
    throw new Error("fetch should not run");
  }, async (base) => {
    const status = await fetch(`${base}/api/status`);
    assert.deepEqual(await status.json(), {
      keyConfigured: false,
      leasePresent: true,
      statutePresent: true,
    });
    const lease = await fetch(`${base}/api/lease`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studentName: "Ada Marin", leaseText: sample }),
    });
    assert.equal(lease.status, 503);
    assert.deepEqual(await lease.json(), { error: MISSING_KEY });
    const page = await fetch(`${base}/`);
    const html = await page.text();
    assert.equal(html.includes("Hey Bulldog!"), false);
    const app = await fetch(`${base}/app.js`);
    const js = await app.text();
    assert.ok(js.includes("Hey Bulldog! My name is Eli and I'm here to help you manage problems you deal with during off-campus living. For me to know how your place operates, could you send me your lease?"));
    assert.ok(js.includes("Perfect, let me get right on that."));
    assert.ok(js.includes("How can I help you?"));
    assert.ok(js.includes("Eli is working..."));
    assert.ok(js.includes("Open in your mail app"));
    assert.ok(js.includes("21-day court option"));
    const sampleResponse = await fetch(`${base}/lease/sample-lease.md`);
    const sampleText = await sampleResponse.text();
    assert.ok(sampleText.includes("Quill Harbor LLC"));
    assert.ok(sampleText.includes("Alex Kim"));
    assert.ok(sampleText.includes("1800 dollars a month"));
    assert.equal(called, false);
  });
});

test("the model request carries the statute and never the key", async () => {
  const secret = "test-key-value-should-not-leak";
  let seen = null;
  await withApp({ XAI_API_KEY: secret }, async (url, options) => {
    seen = { url, options };
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, "grok-4.7");
    assert.equal(options.headers.authorization, `Bearer ${secret}`);
    assert.equal(options.body.includes(secret), false);
    const prompt = payload.messages.map((message) => message.content).join("\n");
    assert.ok(prompt.includes(quote7a4));
    assert.ok(prompt.includes("Quill Harbor LLC"));
    return new Response(JSON.stringify({
      choices: [{ message: { content: "18 Quill Street, Apt 4 is a four-apartment house built in 1924. The owner is Quill Harbor LLC." } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async (base) => {
    const response = await fetch(`${base}/api/lease`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studentName: "Ada Marin", leaseText: sample }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.match(body.reply, /18 Quill Street/);
    assert.equal(JSON.stringify(body).includes(secret), false);
    assert.equal(seen.url, "https://api.x.ai/v1/chat/completions");
  });

  const messages = leaseMessages({
    studentName: "Ada Marin",
    leaseText: sample,
    statute,
    sampleLease: sample,
  });
  assert.ok(messages[1].content.includes(sample.trim()));
});

test("missing source files do not call the model", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eli-missing-"));
  fs.mkdirSync(path.join(tmp, "public"));
  fs.mkdirSync(path.join(tmp, "lease"));
  fs.writeFileSync(path.join(tmp, "lease", "sample-lease.md"), sample);
  let called = false;
  const { server, port } = await listen(createApp({
    root: tmp,
    env: { XAI_API_KEY: "present-but-unused" },
    fetchImpl: () => {
      called = true;
      throw new Error("fetch should not run");
    },
  }));
  try {
    const base = `http://127.0.0.1:${port}`;
    const missingStatute = await fetch(`${base}/api/lease`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studentName: "Ada Marin", leaseText: sample }),
    });
    assert.equal(missingStatute.status, 503);
    assert.deepEqual(await missingStatute.json(), { error: MISSING_STATUTE });

    fs.mkdirSync(path.join(tmp, "law"));
    fs.writeFileSync(path.join(tmp, "law", "ct-830.md"), statute);
    fs.rmSync(path.join(tmp, "lease", "sample-lease.md"));
    const missingLease = await fetch(`${base}/api/lease`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studentName: "Ada Marin", leaseText: sample }),
    });
    assert.deepEqual(await missingLease.json(), { error: MISSING_LEASE });
    const sampleResponse = await fetch(`${base}/lease/sample-lease.md`);
    assert.equal(sampleResponse.status, 404);
    assert.match(await sampleResponse.text(), /sample lease file is missing/);
    assert.equal(called, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("an upstream error is shown without the key", async () => {
  const secret = "test-key-value-should-not-leak";
  await withApp({ XAI_API_KEY: secret }, async () => new Response(JSON.stringify({
    error: { message: `bad key ${secret}` },
  }), { status: 401 }), async (base) => {
    const response = await fetch(`${base}/api/lease`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studentName: "Ada Marin", leaseText: sample }),
    });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.match(body.error, /The model call failed \(401\)/);
    assert.equal(body.error.includes(secret), false);
    assert.match(body.error, /\[redacted\]/);
  });
});
