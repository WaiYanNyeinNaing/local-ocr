# AGENTS.md

## Critical Rules

- Keep this repo focused on local passport extraction only.
- Do not commit `.env.local`, local secrets, model caches, `.next/`, `node_modules/`, or `.venv/`.
- Template extraction must stay VLM-only unless the user explicitly changes the product requirement.
- Default no-template extraction may use VLM or PaddleOCR.
- Prefer updating `README.md`, this file, and `llms.txt` together when runtime behavior changes.
- Validate changes with `npm run build` before pushing.

## Exact Commands

Install:

```bash
npm install
cp .env.example .env.local
```

Run Ollama:

```bash
ollama serve
ollama list
```

Recommended models:

```bash
ollama pull qwen2.5vl:7b
ollama pull qwen3.5:2b
```

Optional PaddleOCR:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/paddle_ocr.py --health
```

Run app:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Quick API smoke check:

```bash
curl -X POST http://localhost:3000/api/passport-extractor \
  -H 'Content-Type: application/json' \
  -d '{"mode":"health","model":"qwen2.5vl:7b"}'
```

## Project Map

- `pages/passport-extractor.js`
  Frontend UI for template creation, template browsing, extraction mode, model selection, and timing display.

- `pages/api/passport-extractor.js`
  Single API route for `health`, `detect`, and `extract`.

- `scripts/paddle_ocr.py`
  Optional Python subprocess used only for default no-template OCR mode.

- `requirements.txt`
  Python dependencies for PaddleOCR mode.

- `.env.example`
  Required runtime environment variables.

- `styles/passport-extractor.css`
  Route-specific UI styling.

## Contracts

### UI contracts

- Templates are stored in browser `localStorage` under `pe_templates`.
- Uploaded images are compressed client-side before API submission.
- Saved template extraction always uses the VLM path.
- Default extraction without a template may use:
  - `engine=vlm`
  - `engine=paddleocr`

### API contracts

Endpoint:

```text
POST /api/passport-extractor
```

Modes:

- `health`
- `detect`
- `extract`

Environment variables:

- `OLLAMA_BASE_URL`
- `OLLAMA_API_KEY`
- `OLLAMA_MODEL`
- `OLLAMA_TIMEOUT_MS`
- `OLLAMA_KEEP_ALIVE`
- `OLLAMA_MAX_TOKENS`
- `PADDLE_OCR_PYTHON`
- `PADDLE_OCR_LANGS`
- `PADDLE_OCR_TIMEOUT_MS`

## Validation Gate

Before pushing:

```bash
npm run build
git diff --check
```

If PaddleOCR code changed:

```bash
.venv/bin/python scripts/paddle_ocr.py --health
```

If docs changed, ensure:

- README commands still match `package.json`
- `.env.example` matches runtime expectations
- No real credentials were added

## Design Intent

- Keep setup local-first and minimal.
- Keep the repo maintainable for both humans and coding agents.
- Prefer explicit contracts over implicit behavior.

## Negative Constraints

- Do not add hosted secrets or external OCR services silently.
- Do not widen scope into general document AI without explicit direction.
- Do not store user passports server-side by default.
