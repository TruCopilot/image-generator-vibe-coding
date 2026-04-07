# Image Generator MCP Server

An MCP (Model Context Protocol) server for AI image generation using Google Gemini. Supports **OpenRouter** (default) and **direct Gemini API**. Works with **Claude Code**, **Cursor**, **Windsurf**, and any MCP-compatible tool.

---

## Quick Install — Paste This Prompt Into Claude Code

Copy the prompt below, replace the **two placeholders**, and paste it into Claude Code (or any vibe coding tool). It will install the MCP, update your project config, and set up image generation rules automatically.

> **Before you paste:** Get your OpenRouter API key at [openrouter.ai/keys](https://openrouter.ai/keys)

<pre>
Fetch this doc: https://github.com/khoaofgod/image-generator-vibe-coding and install the
image-generator MCP server for me. Use user scope if possible, otherwise project scope.

Install command:
claude mcp add --scope user image-generator \
  -e OPENROUTER_API_KEY=<b>[YourOpenRouterAPIKey]</b> \
  -- npx -y @hallutraceai/image-generator-vibe-coding

Then update my CLAUDE.md (or AGENTS.md) and your memory with these image generation rules:

# Image Generation (MANDATORY for all visual content)

- MCP Server: `image-generator` (via @hallutraceai/image-generator-vibe-coding)
- Model: `<b>[YourModelName]</b>`
  - OpenRouter: `google/gemini-2.5-flash-image` (fast) or `google/gemini-3-pro-image-preview` (quality)
  - Gemini direct: `gemini-2.5-flash-image` (fast) or `gemini-3-pro-image-preview` (quality)
- Provider: OpenRouter (default)

## Rules
- ALWAYS use the `image-generator` MCP to generate images when working on new designs,
  building UI, or making the site more beautiful — hero sections, banners, cards,
  backgrounds, avatars, and any visual content
- CRITICAL: Always call via sub-agent (Agent tool) — base64 image data will crash
  the main context window if returned directly
- Resolution: Always `2K` — never go below unless I explicitly ask
- Style: Ultra-realistic, high detail, professional photography quality — include
  lighting, composition, and mood descriptors in every prompt
- Aspect ratios — choose based on design context:
  - `1:1`  → Avatars, profile pics, square cards, thumbnails
  - `16:9` → Hero banners, page headers, blog covers, landscape backgrounds
  - `9:16` → Mobile splash screens, story formats, vertical banners
  - `3:4` / `4:3` → Product cards, feature sections
  - `2:3` / `3:2` → Portrait/landscape editorial layouts
- Output directory: `./public/images/generated/` (or project-appropriate path)
- After generating, use the saved file path in &lt;img&gt; or CSS background-image
  — never embed base64 in markup

## Sub-Agent Pattern (Required)
Always generate images through a sub-agent like this:
  Agent tool → "Use the image-generator MCP generate_image tool with:
    prompt: '&lt;detailed visual description&gt;',
    model: '[YourModelName]',
    aspectRatio: '&lt;pick based on context&gt;',
    imageSize: '2K',
    outputDir: './public/images/generated/'
  Report back ONLY the saved file path, do NOT return image data."

Save this to your persistent memory so every future session uses these rules automatically.
</pre>

**Replace before pasting:**
| Placeholder | Replace with | Example |
|---|---|---|
| `[YourOpenRouterAPIKey]` | Your OpenRouter API key | `sk-or-v1-abc123...` |
| `[YourModelName]` | Full model ID from your provider | OpenRouter: `google/gemini-2.5-flash-image`, Gemini: `gemini-2.5-flash-image` |

---

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

> **Browse all image models:** [OpenRouter Image Models](https://openrouter.ai/models?fmt=cards&input_modalities=text&output_modalities=image) — any model ID from this page works with the `model` parameter.

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
| `model` | string | `"google/gemini-2.5-flash-image"` | Full model ID. OpenRouter: `google/gemini-2.5-flash-image`, `google/gemini-3-pro-image-preview`. Gemini: `gemini-2.5-flash-image`, `gemini-3-pro-image-preview`. Shortcuts: `flash`, `pro` |
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
| `model` | string | `"google/gemini-2.5-flash-image"` | Full model ID (same options as generate_image) |
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
