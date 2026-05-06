const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1').replace(/\/+$/, '');
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || 'ollama';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5vl:7b';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120000);

const BASE_SYSTEM_PROMPT = `You are a strict passport OCR extraction engine.

Core rules:
- Return only valid JSON. No markdown, no code fences, no prose.
- Read only what is visible in the passport image.
- Do not guess, infer, complete, translate, or invent values.
- If a requested value is missing, cropped, blurry, or uncertain, use null.
- Preserve values exactly as printed, including spaces, punctuation, slash-separated dates, and MRZ text.
- Use uppercase snake_case field keys.`;

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

async function generateWithModel({ systemPrompt = BASE_SYSTEM_PROMPT, userPrompt, imageBase64, imageMimeType }) {
  const content = [{ type: 'text', text: userPrompt }];

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
      model: MODEL,
      temperature: 0,
      stream: false,
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

  return data?.choices?.[0]?.message?.content || '{}';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mode, imageBase64, imageMimeType, fields, systemPrompt } = req.body || {};

  if (mode === 'health') {
    try {
      const text = await generateWithModel({
        userPrompt: `Return exactly this JSON object with your actual model name:
{"ok":true,"model":"${MODEL}","message":"ready"}`,
      });
      const result = extractJson(text);
      return res.status(200).json({
        ok: result.ok === true,
        model: result.model || MODEL,
        message: result.message || 'ready',
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
      const text = await generateWithModel({
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
      });
      return res.status(200).json(sanitizeResults(extractJson(text)));
    }

    if (mode === 'extract') {
      if (!systemPrompt) {
        return res.status(400).json({ error: 'Template system prompt required' });
      }

      const text = await generateWithModel({
        systemPrompt: `${BASE_SYSTEM_PROMPT}

${systemPrompt}`,
        userPrompt: 'Extract the configured passport fields from this image. Return only the JSON object required by the template.',
        imageBase64,
        imageMimeType,
      });
      return res.status(200).json(sanitizeResults(extractJson(text)));
    }

    return res.status(400).json({ error: 'Invalid mode. Use "detect" or "extract".' });
  } catch (error) {
    console.error('Passport extraction API error:', error);
    return res.status(500).json({ error: error.message || 'AI extraction failed' });
  }
}
