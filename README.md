# Local OCR Passport Extractor

Local Next.js app for passport-field extraction with Ollama VLMs, plus optional PaddleOCR for default non-template OCR output.

This repository is **public** on GitHub and currently uses **`vlm-qwen`** as the default branch.

## Features

- Create extraction templates from a sample passport image.
- Save templates in browser `localStorage`.
- Extract fields from new passport images with local Ollama models.
- Run default no-template extraction in two ways:
  - `VLM extraction`
  - `PaddleOCR text`
- Show end-to-end processing time and model/OCR processing time in the UI.

## Architecture

### Template mode

1. User uploads a sample passport.
2. UI compresses the image before upload.
3. `POST /api/passport-extractor` with `mode=detect`.
4. Ollama VLM returns normalized template fields.
5. Template is stored in browser `localStorage`.

### Extraction mode

1. User selects a saved template or leaves template empty.
2. UI uploads a compressed image to `POST /api/passport-extractor`.
3. If a template is selected, extraction uses the VLM path only.
4. If no template is selected:
   - `VLM extraction` uses Ollama VLM.
   - `PaddleOCR text` runs the Python OCR subprocess and returns OCR blocks.

## Repository Layout

```text
.
├── README.md
├── AGENTS.md
├── llms.txt
├── .env.example
├── .gitignore
├── package.json
├── pages/
│   ├── _app.js
│   ├── index.js
│   ├── passport-extractor.js
│   └── api/passport-extractor.js
├── styles/
│   ├── globals.css
│   └── passport-extractor.css
├── scripts/
│   └── paddle_ocr.py
└── requirements.txt
```

## Setup

### 1. Install Node dependencies

```bash
npm install
cp .env.example .env.local
```

### 2. Install Ollama models

```bash
ollama pull qwen2.5vl:7b
ollama pull qwen3.5:2b
ollama list
```

Use `qwen2.5vl:7b` for normal passport image extraction.

### 3. Optional PaddleOCR setup

Only required if you want the `PaddleOCR text` option in default no-template mode.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 4. Configure environment

`.env.example`:

```bash
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_API_KEY=ollama
OLLAMA_MODEL=qwen2.5vl:7b
OLLAMA_TIMEOUT_MS=120000
OLLAMA_KEEP_ALIVE=30m
OLLAMA_MAX_TOKENS=1024
PADDLE_OCR_PYTHON=.venv/bin/python
PADDLE_OCR_LANGS=en,ar
PADDLE_OCR_TIMEOUT_MS=120000
```

Notes:

- `.env.local` is ignored by Git.
- Do not commit real secrets or machine-specific paths.
- If `health` reports `model not found`, update `OLLAMA_MODEL` or install the model locally.

## Run

Start Ollama:

```bash
ollama serve
```

Start the app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/passport-extractor
```

## API

Endpoint:

```text
POST /api/passport-extractor
```

Supported modes:

- `health`: checks local Ollama connectivity.
- `detect`: creates normalized template fields from a sample image.
- `extract`: runs either template extraction or default extraction.

Important request behavior:

- `detect` and template `extract` use the VLM path.
- Default `extract` without a template can use `engine=vlm` or `engine=paddleocr`.
- Ollama requests send `think:false`, `keep_alive`, and `max_tokens`.

## Validation

Validated locally:

```bash
npm run build
```

Recommended smoke checks:

```bash
curl -X POST http://localhost:3000/api/passport-extractor \
  -H 'Content-Type: application/json' \
  -d '{"mode":"health","model":"qwen2.5vl:7b"}'
```

If using PaddleOCR, also validate:

```bash
.venv/bin/python scripts/paddle_ocr.py --health
```

## Scope Boundaries

Keep:

- Local passport extraction UI
- Local template storage in browser
- Ollama VLM extraction
- Optional PaddleOCR default-mode OCR output

Exclude:

- Cloud OCR providers
- Server-side database storage
- Authentication
- Fine-tuning or training workflows
- General document extraction beyond the current passport-focused flow

## Agent Docs

This repo also includes:

- [AGENTS.md](/Users/waiyan/Downloads/AI_Projects/Local_OCR/local-ocr-app/AGENTS.md)
- [llms.txt](/Users/waiyan/Downloads/AI_Projects/Local_OCR/local-ocr-app/llms.txt)
