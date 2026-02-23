// Background/service worker script.
// Responsibilities:
// - Receives OPENAI_MAP_FIELDS requests from the popup
// - Retrieves the session API key
// - Calls OpenAI Responses API with: prompt + screenshot + document file
// - Returns normalized mappings back to the popup

async function getSessionApiKey() {
  // API key is stored in chrome.storage.session by the popup.
  // This keeps the key ephemeral (not persisted across browser restarts).
  const { apiKey } = await chrome.storage.session.get(["apiKey"]);
  if (!apiKey) throw new Error("API key not set (session). Re-open popup and enter it again.");
  return apiKey;
}

function buildSchema() {
  // Strict JSON schema used to force the model to return machine-readable mappings.
  // Note: `value` is always a string; special types are encoded as strings.
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      mappings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            selector: { type: "string" },
            kind: { type: "string" },
            value: { type: "string" }
          },
          required: ["selector", "kind", "value"]
        }
      }
    },
    required: ["mappings"]
  };
}


function buildPrompt({ pageUrl, fields, userRules }) {
  // Prompt includes:
  // - Rules about selector usage and value formats
  // - The current page URL (light context)
  // - A JSON dump of extracted fields (selector + metadata)
  return [
    "Task: Fill a web form using information extracted from the attached document and the provided screenshot of the form.",
    "Return ONLY JSON that matches the provided schema.",
    "MUST RESPECT THESE RULES:",
    "1) Use selectors exactly as provided.",
    "2) Map only when the document clearly provides the value.",
    "3) value MUST always be a string. Use conventions:",
      "   - checkbox: 'true' or 'false'",
      "   - multi-select: JSON array string like '[\"Option 1\",\"Option 2\"]'",
      "   - single select: option visible text (or value if provided)",
      "   - radio: radio visible label text (or value if provided)",
    "4) Try to fill all fields if possible, but prioritize accuracy over quantity.",
    "5) If value exists in document Keep values exactly as they should be typed into the field.",
    "",
    userRules ? `Extra instructions: ${userRules}` : "",
    
    "",
    `Page: ${pageUrl}`,
    "",
    "Fields JSON (each has selector + label/placeholder/name/type):",
    JSON.stringify(fields)
  ].filter(Boolean).join("\n");
}

async function callOpenAI({ apiKey, docBase64, docfilename, pageUrl, fields, screenshotDataUrl, userRules }) {
  // Calls OpenAI Responses API using structured output (json_schema).
  const schema = buildSchema();
  const prompt = buildPrompt({ pageUrl, fields, userRules });
  const ext = (docfilename || "").split(".").pop().toLowerCase();

  let mime = "application/pdf";

  if (ext === "doc") {
    mime = "application/msword";
  } else if (ext === "docx") {
    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else if (ext === "pdf") {
    mime = "application/pdf";
  }

  // Responses API payload:
  // - input_text: our instruction + fields list
  // - input_image: screenshot data URL
  // - input_file: base64 document as a data URL with inferred mime
  const body = {
    model: "gpt-4o-mini",
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: "Extract document info from a document and map it to web form fields." }]
      },
      {
        role: "user",
        content: [
        { type: "input_text", text: prompt },
        {
            type: "input_image",
            image_url: screenshotDataUrl
        },
        {
            type: "input_file",
            filename: docfilename || "document",
            file_data: `data:${mime};base64,${docBase64}`
        }
        ]
      }
    ],
    text: {
        format: {
            type: "json_schema",
            name: "field_mappings",
            strict: true,
            schema
        }
    }
};
    
    
  // Do the network call from the background/service worker.
  // (The popup is short-lived and is not ideal for long requests.)
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`OpenAI error ${resp.status}: ${t || resp.statusText}`);
  }

  const data = await resp.json();

  // Prefer output_text; fallback to scanning output content.
  // (Some responses may nest the text in the output array.)
  const outText =
    (typeof data?.output_text === "string" && data.output_text) ||
    data?.output?.flatMap(i => i?.content || [])?.find(c => c?.type === "output_text")?.text ||
    "";

  if (!outText) throw new Error("No JSON output from model.");

  // Parse and normalize mappings for the content script.
  let parsed;
  try { parsed = JSON.parse(outText); } catch { throw new Error("Model returned non-JSON."); }

  const mappings = Array.isArray(parsed?.mappings)
    ? parsed.mappings
        .filter(m => m && typeof m.selector === "string" && typeof m.value !== "undefined")
        .map(m => ({ selector: m.selector, kind: m.kind, value: m.value }))
    : [];

  return { mappings };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    // Popup -> background message used to request mappings from OpenAI.
    if (msg?.type !== "OPENAI_MAP_FIELDS") return;

    const apiKey = await getSessionApiKey();
    const res = await callOpenAI({ apiKey, ...msg.payload });
    sendResponse(res);
  })().catch(err => sendResponse({ error: String(err.message || err) }));

  // Required for async sendResponse in MV3 service workers.
  return true; // keep channel open for async
});
