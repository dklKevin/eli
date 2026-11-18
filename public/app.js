const GREETING = "Hey Bulldog! My name is Eli and I'm here to help you manage problems you deal with during off-campus living. For me to know how your place operates, could you send me your lease?";
const PERFECT = "Perfect, let me get right on that.";
const HELP = "How can I help you?";
const WORKING = "Eli is working...";
const GREETING_DELAY_MS = 800;
const HELP_DELAY_MS = 500;
const SAMPLE_PATH = "/lease/sample-lease.md";
const SAMPLE_NAME = "sample-lease.md";

const DUTY_LINE = {
  landlord: "Whose job: the landlord.",
  tenant: "Whose job: the tenant.",
  "not the tenant alone": "Whose job: not the tenant alone.",
};

const sign = document.querySelector("#sign");
const signForm = document.querySelector("#sign-form");
const nameInput = document.querySelector("#name");
const signKey = document.querySelector("#sign-key");
const chat = document.querySelector("#chat");
const who = document.querySelector("#who");
const chatKey = document.querySelector("#chat-key");
const thread = document.querySelector("#thread");
const composer = document.querySelector("#composer");
const attachRow = document.querySelector("#attach-row");
const sampleButton = document.querySelector("#sample");
const chooseButton = document.querySelector("#choose");
const fileInput = document.querySelector("#file");
const chip = document.querySelector("#chip");
const formError = document.querySelector("#form-error");
const draft = document.querySelector("#draft");
const sendButton = document.querySelector("#send");

const state = {
  name: "",
  phase: "lease",
  attachment: null,
  busy: false,
  keyConfigured: true,
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function addMessage(className) {
  const article = el("article", `msg ${className} arrive`);
  thread.append(article);
  article.scrollIntoView({ block: "end" });
  return article;
}

function addEli(text) {
  const article = addMessage("eli");
  article.append(el("p", "who", "Eli"));
  for (const part of text.split(/\n\s*\n/)) {
    const line = part.trim();
    if (line) article.append(el("p", null, line));
  }
  return article;
}

function addStudent(text, filename) {
  const article = addMessage("student");
  article.append(el("p", null, text));
  if (filename) article.append(el("p", "file", filename));
  return article;
}

function addError(text) {
  const article = addMessage("error");
  article.append(el("p", "who", "Could not finish"));
  article.append(el("p", null, text));
  return article;
}

function showWorking() {
  const line = el("p", "working", WORKING);
  thread.append(line);
  line.scrollIntoView({ block: "end" });
  thread.setAttribute("aria-busy", "true");
  return line;
}

function hideWorking(line) {
  line.remove();
  thread.removeAttribute("aria-busy");
}

function setFormError(text) {
  formError.hidden = !text;
  formError.textContent = text || "";
}

function showChip() {
  chip.replaceChildren();
  if (!state.attachment) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  chip.append(el("span", null, state.attachment.filename));
  const remove = el("button", null, "Remove");
  remove.type = "button";
  remove.addEventListener("click", () => {
    state.attachment = null;
    fileInput.value = "";
    showChip();
  });
  chip.append(document.createTextNode(" "));
  chip.append(remove);
}

function setBusy(busy) {
  state.busy = busy;
  sendButton.disabled = busy;
  draft.disabled = busy;
  sampleButton.disabled = busy;
  chooseButton.disabled = busy;
}

async function readError(response) {
  try {
    const body = await response.json();
    if (body && typeof body.error === "string" && body.error.trim()) return body.error.trim();
  } catch {
    /* The body was not JSON. */
  }
  return "The request failed.";
}

signForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  state.name = name;
  who.textContent = name;
  sign.hidden = true;
  chat.hidden = false;
  thread.replaceChildren();
  window.setTimeout(() => {
    addEli(GREETING);
    composer.hidden = false;
    draft.focus();
  }, GREETING_DELAY_MS);
});

sampleButton.addEventListener("click", async () => {
  setFormError("");
  const response = await fetch(SAMPLE_PATH);
  if (!response.ok) {
    setFormError("The sample lease file is missing.");
    return;
  }
  const text = await response.text();
  state.attachment = { filename: SAMPLE_NAME, text };
  showChip();
});

chooseButton.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  setFormError("");
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const text = await file.text();
  if (!text.trim() || text.includes("\u0000")) {
    setFormError("That file is not text. The sample lease is a text file.");
    return;
  }
  state.attachment = { filename: file.name, text };
  showChip();
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  setFormError("");

  if (state.phase === "lease") {
    if (!state.attachment) {
      setFormError("Attach the lease first.");
      return;
    }
    const leaseText = state.attachment.text.trim();
    const filename = state.attachment.filename;
    if (!leaseText || leaseText.length > 60000) {
      setFormError("That lease is empty or too long.");
      return;
    }
    addStudent("Here is the lease.", filename);
    addEli(PERFECT);
    const working = showWorking();
    setBusy(true);
    try {
      const response = await fetch("/api/lease", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          studentName: state.name,
          leaseText,
          filename,
        }),
      });
      hideWorking(working);
      if (!response.ok) {
        addError(await readError(response));
        setBusy(false);
        return;
      }
      const data = await response.json();
      addEli(data.reply);
      state.leaseText = leaseText;
      state.attachment = null;
      showChip();
      attachRow.hidden = true;
      draft.placeholder = "What broke?";
      window.setTimeout(() => {
        addEli(HELP);
        state.phase = "problem";
        setBusy(false);
        draft.focus();
      }, HELP_DELAY_MS);
    } catch {
      hideWorking(working);
      addError("The request failed.");
      setBusy(false);
    }
    return;
  }

  if (state.phase !== "problem") return;
  const problem = draft.value.trim();
  if (!problem) {
    setFormError("Describe the appliance that broke.");
    return;
  }
  draft.value = "";
  addStudent(problem);
  const working = showWorking();
  setBusy(true);
  try {
    const response = await fetch("/api/problem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentName: state.name,
        leaseText: state.leaseText,
        problem,
      }),
    });
    hideWorking(working);
    if (!response.ok) {
      addError(await readError(response));
      setBusy(false);
      draft.value = problem;
      return;
    }
    renderFindings(await response.json());
    composer.hidden = true;
    state.phase = "done";
    setBusy(false);
  } catch {
    hideWorking(working);
    addError("The request failed.");
    setBusy(false);
    draft.value = problem;
  }
});

function appendStoredQuote(parent, text) {
  if (text) {
    parent.append(el("blockquote", "quote", text));
    return;
  }
  parent.append(el("p", null, "The stored statute file does not include that sentence."));
}

function renderFindings(data) {
  const article = addMessage("eli");
  article.append(el("p", "who", "Eli"));
  for (const part of data.paragraphs) {
    if (part.type === "text") {
      article.append(el("p", null, part.text));
      continue;
    }
    const label = part.type === "lease" ? "Lease" : part.section;
    article.append(el("p", "cite", label));
    const quote = el("blockquote", "quote", part.text);
    article.append(quote);
  }
  if (DUTY_LINE[data.duty]) article.append(el("p", null, DUTY_LINE[data.duty]));

  const letter = addMessage("letter");
  letter.append(el("p", "cite", "Letter"));
  letter.append(el("h3", "subject", data.letter.subject));
  letter.append(el("p", "paper", data.letter.body));

  const followup = addMessage("followup");
  followup.append(el("h2", null, "Follow-up"));
  const list = document.createElement("ol");

  const letterItem = document.createElement("li");
  letterItem.append(el("span", "num", "01"));
  const letterBody = document.createElement("div");
  letterBody.append(el("h3", null, "Letter"));
  letterBody.append(el("p", null, "Open the draft in your mail app. Eli does not send it."));
  const mail = el("a", "primary", "Open in your mail app");
  mail.href = `mailto:?subject=${encodeURIComponent(data.letter.subject)}&body=${encodeURIComponent(data.letter.body)}`;
  mail.addEventListener("click", () => {
    if (letterBody.querySelector(".opened")) return;
    letterBody.append(el("p", "opened", "Opened your mail app. You still send it yourself."));
  });
  letterBody.append(mail);
  letterItem.append(letterBody);

  const cityItem = document.createElement("li");
  cityItem.append(el("span", "num", "02"));
  const cityBody = document.createElement("div");
  cityBody.append(el("h3", null, "City complaint"));
  cityBody.append(el("p", null, "Next, a complaint to the city agency that enforces the housing code."));
  cityBody.append(el("p", "cite", "47a-14h"));
  appendStoredQuote(cityBody, data.followup.city);
  cityItem.append(cityBody);

  const courtItem = document.createElement("li");
  courtItem.append(el("span", "num", "03"));
  const courtBody = document.createElement("div");
  courtBody.append(el("h3", null, "21-day court option"));
  courtBody.append(el("p", null, "The stored text ties a housing-court filing to that complaint and a twenty-one day wait."));
  courtBody.append(el("p", "cite", "47a-14h"));
  appendStoredQuote(courtBody, data.followup.court);
  courtItem.append(courtBody);

  list.append(letterItem, cityItem, courtItem);
  followup.append(list);
  followup.scrollIntoView({ block: "start" });
}

fetch("/api/status")
  .then((response) => response.json())
  .then((data) => {
    state.keyConfigured = Boolean(data.keyConfigured);
    const notes = [];
    if (!data.leasePresent) notes.push("The sample lease file is missing.");
    if (!data.statutePresent) notes.push("The statute file is missing. Eli will not guess at the law.");
    if (!data.keyConfigured) notes.push("XAI_API_KEY is not set on the server. Eli will not guess at the law.");
    if (!notes.length) return;
    const note = notes.join(" ");
    signKey.hidden = false;
    signKey.textContent = note;
    chatKey.hidden = false;
    chatKey.textContent = note;
  })
  .catch(() => {
    signKey.hidden = false;
    signKey.textContent = "Eli's server did not answer.";
  });
