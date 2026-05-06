# Passport Extractor

This is a minimal Next.js app that keeps only the passport extractor feature.

## Routes

- `/` renders the passport extractor page
- `/passport-extractor` renders the same page

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your local env file:

```bash
cp .env.example .env.local
```

3. Configure the local Ollama OpenAI-compatible endpoint:

```bash
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_API_KEY=ollama
OLLAMA_MODEL=qwen2.5vl:7b
OLLAMA_TIMEOUT_MS=120000
```

Make sure Ollama is running and the model is available:

```bash
ollama serve
ollama list
```

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
npm run build
```

## Notes

- The template list is stored in `localStorage` under `pe_templates`.
- The API route is `POST /api/passport-extractor`.
- The app calls Ollama's OpenAI-compatible `/chat/completions` endpoint with `qwen2.5vl:7b`.
- The API has three modes: `health` for text inference checks, `detect` for template creation, and `extract` for template-based passport inference.
- Saved templates include normalized field keys, labels, and the extraction system prompt used for later inference.
