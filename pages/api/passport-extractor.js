const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1').replace(/\/+$/, '');
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || 'ollama';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5vl:7b';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120000);
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '30m';
const OLLAMA_MAX_TOKENS = Number(process.env.OLLAMA_MAX_TOKENS || 1024);

const BASE_SYSTEM_PROMPT = `You are a strict passport OCR extraction engine.

Core rules:
- Return only valid JSON. No markdown, no code fences, no prose.
- Read only what is visible in the passport image.
- Do not guess, infer, complete, translate, or invent values.
- If a requested value is missing, cropped, blurry, or uncertain, use null.
- Preserve values exactly as printed, including spaces, punctuation, slash-separated dates, and MRZ text.
- Use uppercase snake_case field keys.`;

const EXTRACT_ALL_PROMPT = `Extract all visible passport fields from the image.

Return contract:
- Return exactly one JSON object.
- Use stable uppercase snake_case keys.
- Include all visible passport identity fields, dates, document numbers, places, authority fields, and MRZ lines.
- Use null only when a label is visible but the value is not readable.
- Do not add explanations, confidence scores, markdown, or fields that are not visible.

Suggested keys when visible:
TYPE, COUNTRY_CODE, PASSPORT_NUMBER, SURNAME, GIVEN_NAMES, SEX, NATIONALITY, DATE_OF_BIRTH, PLACE_OF_BIRTH, DATE_OF_ISSUE, DATE_OF_EXPIRY, PLACE_OF_ISSUE, AUTHORITY, NATIONAL_ID, FATHER_NAME, MOTHER_NAME, MRZ_LINE_1, MRZ_LINE_2.`;

export const config = {
  maxDuration: 120,
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

function sanitizeResults(value, depth = 0) {
  if (depth > 5) return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeResults(item, depth + 1));
  }

  if (value && typeof value === 'object') {
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === 'value' && typeof item === 'string') {
        const trimmed = item.trim();
        if (/^(the extracted value|not found|unknown|n\/a|xxx|test|sample|demo|example)/i.test(trimmed)) {
          next[key] = null;
          continue;
        }
        if (/^[A-Z_]+$/.test(trimmed) && trimmed.length > 5 && !trimmed.includes(' ')) {
          next[key] = null;
          continue;
        }
      }
      next[key] = sanitizeResults(item, depth + 1);
    }
    return next;
  }

  return value;
}

function extractJson(text) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const trimmed = String(match ? match[1] : text).trim();
  const candidates = [trimmed];

  const firstObject = trimmed.indexOf('{');
  const lastObject = trimmed.lastIndexOf('}');
  if (firstObject !== -1 && lastObject > firstObject) {
    candidates.push(trimmed.slice(firstObject, lastObject + 1));
  }

  const firstArray = trimmed.indexOf('[');
  const lastArray = trimmed.lastIndexOf(']');
  if (firstArray !== -1 && lastArray > firstArray) {
    candidates.push(trimmed.slice(firstArray, lastArray + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`Model did not return valid JSON: ${trimmed.slice(0, 400)}`);
}

function resolveModel(model) {
  return String(model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function withMeta(payload, meta) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...payload, _meta: meta };
  }

  return { result: payload, _meta: meta };
}

async function generateWithModel({
  systemPrompt = BASE_SYSTEM_PROMPT,
  userPrompt,
  imageBase64,
  imageMimeType,
  model,
  maxTokens = OLLAMA_MAX_TOKENS,
}) {
  const content = [{ type: 'text', text: userPrompt }];
  const selectedModel = resolveModel(model);
  const startedAt = Date.now();

  if (imageBase64 && imageMimeType) {
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${imageMimeType};base64,${imageBase64}`,
      },
    });
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${OLLAMA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: selectedModel,
      temperature: 0,
      stream: false,
      think: false,
      keep_alive: OLLAMA_KEEP_ALIVE,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content,
        },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data?.error?.message || data?.error || response.statusText;
    throw new Error(`Ollama request failed: ${detail}`);
  }

  return {
    text: data?.choices?.[0]?.message?.content || '{}',
    meta: {
      model: data?.model || selectedModel,
      model_ms: Date.now() - startedAt,
      keep_alive: OLLAMA_KEEP_ALIVE,
      think: false,
      usage: data?.usage || null,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mode, imageBase64, imageMimeType, fields, systemPrompt, model } = req.body || {};
  const selectedModel = resolveModel(model);
  const requestStartedAt = Date.now();

  if (mode === 'health') {
    try {
      const generation = await generateWithModel({
        userPrompt: `Return exactly this JSON object with your actual model name:
{"ok":true,"model":"${selectedModel}","message":"ready"}`,
        model: selectedModel,
        maxTokens: 64,
      });
      const result = extractJson(generation.text);
      return res.status(200).json({
        ok: result.ok === true,
        model: result.model || selectedModel,
        message: result.message || 'ready',
        _meta: {
          ...generation.meta,
          processing_ms: Date.now() - requestStartedAt,
        },
      });
    } catch (error) {
      console.error('Passport extractor health check error:', error);
      return res.status(500).json({ error: error.message || 'Ollama inference check failed' });
    }
  }

  if (!imageBase64 || !imageMimeType) {
    return res.status(400).json({ error: 'Image data required' });
  }

  try {
    if (mode === 'detect') {
      const generation = await generateWithModel({
        systemPrompt: `${BASE_SYSTEM_PROMPT}

You are in template creation mode. Convert the user's plain-English field request into stable passport extraction fields, then read sample values from the image when visible.`,
        userPrompt: `Field request:
${fields}

Return only valid JSON using this exact structure:
{
  "detected_fields": [
    {
      "field_name": "PASSPORT_NO",
      "label": "Passport Number",
      "value": "extracted value or null"
    }
  ]
}

Requirements:
- Include every requested field, even when the sample image value is not visible.
- field_name must be stable uppercase snake_case, for example PASSPORT_NUMBER or DATE_OF_BIRTH.
- label must be a short human-readable label.
- value must be the exact visible sample value or null.
- Do not add fields the user did not ask for.`,
        imageBase64,
        imageMimeType,
        model: selectedModel,
      });
      return res.status(200).json(
        withMeta(sanitizeResults(extractJson(generation.text)), {
          ...generation.meta,
          processing_ms: Date.now() - requestStartedAt,
        }),
      );
    }

    if (mode === 'extract') {
      const extractionPrompt = systemPrompt || EXTRACT_ALL_PROMPT;

      const generation = await generateWithModel({
        systemPrompt: `${BASE_SYSTEM_PROMPT}

${extractionPrompt}`,
        userPrompt: systemPrompt
          ? 'Extract the configured passport fields from this image. Return only the JSON object required by the template.'
          : 'Extract all visible passport fields from this image. Return only one flat JSON object.',
        imageBase64,
        imageMimeType,
        model: selectedModel,
      });
      return res.status(200).json(
        withMeta(sanitizeResults(extractJson(generation.text)), {
          ...generation.meta,
          processing_ms: Date.now() - requestStartedAt,
        }),
      );
    }

    return res.status(400).json({ error: 'Invalid mode. Use "detect" or "extract".' });
  } catch (error) {
    console.error('Passport extraction API error:', error);
    return res.status(500).json({ error: error.message || 'AI extraction failed' });
  }
}
