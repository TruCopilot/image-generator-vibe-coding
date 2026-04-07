# Image Generator MCP Server

An MCP (Model Context Protocol) server for AI image generation using Google Gemini. Supports **OpenRouter** (default) and **direct Gemini API**. Works with **Claude Code**, **Cursor**, **Windsurf**, and any MCP-compatible tool.

## Providers

| Provider | Default | API Key Env Var | Notes |
|---|---|---|---|
| **OpenRouter** | Yes | `OPENROUTER_API_KEY` | Access to 300+ models, OpenAI-compatible API |
| **Gemini** | Fallback | `GEMINI_API_KEY` | Direct Google Gemini API |

Provider is auto-detected from available env vars (OpenRouter preferred). You can override per-request with the `provider` parameter.

## Models

| Name | Model (OpenRouter) | Model (Gemini) | Best For |
|---|---|---|---|
| Nano Banana (flash) | `google/gemini-2.5-flash-image` | `gemini-2.5-flash-image` | Fast, high-volume generation |
| Nano Banana Pro | `google/gemini-3-pro-image-preview` | `gemini-3-pro-image-preview` | High quality output |

## Setup

### 1. Get an API Key

- **OpenRouter (recommended):** Get your key at [OpenRouter Keys](https://openrouter.ai/keys)
- **Gemini:** Get your key at [Google AI Studio](https://aistudio.google.com/apikey)

### 2. Add to your MCP client

#### Claude Code

```bash
claude mcp add image-generator -- npx -y @hallutraceai/image-generator-vibe-coding
```

Then set your API key:

```bash
export OPENROUTER_API_KEY=your-key-here
# or
export GEMINI_API_KEY=your-key-here
```

#### Manual config (Claude Code, Cursor, Windsurf, etc.)

Add to your MCP settings:

```json
{
  "mcpServers": {
    "image-generator": {
      "command": "npx",
      "args": ["-y", "@hallutraceai/image-generator-vibe-coding"],
      "env": {
        "OPENROUTER_API_KEY": "your-openrouter-key-here"
      }
    }
  }
}
```

## Tools

### `generate_image`

Generate an image from a text prompt.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `prompt` | string | (required) | Text description of the image |
| `model` | `"flash"` \| `"pro"` | `"flash"` | Which model to use |
| `aspectRatio` | `"1:1"` \| `"16:9"` \| `"9:16"` \| `"3:4"` \| `"4:3"` \| `"2:3"` \| `"3:2"` \| `"4:5"` \| `"5:4"` \| `"21:9"` | `"1:1"` | Aspect ratio |
| `imageSize` | `"0.5K"` \| `"1K"` \| `"2K"` \| `"4K"` | `"2K"` | Resolution |
| `outputDir` | string | `"./generated-images"` | Save directory |
| `provider` | `"openrouter"` \| `"gemini"` | auto-detect | API provider |

### `edit_image`

Edit an existing image with text instructions.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `prompt` | string | (required) | Edit instructions |
| `imagePath` | string | (required) | Path to source image |
| `model` | `"flash"` \| `"pro"` | `"flash"` | Which model to use |
| `aspectRatio` | `"1:1"` \| `"16:9"` \| `"9:16"` \| `"3:4"` \| `"4:3"` \| `"2:3"` \| `"3:2"` \| `"4:5"` \| `"5:4"` \| `"21:9"` | (optional) | Output aspect ratio |
| `outputDir` | string | `"./generated-images"` | Save directory |
| `provider` | `"openrouter"` \| `"gemini"` | auto-detect | API provider |

## Examples

Once configured, ask your AI assistant:

- "Generate an image of a sunset over mountains"
- "Create a logo for a coffee shop called Bean There"
- "Edit this image to make the sky more dramatic"
- "Generate a 16:9 banner image for my blog post about AI"

## Development

```bash
git clone https://github.com/khoaofgod/image-generator-vibe-coding.git
cd image-generator-vibe-coding
npm install
npm run build
```

Test locally:

```bash
OPENROUTER_API_KEY=your-key node dist/index.js
```

## License

MIT
