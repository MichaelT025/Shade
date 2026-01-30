# Configuration

Shade is BYOK (Bring Your Own Key): you connect your own model provider(s) by adding API keys and selecting models. Shade stores everything locally (no cloud sync).

This doc covers:
- First-time setup (recommended, in-app)
- Advanced/dev configuration (editing JSON in the user data folder)

## First-time setup (recommended)

### 1) Launch Shade

Run the app and open the Dashboard:
- From the overlay, click the Settings/Dashboard button
- Or use whatever entry point your build exposes (the Dashboard is the main “settings” surface)

### 2) Configure a provider

1. In the Dashboard, open **Configuration**
2. Choose a provider (e.g., Gemini, OpenAI, Anthropic, OpenRouter, Grok, Ollama, LM Studio)
3. Paste your API key (if required)
4. Click **Test/Validate** (if available)
5. Pick a model
6. Optionally click **Refresh Models** to pull the latest models

### 3) Choose screenshot + memory behavior

In **Configuration** you can also control:
- **Screenshot mode**: manual vs auto-capture per message
- **Save screenshots in history**: when enabled, screenshots are persisted with the session for later review (off by default for privacy)
- **Memory**:
  - **History Limit** (how many recent messages are sent as context)
  - **Summarization** (optional)

Note: Screenshots are never re-sent to the LLM as prior context—they only apply to the message they're attached to.

### 4) Start chatting

- Attach a screenshot (“Use Screen”) when needed
- Send a message
- Use the model switcher (`Ctrl+M`; macOS uses `Cmd+Shift+M` to avoid overriding system minimize). You can also switch the active provider directly from the switcher.

## Where config lives

Shade writes configuration and local data into Electron’s `userData` directory, under a `data/` folder.

- Main config: `data/config.json`
- Provider catalog (editable provider + model metadata): `data/providers.json`
- Sessions: `data/sessions/*.json`
- Screenshots: `data/screenshots/<sessionId>/*.jpg`

Typical OS locations for Electron `userData`:
- Windows: `%APPDATA%/Shade/`
- macOS: `~/Library/Application Support/Shade/`
- Linux: `~/.config/Shade/`

If you can’t find it:
- Open the Dashboard → **Configuration** → click **Open Data Folder** (if present)
- Or search your machine for `config.json` inside a `Shade/data/` directory

### Migration note

Older installs may have used `shade-config.json` and `shade-providers.json` directly under `userData`. On startup, Shade will attempt to migrate them into `data/config.json` and `data/providers.json`.

## Provider setup quick steps

### Google Gemini

1. Create an API key: `https://makersuite.google.com/app/apikey`
2. In Configuration, choose **Google Gemini**
3. Paste the key and pick a model (e.g. `gemini-1.5-flash`)

### OpenAI

1. Create an API key: `https://platform.openai.com/api-keys`
2. In Configuration, choose **OpenAI**
3. Paste the key and pick a model (e.g. `gpt-4o`)

### Anthropic Claude

1. Create an API key: `https://console.anthropic.com/`
2. In Configuration, choose **Anthropic Claude**
3. Paste the key and pick a model

### OpenAI-compatible (local or hosted)

Use this when your server exposes an OpenAI-compatible API.

Common local defaults:
- Ollama: `http://localhost:11434/v1`
- LM Studio: `http://localhost:1234/v1`

Steps:
1. Ensure your local server is running and exposes an OpenAI-compatible `/v1` API
2. In Configuration, choose the provider (e.g., Ollama / LM Studio)
3. Confirm the **Base URL**
4. Choose a model name your server exposes
5. Leave API key blank if it’s not required

## Advanced / Dev: Configure via JSON

You can edit the JSON files under `userData/data/` to configure Shade without using the UI.

Important:
- Shade may overwrite parts of these files when you change settings in-app.
- Shut down Shade before editing to avoid losing changes.

### `data/config.json` (user settings)

This file stores:
- Which provider/model is active
- Provider-specific settings (including `baseUrl` for OpenAI-compatible providers)
- Screenshot + memory settings
- Modes (system prompts)

High-level shape:

```json
{
  "activeProvider": "openai",
  "providers": {
    "openai": {
      "apiKey": "...",
      "model": "gpt-4o"
    },
    "ollama": {
      "apiKey": "",
      "baseUrl": "http://localhost:11434/v1",
      "model": "llama3.2-vision"
    }
  },
  "screenshotMode": "manual",
  "memoryLimit": 30,
  "memorySettings": {
    "historyLimit": 10,
    "enableSummarization": true
  },
  "screenshotSettings": {
    "saveScreenshotsInHistory": false
  },
  "sessionSettings": {
    "autoTitleSessions": true,
    "startCollapsed": true
  },
  "modes": [
    {
      "id": "bolt",
      "name": "Bolt",
      "prompt": "...",
      "isDefault": true
    }
  ],
  "activeMode": "bolt"
}
```

Notes:
- `providers` keys must match provider IDs from `data/providers.json` (examples in this repo: `gemini`, `openai`, `anthropic`, `grok`, `openrouter`, `ollama`, `lm-studio`).
- `apiKey` is stored encrypted via Electron `safeStorage` when available. It may look like base64; do not “clean it up” unless you know what you’re doing.
- For local providers, `apiKey` can be empty.

### `data/providers.json` (provider + model catalog)

This file defines which providers exist and which models they expose in the UI.

Each provider entry generally follows this structure:

```json
{
  "openai": {
    "name": "OpenAI",
    "type": "openai",
    "description": "Vision-capable GPT models",
    "website": "https://platform.openai.com/api-keys",
    "defaultModel": "gpt-4o",
    "lastFetched": null,
    "models": {
      "gpt-4o": { "name": "GPT-4o" },
      "gpt-4o-mini": { "name": "GPT-4o Mini" }
    }
  },
  "ollama": {
    "name": "Ollama",
    "type": "openai-compatible",
    "requiresApiKey": false,
    "baseUrl": "http://localhost:11434/v1",
    "defaultModel": "llama3.2-vision",
    "lastFetched": null,
    "models": {
      "llama3.2-vision": { "name": "Llama 3.2 Vision" }
    }
  }
}
```

Common fields:
- `type`: one of `gemini`, `openai`, `anthropic`, `openai-compatible`
- `baseUrl`: required for `openai-compatible`
- `requiresApiKey`: if omitted, Shade assumes keys are required for most remote providers
- `models`: map of model IDs → metadata (the ID is what gets saved into `config.json`)

### Adding a new model

Add it under the provider’s `models` object, then restart Shade:

```json
{
  "openai": {
    "models": {
      "gpt-4o": { "name": "GPT-4o" },
      "gpt-4.1": { "name": "GPT-4.1" }
    }
  }
}
```

### Adding a new OpenAI-compatible provider

```json
{
  "my-provider": {
    "name": "My Provider",
    "type": "openai-compatible",
    "requiresApiKey": true,
    "baseUrl": "https://example.com/v1",
    "defaultModel": "my-model",
    "lastFetched": null,
    "models": {
      "my-model": { "name": "My Model" }
    }
  }
}
```

## Troubleshooting

- “No API key configured …”: add a key for the active provider (Dashboard → Configuration).
- “Invalid API key”: re-copy the key and ensure it matches the provider.
- Local provider not responding: verify the server is running and the `baseUrl` ends with `/v1`.
- Model not found: the model name must exist for the provider/server and match the ID in `providers.json`.
