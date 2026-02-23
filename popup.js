// Popup controller: wires the popup UI to the extension backend.
// Flow:
// 1) Read API key + document file from the popup.
// 2) Ask content script for the current page's fillable fields.
// 3) Capture a screenshot for extra context.
// 4) Ask background/service worker to call OpenAI and return field mappings.
// 5) Send mappings back to the content script to fill the page.

// Tiny DOM helper for popup.html elements.
const $ = (id) => document.getElementById(id);

function setStatus(msg) {
  // Status area is a <pre>, so we keep raw text (no HTML).
  $("status").textContent = msg;
}

async function getActiveTab() {
  // Requires the extension to have permission to query tabs (or activeTab).
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  return tab;
}

async function readFileAsBase64(file) {
  // Reads a user-selected file and returns *only* the base64 payload.
  // FileReader produces a data URL like: data:application/pdf;base64,AAAA...
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Failed reading file."));
    r.onload = () => {
      // r.result = data:application/pdf;base64,....
      const s = String(r.result || "");
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.readAsDataURL(file);
  });
}

// Main action button.
$("analyzeFill").addEventListener("click", async () => {
  try {
    const apiKey = $("apiKey").value.trim();
    if (!apiKey) throw new Error("API key missing.");

    // Store key only for this browser session.
    // (Avoid chrome.storage.local / sync for secrets unless you explicitly encrypt.)
    await chrome.storage.session.set({ apiKey });

    setStatus("Collecting form fields...");
    const tab = await getActiveTab();

    // Ask the content script to extract a schema of fillable fields from the current page.
    const pageInfo = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_FORM_FIELDS" });
    if (!pageInfo?.fields?.length) throw new Error("No fillable fields found on page.");

    const file = $("docFile").files?.[0];
    if (!file) throw new Error("Select a DOC .");

    setStatus("Reading Document...");
    const docBase64 = await readFileAsBase64(file);

    // Optional user instructions appended to the prompt.
    const userRules = $("userRules").value.trim();

    setStatus("Sending Doc + fields to OpenAI...");
    // Capture visible screenshot to help the model understand the form layout/context.
    // Requires the relevant permission in manifest (captureVisibleTab or activeTab).
    setStatus("Capturing screenshot...");
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "jpeg",
    quality: 70
    });

    setStatus("Sending Doc + fields + screenshot to OpenAI...");
    // Hand off to background/service worker to call OpenAI.
    // Keeping API calls out of the popup avoids CORS/permission issues and keeps the UI responsive.
    const result = await chrome.runtime.sendMessage({
    type: "OPENAI_MAP_FIELDS",
    payload: {
        docBase64,
        docFilename: file.name || "document",
        pageUrl: tab.url,
        fields: pageInfo.fields,
        screenshotDataUrl,
        userRules
    }
    });

    if (result?.error) throw new Error(result.error);
    if (!result?.mappings?.length) throw new Error("No mappings returned.");

    setStatus(`Filling ${result.mappings.length} fields...`);
    // Ask the content script to apply the returned mappings into the live DOM.
    const fillRes = await chrome.tabs.sendMessage(tab.id, {
      type: "APPLY_MAPPINGS",
      mappings: result.mappings
    });

    if (fillRes?.error) throw new Error(fillRes.error);
    setStatus(`Done. Updated: ${fillRes?.updated || 0}, Skipped: ${fillRes?.skipped || 0}`);
  } catch (e) {
    // Display a readable error in the popup.
    setStatus(String(e.message || e));
  }
});

// Default state on popup open.
setStatus("Ready.");
