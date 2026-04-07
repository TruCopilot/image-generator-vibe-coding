#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

// --- Provider & Model Configuration ---

type Provider = "openrouter" | "gemini";

const OPENROUTER_MODELS: Record<string, string> = {
  flash: "google/gemini-2.5-flash-image",
  pro: "google/gemini-3-pro-image-preview",
};

const GEMINI_MODELS: Record<string, string> = {
  flash: "gemini-2.5-flash-image",
  pro: "gemini-3-pro-image-preview",
};

const IMAGE_SIZES: Record<string, { width: number; height: number }> = {
  "0.5K": { width: 512, height: 512 },
  "1K": { width: 1024, height: 1024 },
  "2K": { width: 2048, height: 2048 },
  "4K": { width: 4096, height: 4096 },
};

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// --- API Key Detection ---

const openrouterApiKey = process.env.OPENROUTER_API_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;

if (!openrouterApiKey && !geminiApiKey) {
  console.error(
    "Error: At least one API key is required.\n" +
      "Set OPENROUTER_API_KEY (preferred) or GEMINI_API_KEY.\n" +
      "OpenRouter: https://openrouter.ai/keys\n" +
      "Gemini: https://aistudio.google.com/apikey"
  );
  process.exit(1);
}

const defaultProvider: Provider = openrouterApiKey ? "openrouter" : "gemini";

// Gemini client (only initialized if key exists)
const geminiAi = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

// --- MCP Server ---

const server = new McpServer({
  name: "image-generator-vibe-coding",
  version: "1.1.0",
});

// --- Utility Functions ---

function ensureDir(dir: string): string {
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

function saveImage(
  base64Data: string,
  outputDir: string,
  index: number
): string {
  const dir = ensureDir(outputDir);
  const timestamp = Date.now();
  const filename = `image-${timestamp}-${index}.png`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, Buffer.from(base64Data, "base64"));
  return filepath;
}

function resolveProvider(requested?: string): Provider {
  if (requested === "gemini") {
    if (!geminiApiKey) throw new Error("GEMINI_API_KEY is not set");
    return "gemini";
  }
  if (requested === "openrouter") {
    if (!openrouterApiKey) throw new Error("OPENROUTER_API_KEY is not set");
    return "openrouter";
  }
  return defaultProvider;
}

// Extract base64 data from a data URL (e.g., "data:image/png;base64,iVBOR...")
function extractBase64FromDataUrl(dataUrl: string): {
  base64: string;
  mimeType: string;
} {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], base64: match[2] };
  }
  // If it's already raw base64
  return { mimeType: "image/png", base64: dataUrl };
}

// --- OpenRouter API Functions ---

interface OpenRouterImageResult {
  images: Array<{ base64: string; mimeType: string }>;
  text: string[];
}

async function openrouterGenerate(
  prompt: string,
  model: string,
  aspectRatio: string,
  imageSize: string
): Promise<OpenRouterImageResult> {
  const modelId = OPENROUTER_MODELS[model] || model;

  const body: Record<string, unknown> = {
    model: modelId,
    messages: [{ role: "user", content: prompt }],
    modalities: ["image", "text"],
    image_config: {
      aspect_ratio: aspectRatio,
      image_size: imageSize,
    },
  };

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  const result = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
        images?: Array<{ image_url: { url: string } }>;
      };
    }>;
    error?: { message: string };
  };

  if (result.error) {
    throw new Error(`OpenRouter error: ${result.error.message}`);
  }

  const images: Array<{ base64: string; mimeType: string }> = [];
  const text: string[] = [];

  const message = result.choices?.[0]?.message;
  if (message) {
    if (message.content) {
      text.push(message.content);
    }
    if (message.images) {
      for (const img of message.images) {
        const { base64, mimeType } = extractBase64FromDataUrl(
          img.image_url.url
        );
        images.push({ base64, mimeType });
      }
    }
  }

  return { images, text };
}

async function openrouterEdit(
  prompt: string,
  imageBase64: string,
  imageMimeType: string,
  model: string,
  aspectRatio?: string
): Promise<OpenRouterImageResult> {
  const modelId = OPENROUTER_MODELS[model] || model;
  const dataUrl = `data:${imageMimeType};base64,${imageBase64}`;

  const body: Record<string, unknown> = {
    model: modelId,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    modalities: ["image", "text"],
    ...(aspectRatio && {
      image_config: { aspect_ratio: aspectRatio },
    }),
  };

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  const result = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
        images?: Array<{ image_url: { url: string } }>;
      };
    }>;
    error?: { message: string };
  };

  if (result.error) {
    throw new Error(`OpenRouter error: ${result.error.message}`);
  }

  const images: Array<{ base64: string; mimeType: string }> = [];
  const text: string[] = [];

  const message = result.choices?.[0]?.message;
  if (message) {
    if (message.content) {
      text.push(message.content);
    }
    if (message.images) {
      for (const img of message.images) {
        const { base64, mimeType } = extractBase64FromDataUrl(
          img.image_url.url
        );
        images.push({ base64, mimeType });
      }
    }
  }

  return { images, text };
}

// --- Gemini API Functions ---

async function geminiGenerate(
  prompt: string,
  model: string,
  aspectRatio: string
): Promise<OpenRouterImageResult> {
  if (!geminiAi) throw new Error("GEMINI_API_KEY is not set");

  const modelId = GEMINI_MODELS[model];
  const response = await geminiAi.models.generateContent({
    model: modelId,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
      ...(aspectRatio !== "1:1" && {
        generationConfig: { aspectRatio },
      }),
    },
  });

  const images: Array<{ base64: string; mimeType: string }> = [];
  const text: string[] = [];

  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.text) text.push(part.text);
      if (part.inlineData?.data) {
        images.push({
          base64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png",
        });
      }
    }
  }

  return { images, text };
}

async function geminiEdit(
  prompt: string,
  imageBase64: string,
  imageMimeType: string,
  model: string,
  aspectRatio?: string
): Promise<OpenRouterImageResult> {
  if (!geminiAi) throw new Error("GEMINI_API_KEY is not set");

  const modelId = GEMINI_MODELS[model];
  const response = await geminiAi.models.generateContent({
    model: modelId,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: imageBase64, mimeType: imageMimeType } },
          { text: prompt },
        ],
      },
    ],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
      ...(aspectRatio && {
        generationConfig: { aspectRatio },
      }),
    },
  });

  const images: Array<{ base64: string; mimeType: string }> = [];
  const text: string[] = [];

  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.text) text.push(part.text);
      if (part.inlineData?.data) {
        images.push({
          base64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png",
        });
      }
    }
  }

  return { images, text };
}

// --- MCP Tools ---

const ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "3:4",
  "4:3",
  "2:3",
  "3:2",
  "4:5",
  "5:4",
  "21:9",
] as const;

const IMAGE_SIZE_OPTIONS = ["0.5K", "1K", "2K", "4K"] as const;

server.tool(
  "generate_image",
  "Generate an image from a text prompt using Google Gemini via OpenRouter (default) or direct Gemini API",
  {
    prompt: z.string().describe("Text description of the image to generate"),
    model: z
      .enum(["flash", "pro"])
      .default("flash")
      .describe(
        'Model to use: "flash" (fast, high-volume) or "pro" (high quality)'
      ),
    aspectRatio: z
      .enum(ASPECT_RATIOS)
      .default("1:1")
      .describe("Aspect ratio of the generated image"),
    imageSize: z
      .enum(IMAGE_SIZE_OPTIONS)
      .default("2K")
      .describe("Resolution of the generated image"),
    outputDir: z
      .string()
      .default("./generated-images")
      .describe("Directory to save generated images"),
    provider: z
      .enum(["openrouter", "gemini"])
      .optional()
      .describe(
        'Provider: "openrouter" (default, preferred) or "gemini" (direct API). Auto-detected from env vars if omitted.'
      ),
  },
  async ({ prompt, model, aspectRatio, imageSize, outputDir, provider }) => {
    try {
      const activeProvider = resolveProvider(provider);
      const modelId =
        activeProvider === "openrouter"
          ? OPENROUTER_MODELS[model]
          : GEMINI_MODELS[model];
      const size = IMAGE_SIZES[imageSize];

      let result: OpenRouterImageResult;

      if (activeProvider === "openrouter") {
        result = await openrouterGenerate(prompt, model, aspectRatio, imageSize);
      } else {
        result = await geminiGenerate(prompt, model, aspectRatio);
      }

      if (result.images.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No image was generated. The model may not have produced an image for this prompt. Try rephrasing your prompt.",
            },
          ],
        };
      }

      const savedPaths: string[] = [];
      for (let i = 0; i < result.images.length; i++) {
        const filepath = saveImage(result.images[i].base64, outputDir, i);
        savedPaths.push(filepath);
      }

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [];

      const summary = [
        `Generated ${result.images.length} image(s) using ${activeProvider} → ${modelId}`,
        `Aspect ratio: ${aspectRatio} | Size: ${imageSize}${size ? ` (${size.width}x${size.height})` : ""}`,
        ...savedPaths.map((p) => `Saved: ${p}`),
        ...(result.text.length > 0
          ? [`\nModel response: ${result.text.join("\n")}`]
          : []),
      ].join("\n");

      content.push({ type: "text" as const, text: summary });

      for (const img of result.images) {
        content.push({
          type: "image" as const,
          data: img.base64,
          mimeType: img.mimeType,
        });
      }

      return { content };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          {
            type: "text" as const,
            text: `Error generating image: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "edit_image",
  "Edit an existing image with text instructions using Google Gemini via OpenRouter (default) or direct Gemini API",
  {
    prompt: z
      .string()
      .describe("Text instructions for how to edit the image"),
    imagePath: z.string().describe("Path to the source image to edit"),
    model: z
      .enum(["flash", "pro"])
      .default("flash")
      .describe('Model to use: "flash" (fast) or "pro" (high quality)'),
    aspectRatio: z
      .enum(ASPECT_RATIOS)
      .optional()
      .describe("Aspect ratio for the output image"),
    outputDir: z
      .string()
      .default("./generated-images")
      .describe("Directory to save edited images"),
    provider: z
      .enum(["openrouter", "gemini"])
      .optional()
      .describe(
        'Provider: "openrouter" (default, preferred) or "gemini" (direct API). Auto-detected from env vars if omitted.'
      ),
  },
  async ({ prompt, imagePath, model, aspectRatio, outputDir, provider }) => {
    try {
      const activeProvider = resolveProvider(provider);
      const modelId =
        activeProvider === "openrouter"
          ? OPENROUTER_MODELS[model]
          : GEMINI_MODELS[model];

      const resolvedPath = path.resolve(imagePath);
      if (!fs.existsSync(resolvedPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Image file not found at ${resolvedPath}`,
            },
          ],
          isError: true,
        };
      }

      const imageBuffer = fs.readFileSync(resolvedPath);
      const imageBase64 = imageBuffer.toString("base64");
      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeTypeMap: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
      };
      const imageMimeType = mimeTypeMap[ext] || "image/png";

      let result: OpenRouterImageResult;

      if (activeProvider === "openrouter") {
        result = await openrouterEdit(
          prompt,
          imageBase64,
          imageMimeType,
          model,
          aspectRatio
        );
      } else {
        result = await geminiEdit(
          prompt,
          imageBase64,
          imageMimeType,
          model,
          aspectRatio
        );
      }

      if (result.images.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No edited image was generated. The model may not have been able to edit the image with the given instructions. Try different instructions.",
            },
          ],
        };
      }

      const savedPaths: string[] = [];
      for (let i = 0; i < result.images.length; i++) {
        const filepath = saveImage(result.images[i].base64, outputDir, i);
        savedPaths.push(filepath);
      }

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [];

      const summary = [
        `Edited image using ${activeProvider} → ${modelId}`,
        `Source: ${resolvedPath}`,
        ...savedPaths.map((p) => `Saved: ${p}`),
        ...(result.text.length > 0
          ? [`\nModel response: ${result.text.join("\n")}`]
          : []),
      ].join("\n");

      content.push({ type: "text" as const, text: summary });

      for (const img of result.images) {
        content.push({
          type: "image" as const,
          data: img.base64,
          mimeType: img.mimeType,
        });
      }

      return { content };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          {
            type: "text" as const,
            text: `Error editing image: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// --- Start Server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Image Generator MCP server running on stdio (default provider: ${defaultProvider})`
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
