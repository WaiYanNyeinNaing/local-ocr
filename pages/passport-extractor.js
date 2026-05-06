import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';

const STORAGE_KEY = 'pe_templates';

export default function PassportExtractorPage() {
  const [tab, setTab] = useState('create');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  return (
    <>
      <Head>
        <title>Passport Extractor</title>
        <meta
          name="description"
          content="Upload a passport, define fields in plain English, and extract them with a local Vision LM."
        />
      </Head>

      <main className="pe-shell">
        <section className="pe-hero">
          <p className="pe-kicker">Passport Extractor</p>
          <h1>Extract passport fields from images with Vision LM</h1>
          <p className="pe-lead">
            Create reusable templates from a sample passport, then extract the same fields from new scans.
            The home route and <code>/passport-extractor</code> both point here.
          </p>
        </section>

        <ModelStatus setError={setError} />

        <nav className="pe-tabs" aria-label="Passport extractor modes">
          <button className={`pe-tab ${tab === 'create' ? 'active' : ''}`} onClick={() => setTab('create')}>
            Create Template
          </button>
          <button className={`pe-tab ${tab === 'templates' ? 'active' : ''}`} onClick={() => setTab('templates')}>
            My Templates
          </button>
          <button className={`pe-tab ${tab === 'extract' ? 'active' : ''}`} onClick={() => setTab('extract')}>
            Extract
          </button>
        </nav>

        {error && <div className="pe-banner pe-error">{error}</div>}
        {success && <div className="pe-banner pe-success">{success}</div>}

        <section className="pe-panel">
          {tab === 'create' && <CreateTab setError={setError} setSuccess={setSuccess} />}
          {tab === 'templates' && (
            <TemplatesTab
              setTab={setTab}
              setError={setError}
              setSuccess={setSuccess}
              setSelectedTemplateId={setSelectedTemplateId}
            />
          )}
          {tab === 'extract' && (
            <ExtractTab
              selectedTemplateId={selectedTemplateId}
              setSelectedTemplateId={setSelectedTemplateId}
              setTab={setTab}
              setError={setError}
              setSuccess={setSuccess}
            />
          )}
        </section>
      </main>
    </>
  );
}

function buildSystemPrompt(templateName, fieldSchema) {
  const normalizedFields = normalizeFieldSchema(fieldSchema);
  const fieldLines = normalizedFields
    .map((field) => `- ${field.key}: ${field.label}`)
    .join('\n');
  const jsonKeys = normalizedFields.map((field) => field.key);
  const example = Object.fromEntries(jsonKeys.map((key) => [key, null]));

  return `Template name: "${templateName}"

Extract only the following fields from the passport image:
${fieldLines}

Return contract:
- Return exactly one JSON object.
- Use exactly these JSON keys and no others: ${jsonKeys.map((key) => `"${key}"`).join(', ')}.
- Each value must be a string copied from the passport image or null.
- If a field is not visible or uncertain, use null.
- Do not guess, infer, translate, normalize dates, or invent missing values.
- Preserve spelling, punctuation, spaces, slashes, hyphens, and MRZ text exactly as visible.

Example:
${JSON.stringify(example, null, 2)}`;
}

function normalizeKey(value) {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'FIELD';
}

function normalizeFieldSchema(fields) {
  const seen = new Set();

  return (fields || [])
    .map((field, index) => {
      const source = typeof field === 'string' ? { label: field } : field || {};
      const label = String(source.label || source.field_name || source.key || `Field ${index + 1}`).trim();
      let key = normalizeKey(source.key || source.field_name || label);

      if (seen.has(key)) {
        key = `${key}_${index + 1}`;
      }
      seen.add(key);

      return {
        key,
        field_name: key,
        label,
        value: source.value ?? null,
      };
    })
    .filter((field) => field.label && field.key);
}

function fieldsForTemplate(template) {
  if (Array.isArray(template?.fieldSchema) && template.fieldSchema.length > 0) {
    return normalizeFieldSchema(template.fieldSchema);
  }

  if (Array.isArray(template?.fieldLabels) && template.fieldLabels.length > 0) {
    return normalizeFieldSchema(
      template.fieldLabels.map((label, index) => ({
        label,
        key: template.fieldKeys?.[index] || normalizeKey(label),
      })),
    );
  }

  return [];
}

function loadTemplates() {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveTemplates(nextTemplates) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextTemplates));
}

function upsertTemplate(template) {
  const templates = loadTemplates();
  const next = [
    ...templates,
    { ...template, id: crypto.randomUUID(), created_at: new Date().toISOString() },
  ];
  saveTemplates(next);
  return next;
}

function removeTemplate(id) {
  const next = loadTemplates().filter((template) => template.id !== id);
  saveTemplates(next);
  return next;
}

function parseExtractionResult(result) {
  const fields =
    result?.extracted_fields ||
    result?.detected_fields ||
    (result?.fields
      ? Object.entries(result.fields).map(([field_name, value]) => ({
          field_name,
          value: typeof value === 'object' ? value?.text ?? JSON.stringify(value) : value,
        }))
      : null);

  if (fields) {
    return fields;
  }

  if (result && typeof result === 'object') {
    return Object.entries(result)
      .filter(([key]) => key !== 'detected_fields' && key !== 'extracted_fields')
      .map(([field_name, value]) => ({
        field_name,
        value: typeof value === 'object' ? JSON.stringify(value) : String(value),
      }));
  }

  return [];
}

function chooseImage(onPick) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (event) => {
    const file = event.target.files?.[0];
    if (file) onPick(file);
  };
  input.click();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileToBase64(file) {
  return fileToDataUrl(file).then((dataUrl) => {
    const [meta, base64] = dataUrl.split(',');
    const mimeType = meta?.match(/data:(.*);base64/)?.[1] || file.type || 'image/jpeg';
    return { base64, mimeType };
  });
}

function compressImage(file, maxDim = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(maxDim / image.width, maxDim / image.height, 1);
        const width = Math.round(image.width * scale);
        const height = Math.round(image.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Canvas context not available'));
          return;
        }

        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Image compression failed'));
              return;
            }

            fileToBase64(blob).then(resolve).catch(reject);
          },
          'image/jpeg',
          quality,
        );
      };
      image.onerror = reject;
      image.src = String(readerEvent.target?.result || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function callApi(payload) {
  const response = await fetch('/api/passport-extractor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function ModelStatus({ setError }) {
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState(null);

  const handleCheck = useCallback(async () => {
    setChecking(true);
    setError(null);

    try {
      const result = await callApi({ mode: 'health' });
      setStatus(result);
    } catch (error) {
      setStatus(null);
      setError(error.message);
    } finally {
      setChecking(false);
    }
  }, [setError]);

  return (
    <section className="pe-model-card">
      <div>
        <strong>Local inference</strong>
        <p>Ollama OpenAI-compatible API, default model <code>qwen2.5vl:7b</code>.</p>
      </div>
      <button className="pe-button pe-button-secondary" onClick={handleCheck} disabled={checking}>
        {checking ? 'Testing...' : 'Test inference'}
      </button>
      {status?.ok && <span className="pe-model-ok">{status.model || 'Model'} ready</span>}
    </section>
  );
}

function CreateTab({ setError, setSuccess }) {
  const [templateName, setTemplateName] = useState('');
  const [fieldInput, setFieldInput] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detected, setDetected] = useState(null);
  const [step, setStep] = useState('upload');

  const handleImage = useCallback((file) => {
    setImageFile(file);
    setDetected(null);
    setStep('upload');
    fileToDataUrl(file).then(setImagePreview);
  }, []);

  const handleDetect = useCallback(async () => {
    if (!imageFile || !fieldInput.trim() || !templateName.trim()) {
      setError('Fill in the template name, field description, and image upload first.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { base64, mimeType } = await compressImage(imageFile);
      const result = await callApi({
        mode: 'detect',
        imageBase64: base64,
        imageMimeType: mimeType,
        fields: fieldInput.trim(),
      });

      const detectedFields = normalizeFieldSchema(result.detected_fields);

      if (!detectedFields.length) {
        throw new Error('No fields were detected. Make the description more specific.');
      }

      setDetected(detectedFields);
      setStep('preview');
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }, [fieldInput, imageFile, setError, templateName]);

  const handleSave = useCallback(() => {
    if (!detected?.length) return;

    const fieldSchema = normalizeFieldSchema(detected);
    const fieldLabels = fieldSchema.map((item) => item.label);
    const fieldKeys = fieldSchema.map((item) => item.key);
    const systemPrompt = buildSystemPrompt(templateName, fieldSchema);

    upsertTemplate({
      name: templateName,
      promptVersion: 2,
      fieldSchema,
      fieldLabels,
      fieldKeys,
      systemPrompt,
    });

    setSuccess(`Template "${templateName}" saved with ${detected.length} fields.`);
    setStep('saved');
    setTemplateName('');
    setFieldInput('');
    setImageFile(null);
    setImagePreview(null);
    setDetected(null);
  }, [detected, setSuccess, templateName]);

  const reset = useCallback(() => {
    setStep('upload');
    setTemplateName('');
    setFieldInput('');
    setImageFile(null);
    setImagePreview(null);
    setDetected(null);
  }, []);

  return (
    <div className="pe-grid">
      {step === 'upload' && (
        <>
          <section className="pe-card">
            <h2>1. Upload a sample passport</h2>
            <div className="pe-upload-zone" onClick={() => chooseImage(handleImage)}>
              {imagePreview ? (
                <>
                  <img src={imagePreview} alt="Passport preview" className="pe-preview" />
                  <p>{imageFile?.name}</p>
                </>
              ) : (
                <>
                  <p>Drop a passport image here, or click to browse.</p>
                  <span>JPEG, PNG, WebP</span>
                </>
              )}
            </div>
          </section>

          <section className="pe-card">
            <h2>2. Describe what to extract</h2>
            <label className="pe-field">
              <span>Template name</span>
              <input
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="e.g. Morocco Passport"
              />
            </label>
            <label className="pe-field">
              <span>Fields to extract</span>
              <textarea
                rows={5}
                value={fieldInput}
                onChange={(event) => setFieldInput(event.target.value)}
                placeholder="Extract passport number, surname, given names, date of birth, and expiration date."
              />
            </label>
            <button
              className="pe-button"
              onClick={handleDetect}
              disabled={loading || !imageFile || !fieldInput.trim() || !templateName.trim()}
            >
              {loading ? 'Analyzing...' : 'Detect & Preview'}
            </button>
          </section>
        </>
      )}

      {step === 'preview' && detected && (
        <section className="pe-card pe-card-wide">
          <h2>3. Preview & confirm</h2>
          {imagePreview && <img src={imagePreview} alt="Passport preview" className="pe-preview pe-preview-large" />}
          <div className="pe-results">
            {detected.map((item) => (
              <div className="pe-result-row" key={item.field_name}>
                <span className="pe-result-name">{item.label || item.field_name}</span>
                <span className="pe-result-value">{item.value || <em>not found</em>}</span>
              </div>
            ))}
          </div>
          <div className="pe-actions">
            <button className="pe-button" onClick={handleSave}>
              Save template
            </button>
            <button className="pe-button pe-button-secondary" onClick={reset}>
              Start over
            </button>
          </div>
        </section>
      )}

      {step === 'saved' && (
        <section className="pe-card pe-card-wide pe-centered">
          <p>Template saved.</p>
          <button className="pe-button" onClick={reset}>
            Create another
          </button>
        </section>
      )}
    </div>
  );
}

function TemplatesTab({ setTab, setError, setSuccess, setSelectedTemplateId }) {
  const [templates, setTemplates] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setTemplates(loadTemplates());
    setLoaded(true);
  }, []);

  const handleDelete = useCallback(
    (id, name) => {
      if (!window.confirm(`Delete "${name}"?`)) return;
      const next = removeTemplate(id);
      setTemplates(next);
      setSuccess(`"${name}" deleted.`);
      setError(null);
    },
    [setError, setSuccess],
  );

  if (!loaded) {
    return <div className="pe-loading">Loading templates...</div>;
  }

  if (!templates.length) {
    return (
      <div className="pe-empty">
        <p>No templates yet.</p>
        <button className="pe-button" onClick={() => setTab('create')}>
          Create template
        </button>
      </div>
    );
  }

  return (
    <div className="pe-template-grid">
      {templates.map((template) => {
        const fields = fieldsForTemplate(template);

        return (
          <article className="pe-template-card" key={template.id}>
            <h3>{template.name}</h3>
            <p>{fields.map((field) => field.label).join(', ')}</p>
            <div className="pe-actions">
              <button
                className="pe-button pe-button-secondary"
                onClick={() => {
                  setSelectedTemplateId(template.id);
                  setTab('extract');
                }}
              >
                Use
              </button>
              <button className="pe-button pe-button-danger" onClick={() => handleDelete(template.id, template.name)}>
                Delete
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ExtractTab({ selectedTemplateId, setSelectedTemplateId, setTab, setError, setSuccess }) {
  const [templates, setTemplates] = useState([]);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const nextTemplates = loadTemplates();
    setTemplates(nextTemplates);
    if (!selectedTemplateId && nextTemplates[0]?.id) {
      setSelectedTemplateId(nextTemplates[0].id);
    }
    setLoaded(true);
  }, [selectedTemplateId, setSelectedTemplateId]);

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) || null;
  const selectedFields = fieldsForTemplate(selectedTemplate);

  const handleExtract = useCallback(async () => {
    if (!selectedTemplate || !imageFile) return;

    setLoading(true);
    setError(null);

    try {
      const { base64, mimeType } = await compressImage(imageFile);
      const result = await callApi({
        mode: 'extract',
        imageBase64: base64,
        imageMimeType: mimeType,
        systemPrompt: selectedFields.length
          ? buildSystemPrompt(selectedTemplate.name, selectedFields)
          : selectedTemplate.systemPrompt,
      });

      setResults({
        fields: parseExtractionResult(result),
        raw: result,
      });

      setSuccess('Extraction complete.');
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }, [imageFile, selectedFields, selectedTemplate, setError, setSuccess]);

  if (!loaded) {
    return <div className="pe-loading">Loading templates...</div>;
  }

  if (!templates.length) {
    return (
      <div className="pe-empty">
        <p>No templates available.</p>
        <button className="pe-button" onClick={() => setTab('create')}>
          Create template
        </button>
      </div>
    );
  }

  return (
    <div className="pe-grid">
      <section className="pe-card">
        <h2>1. Select a template</h2>
        <div className="pe-template-grid">
          {templates.map((template) => (
            <button
              key={template.id}
              className={`pe-template-card ${selectedTemplateId === template.id ? 'selected' : ''}`}
              onClick={() => {
                setSelectedTemplateId(template.id);
                setResults(null);
              }}
            >
              <h3>{template.name}</h3>
              <p>{fieldsForTemplate(template).map((field) => field.label).join(', ')}</p>
            </button>
          ))}
        </div>
      </section>

      {selectedTemplate && (
        <section className="pe-card">
          <h2>2. Upload a new passport</h2>
          <p className="pe-template-summary">
            Template fields: {selectedFields.map((field) => field.label).join(', ')}
          </p>
          <div className="pe-upload-zone" onClick={() => chooseImage((file) => {
            setImageFile(file);
            setResults(null);
            fileToDataUrl(file).then(setImagePreview);
          })}>
            {imagePreview ? (
              <>
                <img src={imagePreview} alt="Passport upload preview" className="pe-preview" />
                <p>{imageFile?.name}</p>
              </>
            ) : (
              <p>Drop a passport image here, or click to browse.</p>
            )}
          </div>
          <button className="pe-button" onClick={handleExtract} disabled={loading || !imageFile}>
            {loading ? 'Extracting...' : 'Extract fields'}
          </button>
        </section>
      )}

      {results && (
        <section className="pe-card pe-card-wide">
          <h2>3. Extracted fields</h2>
          {results.fields.length > 0 ? (
            <div className="pe-results">
              {results.fields.map((field) => (
                <div className="pe-result-row" key={field.field_name}>
                  <span className="pe-result-name">{String(field.label || field.field_name).replace(/_/g, ' ')}</span>
                  <span className="pe-result-value">
                    {field.value || <em>not found</em>}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <pre className="pe-raw">{JSON.stringify(results.raw, null, 2)}</pre>
          )}
        </section>
      )}
    </div>
  );
}
