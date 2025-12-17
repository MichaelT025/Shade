# Configuration

Shade is BYOK (Bring Your Own Key): you connect your own model provider(s) by adding API keys and selecting models. Shade stores everything locally (no cloud sync).

## Where config lives

Shade writes its configuration into your OS user data directory.

- Main config: `shade-config.json`
- Provider catalog (editable list of providers/models): `shade-providers.json`
- Sessions (Phase 3): `sessions/*.json`

The exact `userData` path depends on your OS:

- Windows: `%APPDATA%/<YourAppName>/` (or similar)
- macOS: `~/Library/Application Support/<YourAppName>/`
- Linux: `~/.config/<YourAppName>/`

If you can’t find it, open Shade once and then search your machine for `shade-config.json`.

## Configure providers via Settings (recommended)

Use the in-app Settings window:

1. Open **Settings** (gear icon in the overlay).
2. Pick a provider from the dropdown.
3. Paste your API key.
4. Select a model from the dropdown.
5. (Optional) Click **Refresh Models** to fetch the latest models from the provider's API.
6. Click **Test** to verify the connection works.
7. Click **Save** and close settings.

Shade will use the **Active Provider** for new messages.

### Refreshing Models

Click the **Refresh Models** button next to any provider to automatically fetch the latest available models:

- **Cloud providers** (OpenAI, Gemini, OpenRouter): Fetches from their API using your API key
- **Local providers** (Ollama, LM Studio): Queries your local server to see what models are installed
- **Anthropic**: Updates from a manually maintained list (no public API available)

Models are cached for 7 days. You can manually refresh anytime to get newly released models without updating Shade.

## Supported provider types

Shade’s provider registry supports these types:

- `gemini` (Google Gemini)
- `openai` (OpenAI)
- `anthropic` (Claude)
- `openai-compatible` (any OpenAI-compatible server, including local)

## Provider setup quick steps

### Google Gemini

1. Create an API key: `https://makersuite.google.com/app/apikey`
2. In Settings, choose **Google Gemini**
3. Paste the key and pick a model (e.g. `gemini-2.0-flash-exp`)

### OpenAI

1. Create an API key: `https://platform.openai.com/api-keys`
2. In Settings, choose **OpenAI**
3. Paste the key and pick a model (e.g. `gpt-4o`)

### Anthropic Claude

1. Create an API key: `https://console.anthropic.com/`
2. In Settings, choose **Anthropic Claude**
3. Paste the key and pick a model

### Local / OpenAI-compatible (Ollama, LM Studio, etc.)

Use this when your server exposes an OpenAI-compatible API.

- Ollama default base URL: `http://localhost:11434/v1`
- LM Studio default base URL (common): `http://localhost:1234/v1`

Steps:

1. Ensure your local server is running and supports OpenAI-compatible chat.
2. In Settings, choose the local provider (for Ollama, it may already exist).
3. Confirm the **Base URL**.
4. Set a model name that your server exposes (for Ollama, e.g. `llama3.2`).
5. Leave API key blank if your server doesn’t require one.

## Advanced: Manual Configuration

### Editing `shade-providers.json`

For advanced users, you can directly edit `shade-providers.json` to add providers, models, or customize behavior.

**Location:** Same directory as `shade-config.json` (see "Where config lives" above)

**After editing:** Restart Shade or reopen Settings to see changes.

### Provider Structure

Each provider in `shade-providers.json` has this structure:

```json
{
  "provider-id": {
    "name": "Display Name",
    "type": "gemini|openai|anthropic|openai-compatible",
    "description": "Brief description",
    "website": "https://provider.com/api-keys",
    "baseUrl": "http://localhost:1234/v1",  // Only for openai-compatible
    "defaultModel": "model-id",
    "lastFetched": null,  // Timestamp of last model refresh (ISO 8601)
    "models": {
      "model-id": {
        "name": "Friendly Model Name",
        "options": {  // Optional: model-specific SDK options
          "reasoningEffort": "high"
        }
      }
    }
  }
}
```

### Required Fields

- **name**: Display name shown in UI
- **type**: One of: `gemini`, `openai`, `anthropic`, `openai-compatible`
- **models**: Object mapping model IDs to metadata

### Optional Fields

- **description**: Tooltip/help text in settings
- **website**: Link to get API keys
- **baseUrl**: Base URL for `openai-compatible` providers (required for that type)
- **defaultModel**: Model selected by default for new users
- **lastFetched**: Auto-managed timestamp for model cache (null = never fetched)

### Adding a New Model

To add a new model to an existing provider, edit the `models` object:

```json
{
  "openai": {
    "models": {
      "gpt-4o": { "name": "GPT-4o" },
      "gpt-5": { "name": "GPT-5" }  // Add this line
    }
  }
}
```

### Adding a New Provider

To add a completely new provider:

```json
{
  "groq": {
    "name": "Groq",
    "type": "openai-compatible",
    "description": "Ultra-fast inference",
    "website": "https://console.groq.com/keys",
    "baseUrl": "https://api.groq.com/openai/v1",
    "defaultModel": "llama-3.3-70b-versatile",
    "lastFetched": null,
    "models": {
      "llama-3.3-70b-versatile": { "name": "Llama 3.3 70B" },
      "mixtral-8x7b-32768": { "name": "Mixtral 8x7B" }
    }
  }
}
```

### Model-Specific Options

Some models accept special options that are passed to their SDK:

```json
{
  "openai": {
    "models": {
      "o1": {
        "name": "o1",
        "options": {
          "reasoningEffort": "high"  // Passed to OpenAI SDK
        }
      }
    }
  }
}
```

These options are merged into the API request automatically.

## Troubleshooting

- “No API key configured …”: add a key for the active provider in Settings.
- “Invalid API key”: re-copy the key and ensure it matches the provider.
- Local provider not responding: verify the server is running and the `baseUrl` ends with `/v1`.
- Model not found: the model name must exist on the provider/server.
