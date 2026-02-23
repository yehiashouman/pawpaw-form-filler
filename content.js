// Content script: extracts form fields from the current page and applies AI-provided mappings.
// It communicates with the extension via chrome.runtime messages.

// Best-effort label extraction for an input/select/textarea.
// Strategy: prefer <label for="id">, otherwise look for a wrapping <label>.
function getLabelText(el) {
  const id = el.getAttribute("id");
  if (id) {
    const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (lab) return (lab.innerText || "").trim();
  }
  const p = el.closest("label");
  return p ? (p.innerText || "").trim() : "";
}

// Build a selector that can be used later to find the same element.
// Order of preference:
// 1) #id (most stable)
// 2) tag[name="..."] (+ nth-of-type for checkbox/radio group collisions)
// 3) tag[aria-label="..."]
// 4) fallback: CSS path using nth-of-type within the nearest form/body
function buildSelector(el) {
    const id = el.getAttribute("id");
    if (id) return `#${CSS.escape(id)}`;

    const name = el.getAttribute("name");
    if (name) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();

    // Avoid collisions for radio/checkbox groups (same name).
    // Note: nth-of-type is a best-effort disambiguator and can still be brittle
    // on highly dynamic pages.
    if ((type === "radio" || type === "checkbox")) {
        const group = Array.from(document.querySelectorAll(`${tag}[name="${CSS.escape(name)}"]`));
        const idx = group.indexOf(el);
        if (idx >= 0) return `${tag}[name="${CSS.escape(name)}"]:nth-of-type(${idx + 1})`;
    }

    return `${tag}[name="${CSS.escape(name)}"]`;
}

  const aria = el.getAttribute("aria-label");
  if (aria) return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(aria)}"]`;

  // Fallback: tag + nth-of-type path within the closest <form> (or document.body).
  // This is the least stable approach but works when id/name/aria-label are missing.
  const form = el.closest("form") || document.body;
  const path = [];
  let cur = el;

  while (cur && cur !== form && cur.nodeType === 1) {
    const tag = cur.tagName.toLowerCase();
    const parent = cur.parentElement;
    const sibs = parent ? Array.from(parent.children).filter(x => x.tagName === cur.tagName) : [];
    const idx = sibs.indexOf(cur) + 1;
    path.unshift(`${tag}:nth-of-type(${idx})`);
    cur = parent;
  }

  const formSel = form.tagName.toLowerCase() === "form" ? "form" : "body";
  return `${formSel} ${path.join(" > ")}`.trim();
}

function extractFields() {
  // Gather candidates: only user-editable form controls.
  const els = Array.from(document.querySelectorAll("input, textarea, select"))
    .filter(el => !el.disabled)
    .filter(el => {
      const t = (el.getAttribute("type") || "").toLowerCase();
      // Exclude non-fillable or sensitive types.
      return t !== "hidden" && t !== "submit" && t !== "button" && t !== "reset" && t !== "file";
    });

  // Return a compact schema used by popup/background scripts and the LLM prompt.
  return els.map(el => ({
    selector: buildSelector(el),
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute("type") || "").toLowerCase(),
    name: el.getAttribute("name") || "",
    id: el.getAttribute("id") || "",
    placeholder: el.getAttribute("placeholder") || "",
    label: getLabelText(el),
    children: el.children ? el.children.length : 0,
    value: (el.value || "").slice(0, 200),
    multiple: el.tagName.toLowerCase() === "select" ? !!el.multiple : false,
    checked: (el.type === "checkbox" || el.type === "radio") ? !!el.checked : false,
    options: el.tagName.toLowerCase() === "select"
    ? Array.from(el.options).map(o => ({ value: o.value, text: (o.text || "").trim() }))
    : undefined,
    radio_group: (el.type === "radio" && el.name)
    ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`))
        .map(r => ({
            value: r.value || "",
            label: (r.closest("label")?.innerText || "").trim()
        }))
    : undefined,
  }));
}

// Generic setter used by some earlier versions / helpers.
// Current code-path sets values inline in APPLY_MAPPINGS, but keeping this is harmless.
function setValue(el, value) {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "").toLowerCase();

  if (tag === "select") {
    const target = value.toLowerCase();
    const opt =
      Array.from(el.options).find(o => (o.value || "").toLowerCase() === target) ||
      Array.from(el.options).find(o => (o.text || "").toLowerCase() === target);

    if (opt) el.value = opt.value;
    else el.value = value; // last resort
  } else if (type === "checkbox" || type === "radio") {
    const v = value.trim().toLowerCase();
    el.checked = (v === "true" || v === "yes" || v === "1" || v === "checked");
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    // Message protocol:
    // - EXTRACT_FORM_FIELDS -> { fields: [...] }
    // - APPLY_MAPPINGS -> applies mappings and returns { updated, skipped }
    if (msg?.type === "EXTRACT_FORM_FIELDS") {
      sendResponse({ fields: extractFields() });
      return;
    }

    if (msg?.type === "APPLY_MAPPINGS") {
      let updated = 0, skipped = 0;

      // Apply each mapping to the current DOM.
      for (const m of (msg.mappings || [])) {
        const sel = m?.selector;
        const raw = m?.value;
        const kind = (m?.kind || "").toLowerCase();

        if (!sel) { skipped++; continue; }

        let el;
        try { el = document.querySelector(sel); } catch { el = null; }
        if (!el) { skipped++; continue; }

        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute("type") || "").toLowerCase();

        // File inputs cannot be set programmatically for security.
        if (type === "file") { skipped++; continue; }

        // Normalize val (string by schema, but handle multi_select encoded JSON array string).
        let val = raw;

        if (kind === "multi_select" && typeof val === "string") {
          const s = val.trim();
          if (s.startsWith("[") && s.endsWith("]")) {
            try {
              const arr = JSON.parse(s);
              if (Array.isArray(arr)) val = arr;
            } catch {}
          }
        }

        // Checkbox: accept common truthy strings.
        if (type === "checkbox") {
          const v = String(val ?? "").trim().toLowerCase();
          el.checked = (v === "true" || v === "yes" || v === "1" || v === "checked" || v === "on");
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          updated++;
          continue;
        }

        // Radio: try to match by value first, then by label text.
        if (type === "radio") {
          const v = String(val ?? "").trim().toLowerCase();

          if (el.name) {
            const group = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`));
            const pick =
              group.find(r => String(r.value || "").trim().toLowerCase() === v) ||
              group.find(r => (r.closest("label")?.innerText || "").trim().toLowerCase() === v);

            if (pick) {
              pick.checked = true;
              pick.dispatchEvent(new Event("input", { bubbles: true }));
              pick.dispatchEvent(new Event("change", { bubbles: true }));
              updated++;
              continue;
            }
          }

          // Fallback: set this radio if truthy.
          if (v === "true" || v === "yes" || v === "1" || v === "checked" || v === "on") {
            el.checked = true;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            updated++;
            continue;
          }

          skipped++;
          continue;
        }

        // Select (single/multi): match options by value or visible text.
        if (tag === "select") {
          const isMultiple = el.multiple === true;

          const wanted = Array.isArray(val)
            ? val.map(x => String(x).trim().toLowerCase()).filter(Boolean)
            : [String(val ?? "").trim().toLowerCase()].filter(Boolean);

          if (!wanted.length) { skipped++; continue; }

          const options = Array.from(el.options);

          const resolveOne = (w) =>
            options.find(o => String(o.value || "").trim().toLowerCase() === w) ||
            options.find(o => String(o.text || "").trim().toLowerCase() === w);

          if (isMultiple) {
            let any = false;
            for (const o of options) o.selected = false;

            for (const w of wanted) {
              const opt = resolveOne(w);
              if (opt) { opt.selected = true; any = true; }
            }

            if (!any) { skipped++; continue; }

            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            updated++;
            continue;
          }

          const opt = resolveOne(wanted[0]);
          if (!opt) { skipped++; continue; }

          el.value = opt.value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          updated++;
          continue;
        }

        // Default: text-like inputs and textarea.
        const textValue = (val === null || typeof val === "undefined") ? "" : String(val);
        el.value = textValue;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        updated++;
      }

      sendResponse({ updated, skipped });
      return;
    }
  } catch (e) {
    // Ensure the sender gets a useful error string.
    sendResponse({ error: String(e.message || e) });
  }
});

