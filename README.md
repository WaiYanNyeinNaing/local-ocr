# Local OCR Passport Extractor

Minimal Next.js UI for extracting passport fields with local Ollama models.

## Prerequisites

- Node.js 20+
- npm
- Ollama running locally

## Install App Dependencies

```bash
npm install
cp .env.example .env.local
```

Default `.env.local`:

```bash
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_API_KEY=ollama
OLLAMA_MODEL=qwen2.5vl:7b
OLLAMA_TIMEOUT_MS=120000
OLLAMA_KEEP_ALIVE=30m
OLLAMA_MAX_TOKENS=1024
```

## Install Ollama Models

```bash
ollama pull qwen2.5vl:7b
ollama pull qwen3.5:2b
ollama list
```

Use `qwen2.5vl:7b` for direct image extraction. `qwen3.5:2b` is available in the selector, but use it only if your local model/runtime supports the selected inference path.

## Start The UI

In one terminal, start Ollama if it is not already running:

```bash
ollama serve
```

In the app folder:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/passport-extractor
```

## Build Check

```bash
npm run build
```

## Notes

- Templates are stored in browser `localStorage` under `pe_templates`.
- The Extract tab supports saved templates or default `Extract all visible fields` mode.
- The API route is `POST /api/passport-extractor`.
- Requests send `think:false`, `keep_alive`, and `max_tokens` to Ollama.
- The UI displays total processing time and model API time after extraction.
