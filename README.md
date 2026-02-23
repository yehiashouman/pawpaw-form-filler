# Paw Paw AI Form Filler
Chat GPT based One-Click Form Filler (Chrome Extension)
Paw Paw is a Chrome extension that reads your document and automatically fills web forms using OpenAI.
Upload a document, provide your own OpenAI API key (session only), and populate the current page in one click.

I wrote this because I was lazy to fill forms.
---

## Features
- One-click form filling  
- Supports `.pdf`, `.doc`, `.docx`  
- Uses your own OpenAI API key  
- API key stored in session only (not saved)  
- Custom extra instructions support  
- Works on most structured web forms  
- Screenshot-aware form analysis  

---

## IMPORTANT
Paw Paw does not proxy or store your data, files, urls, tokens used on the chrome extension. The source code is shared here.


## Why You Must Use Your Own OpenAI API Key
To ensure that the files you upload are ONLY going to your account.
The key is stored in session only and must be re-entered when the browser session ends.

You provide your own OpenAI API key so:
- Your data goes directly from your browser to OpenAI  
- No third-party server stores your documents  
- You control usage and billing  
- Your key remains private  


---
## How to Get an OpenAI API Key
1. Go to https://platform.openai.com/  
2. Sign in or create an account  
3. Navigate to **API Keys**  
4. Click **Create new secret key**  
5. Copy the key and paste it into the extension  
You are responsible for your own OpenAI usage charges.

---
## Supported File Types
PDF (.pdf), Microsoft Word (.doc) and Microsoft Word (.docx)
 
The document is analyzed and mapped to detected form fields on the current page.
---

## Custom Instructions
You can provide optional extra instructions to guide how the AI fills forms.

Examples:
- Prioritize accuracy over completeness  
- Use a professional tone  
- Tailor answers to a specific job role  
- Keep responses concise  
These instructions are appended to the prompt sent to OpenAI.

---

## How It Works
1. Enter your OpenAI API key  
2. Upload a supported document  
3. Optionally add custom instructions  
4. Click “Analyze & Fill Current Page”  
5. The extension extracts form fields from the current page  
6. OpenAI generates structured mappings  
7. The extension populates the fields automatically  
---

## Permissions Explained
- `activeTab` – Access current page when triggered  
- `scripting` – Inject form-filling logic  
- `storage` – Store session key  
- `host_permissions` for OpenAI API  

No external backend server is used.
---

## Intended Use
Best suited for:
- Lazy people like me
- Job applications  
- Profile forms  
- Registration pages  
- Structured or semi-structured forms  

Complex dynamic forms may require manual adjustments.
---

## Disclaimer
Paw Paw uses OpenAI’s API.  
Users are responsible for:
- API key security  
- API usage costs  
- Reviewing generated content before submission  
- Always verifying information on filled forms before submission.

## License
This project is licensed under the GNU General Public License v3.0 (GPL‑3.0).
See the full text of the license here: GNU GPL v3
