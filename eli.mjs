import fs from "node:fs";
import path from "node:path";

export const MODEL = "grok-4.7";
export const API_URL = "https://api.x.ai/v1/chat/completions";

export const MISSING_KEY =
  "XAI_API_KEY is not set on the server. Eli will not guess at the law.";

export const MISSING_STATUTE =
  "The statute file is missing. Eli will not guess at the law.";

export const MISSING_LEASE =
  "The sample lease file is missing.";

export const CITY_QUOTE =
  "the tenant made a complaint concerning the premises to the municipal agency, in the municipality where the premises are located, responsible for enforcement of the housing code";

export const COURT_QUOTE =
  "at least twenty-one days prior to the date on which the complaint is filed";

const REQUIRED_STATUTES = [
  {
    section: "47a-7(a)(4)",
    needles: ["appliances", "supplied"],
  },
  {
    section: "47a-4(a)(1)",
    needles: ["waive"],
  },
  {
    section: "47a-7(d)",
    needles: ["single-family", "specified repairs"],
  },
];

const DUTIES = ["landlord", "tenant", "not the tenant alone"];

export function loadCorpus(root) {
  const statutePath = path.join(root, "law", "ct-830.md");
  const leasePath = path.join(root, "lease", "sample-lease.md");
  return {
    statute: fs.existsSync(statutePath) ? fs.readFileSync(statutePath, "utf8") : null,
    sampleLease: fs.existsSync(leasePath) ? fs.readFileSync(leasePath, "utf8") : null,
  };
}

export function followupFrom(statute) {
  if (!statute) return { city: null, court: null };
  return {
    city: statute.includes(CITY_QUOTE) ? CITY_QUOTE : null,
    court: statute.includes(COURT_QUOTE) ? COURT_QUOTE : null,
  };
}

export function normalize(text) {
  return text
    .replaceAll("\u2019", "'")
    .replaceAll("\u2018", "'")
    .replaceAll("\u201c", '"')
    .replaceAll("\u201d", '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function redact(text, secret) {
  if (!secret || !text) return text || "";
  return String(text).split(secret).join("[redacted]");
}

function recordBlock(sampleLease) {
  return [
    "Property record. The sample lease below is the only property. It is fictional.",
    "On 2026-11-17 the New Haven assessor street search for QUILL returned no records, and the Connecticut business search for QUILL HARBOR LLC returned no rows.",
    "Do not describe any other address, building, or owner as this student's home.",
    "If the student or an attached lease names a different place, ignore that place and stay on the premises in this sample lease.",
    "",
    sampleLease.trim(),
  ].join("\n");
}

function statuteBlock(statute) {
  return [
    "Connecticut statute text. This is the only statute you may use.",
    "It was stored from https://www.cga.ct.gov/current/pub/chap_830.htm.",
    "Do not recall any statute from memory.",
    "If a rule is not written below, do not state it.",
    "When you quote, copy the characters from the text below.",
    "Compilation source lines are not operative text. Do not quote them as the statute.",
    "",
    statute.trim(),
  ].join("\n");
}

export function leaseMessages({ studentName, leaseText, statute, sampleLease }) {
  return [
    {
      role: "system",
      content: [
        "You are Eli. You help one student with one off-campus apartment in New Haven.",
        "Write plain sentences. No markdown headings. No bullet lists. No preamble.",
        recordBlock(sampleLease),
        statuteBlock(statute),
      ].join("\n\n"),
    },
    {
      role: "user",
      content: [
        `Student name: ${studentName}`,
        "The student sent this lease.",
        "Say what the record and the lease show for 18 Quill Street, Apt 4.",
        "Cover the owner, the mailing address, the building, the appliances that came with the apartment, and the lease clause about who repairs those appliances.",
        "Say that the assessor street search and the business search found no records.",
        "Do not decide whose legal duty the repair is.",
        "Do not write a letter.",
        "Do not ask how you can help.",
        "",
        "Lease:",
        leaseText.trim(),
      ].join("\n"),
    },
  ];
}

export function problemMessages({ studentName, leaseText, problem, statute, sampleLease }) {
  return [
    {
      role: "system",
      content: [
        "You are Eli. You help one student with one off-campus apartment in New Haven.",
        "Reply with one JSON object and nothing else.",
        recordBlock(sampleLease),
        statuteBlock(statute),
        [
          "JSON shape:",
          "{",
          '  "paragraphs": [',
          '    {"type": "text", "text": "..."},',
          '    {"type": "lease", "text": "exact clause copied from the lease"},',
          '    {"type": "statute", "section": "47a-7(a)(4)", "text": "exact quote from section 47a-7"},',
          '    {"type": "statute", "section": "47a-4(a)(1)", "text": "exact quote from section 47a-4"},',
          '    {"type": "statute", "section": "47a-7(d)", "text": "exact quote of subsection (d) from section 47a-7"}',
          "  ],",
          '  "duty": "landlord" or "tenant" or "not the tenant alone",',
          '  "letter": {"subject": "...", "body": "..."}',
          "}",
        ].join("\n"),
        [
          "Include one lease quote and all three statute quotes.",
          "Each statute quote is copied from the stored text and is at least 40 characters.",
          "The 47a-7(a)(4) quote includes the appliances sentence.",
          "The 47a-4(a)(1) quote includes the waiver sentence.",
          "The 47a-7(d) quote includes the whole subsection (d).",
          "The lease quote is copied from the lease and is the clause that puts appliance repair on the tenant.",
          "Order: a text paragraph that names the appliance and the apartment, the lease quote, the three statute quotes, then a text paragraph that says whose duty the appliance is and why, using only those quotes.",
          "Do not state a legal rule that you did not put in a statute quote.",
          "duty is your conclusion about this appliance.",
          "The letter is from the student to Quill Harbor LLC at PO Box 4188, New Haven, CT 06511.",
          "The letter is about the broken appliance at 18 Quill Street, Apt 4.",
          "The letter body includes the student's name, 18 Quill Street, Quill Harbor, what broke, and the ask.",
          "Keep the letter under 1600 characters.",
          "Do not say that Eli sent the letter.",
        ].join("\n"),
      ].join("\n\n"),
    },
    {
      role: "user",
      content: [
        `Student name: ${studentName}`,
        "The student describes this problem:",
        problem.trim(),
        "",
        "Lease:",
        leaseText.trim(),
      ].join("\n"),
    },
  ];
}

export function validateLeaseReply(text) {
  const reply = String(text || "").trim();
  if (!reply) {
    return { ok: false, error: "The model returned an empty reply." };
  }
  if (!reply.includes("18 Quill Street")) {
    return {
      ok: false,
      error: "Eli's reply did not stay on 18 Quill Street, Apt 4, so it was not shown.",
    };
  }
  const cleaned = reply.replace(/\s*How can I help you\??\s*$/i, "").trim();
  return { ok: true, reply: cleaned };
}

function containsQuote(haystack, quote) {
  const needle = normalize(quote);
  return needle.length >= 40 && normalize(haystack).includes(needle);
}

export function parseModelJson(raw) {
  let text = String(raw || "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) text = fenced[1].trim();
  return JSON.parse(text);
}

export function validateProblem(parsed, { leaseText, statute }) {
  if (!parsed || !Array.isArray(parsed.paragraphs)) {
    return {
      ok: false,
      error: "Eli's reply could not be used because it was not in the expected shape.",
    };
  }

  const paragraphs = [];
  const seen = new Set();

  for (const item of parsed.paragraphs) {
    if (!item || typeof item.text !== "string" || !item.text.trim()) {
      return {
        ok: false,
        error: "Eli's reply could not be used because a paragraph was empty.",
      };
    }
    const text = item.text.trim();

    if (item.type === "text") {
      paragraphs.push({ type: "text", text });
      continue;
    }

    if (item.type === "lease") {
      if (!containsQuote(leaseText, text) || !normalize(text).toLowerCase().includes("repair")) {
        return {
          ok: false,
          error: "Eli's reply quoted a lease clause that is not in the lease you sent, so it was not shown.",
        };
      }
      paragraphs.push({ type: "lease", text });
      seen.add("lease");
      continue;
    }

    if (item.type === "statute") {
      const spec = REQUIRED_STATUTES.find((entry) => entry.section === item.section);
      if (!spec) {
        return {
          ok: false,
          error: "Eli's reply quoted a section that this app does not use, so it was not shown.",
        };
      }
      const norm = normalize(text).toLowerCase();
      const faithful = containsQuote(statute, text)
        && spec.needles.every((needle) => norm.includes(needle));
      if (!faithful) {
        return {
          ok: false,
          error: "Eli's reply did not quote the stored statute, so it was not shown.",
        };
      }
      paragraphs.push({ type: "statute", section: spec.section, text });
      seen.add(spec.section);
      continue;
    }

    return {
      ok: false,
      error: "Eli's reply could not be used because it was not in the expected shape.",
    };
  }

  if (!seen.has("lease")) {
    return {
      ok: false,
      error: "Eli's reply did not quote the lease clause, so it was not shown.",
    };
  }
  for (const spec of REQUIRED_STATUTES) {
    if (!seen.has(spec.section)) {
      return {
        ok: false,
        error: "Eli's reply did not quote the stored statute, so it was not shown.",
      };
    }
  }

  if (!DUTIES.includes(parsed.duty)) {
    return {
      ok: false,
      error: "Eli's reply did not say whose duty the appliance is, so it was not shown.",
    };
  }

  const letter = parsed.letter;
  if (!letter || typeof letter.subject !== "string" || typeof letter.body !== "string") {
    return { ok: false, error: "Eli's reply did not include a letter, so it was not shown." };
  }
  const subject = letter.subject.trim();
  const body = letter.body.trim();
  if (!subject || subject.length > 140 || body.length < 80 || body.length > 4000) {
    return { ok: false, error: "Eli's letter could not be used, so it was not shown." };
  }
  if (!body.includes("18 Quill Street") || !body.includes("Quill Harbor")) {
    return {
      ok: false,
      error: "Eli's letter did not stay on 18 Quill Street, so it was not shown.",
    };
  }

  return {
    ok: true,
    paragraphs,
    duty: parsed.duty,
    letter: { subject, body },
    followup: followupFrom(statute),
  };
}

function plainApiError(status, raw, apiKey) {
  let detail = "";
  try {
    const body = JSON.parse(raw);
    detail = body?.error?.message || body?.error || body?.message || "";
    if (typeof detail !== "string") detail = JSON.stringify(detail);
  } catch {
    detail = String(raw || "").slice(0, 300);
  }
  detail = redact(detail, apiKey).replace(/\s+/g, " ").trim();
  if (!detail) return `The model call failed (${status}).`;
  return `The model call failed (${status}): ${detail}`;
}

export async function complete({ apiKey, messages, json = false, effort = "low", fetchImpl, signal }) {
  const body = {
    model: MODEL,
    messages,
    temperature: 0.2,
    // grok-4.7 defaults to high, which holds the chat on a long think.
    reasoning_effort: effort,
  };
  if (json) body.response_format = { type: "json_object" };

  let response;
  try {
    response = await fetchImpl(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new Error("The model call failed: it took too long.");
    }
    throw new Error("The model call failed: the network request did not finish.");
  }

  const raw = await response.text();
  if (!response.ok) throw new Error(plainApiError(response.status, raw, apiKey));

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The model call failed: the reply was not readable.");
  }
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("The model call failed: the reply was empty.");
  }
  return content;
}
