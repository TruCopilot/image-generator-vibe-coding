#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// --- Provider & Model Configuration ---

type Provider = "openrouter" | "gemini" | "runware";

// Maps model input → { openrouter, gemini } IDs.
// Accepts shortcuts (flash/pro), full OpenRouter IDs, or full Gemini IDs.
const MODEL_MAP: Record<string, { openrouter: string; gemini: string }> = {
  // Shortcuts
  flash: { openrouter: "google/gemini-2.5-flash-image", gemini: "gemini-2.5-flash-image" },
  pro: { openrouter: "google/gemini-3-pro-image-preview", gemini: "gemini-3-pro-image-preview" },
  // Full OpenRouter names
  "google/gemini-2.5-flash-image": { openrouter: "google/gemini-2.5-flash-image", gemini: "gemini-2.5-flash-image" },
  "google/gemini-3-pro-image-preview": { openrouter: "google/gemini-3-pro-image-preview", gemini: "gemini-3-pro-image-preview" },
  // Full Gemini names
  "gemini-2.5-flash-image": { openrouter: "google/gemini-2.5-flash-image", gemini: "gemini-2.5-flash-image" },
  "gemini-3-pro-image-preview": { openrouter: "google/gemini-3-pro-image-preview", gemini: "gemini-3-pro-image-preview" },
};

const RUNWARE_DEFAULT_MODEL = "runware:400@6";
// runware:400@6 is text-to-image only; FLUX supports seedImage for img2img
const RUNWARE_IMG2IMG_MODEL = "runware:101@1";
const RUNWARE_API_URL = "https://api.runware.ai/v1";

function resolveRunwareEditModel(modelId: string): {
  model: string;
  fallbackNote?: string;
} {
  if (modelId === RUNWARE_DEFAULT_MODEL) {
    return {
      model: RUNWARE_IMG2IMG_MODEL,
      fallbackNote: `Note: ${RUNWARE_DEFAULT_MODEL} does not support image-to-image. Used ${RUNWARE_IMG2IMG_MODEL} for editing.`,
    };
  }
  return { model: modelId };
}

function resolveModel(model: string, provider: Provider): string {
  if (provider === "runware") {
    const isGeminiModel =
      model in MODEL_MAP ||
      model.startsWith("google/") ||
      model.startsWith("gemini-");
    return isGeminiModel ? RUNWARE_DEFAULT_MODEL : model;
  }
  const mapped = MODEL_MAP[model];
  if (mapped) return mapped[provider];
  // Unknown model — pass through as-is (supports any OpenRouter model ID)
  return model;
}

function roundTo64(n: number): number {
  return Math.max(64, Math.round(n / 64) * 64);
}

function runwareDimensions(
  aspectRatio: string,
  imageSize: string
): { width: number; height: number } {
  const [wRatio, hRatio] = aspectRatio.split(":").map(Number);

  let maxDim: number;
  switch (imageSize) {
    case "0.5K":
      maxDim = 512;
      break;
    case "1K":
      maxDim = 1024;
      break;
    case "2K":
      maxDim = 2048;
      break;
    case "4K":
      maxDim = 4096;
      break;
    default:
      maxDim = 1024;
  }

  // Cap at 2048 unless user explicitly requests 4K
  if (imageSize !== "4K") {
    maxDim = Math.min(maxDim, 2048);
  }

  if (wRatio >= hRatio) {
    return {
      width: maxDim,
      height: roundTo64((maxDim * hRatio) / wRatio),
    };
  }

  return {
    width: roundTo64((maxDim * wRatio) / hRatio),
    height: maxDim,
  };
}

function resolveImageSize(
  imageSize: string | undefined,
  provider: Provider
): string {
  if (imageSize) return imageSize;
  return provider === "runware" ? "1K" : "2K";
}

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
const runwareApiKey = process.env.RUNWARE_API_KEY;

if (!openrouterApiKey && !geminiApiKey && !runwareApiKey) {
  console.error(
    "Error: At least one API key is required.\n" +
      "Set OPENROUTER_API_KEY (preferred), RUNWARE_API_KEY, or GEMINI_API_KEY.\n" +
      "OpenRouter: https://openrouter.ai/keys\n" +
      "Runware: https://runware.ai\n" +
      "Gemini: https://aistudio.google.com/apikey"
  );
  process.exit(1);
}

const defaultProvider: Provider = openrouterApiKey
  ? "openrouter"
  : runwareApiKey
    ? "runware"
    : "gemini";

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
  if (requested === "runware") {
    if (!runwareApiKey) throw new Error("RUNWARE_API_KEY is not set");
    return "runware";
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
  modelId: string,
  aspectRatio: string,
  imageSize: string
): Promise<OpenRouterImageResult> {

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
  modelId: string,
  aspectRatio?: string
): Promise<OpenRouterImageResult> {
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
  modelId: string,
  aspectRatio: string
): Promise<OpenRouterImageResult> {
  if (!geminiAi) throw new Error("GEMINI_API_KEY is not set");
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
  modelId: string,
  aspectRatio?: string
): Promise<OpenRouterImageResult> {
  if (!geminiAi) throw new Error("GEMINI_API_KEY is not set");
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

// --- Runware API Functions ---

interface RunwareTaskResult {
  taskType?: string;
  taskUUID?: string;
  imageUUID?: string;
  imageURL?: string;
  imageBase64Data?: string;
  imageDataURI?: string;
  cost?: number;
}

async function runwareRequest(
  tasks: Record<string, unknown>[]
): Promise<RunwareTaskResult[]> {
  if (!runwareApiKey) throw new Error("RUNWARE_API_KEY is not set");

  const response = await fetch(RUNWARE_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runwareApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tasks),
  });

  const result = (await response.json()) as {
    data?: RunwareTaskResult | RunwareTaskResult[];
    errors?: Array<{ message?: string; code?: string }>;
  };

  if (!response.ok) {
    const errorDetail =
      result.errors?.map((e) => e.message).join("; ") ||
      JSON.stringify(result);
    throw new Error(`Runware API error (${response.status}): ${errorDetail}`);
  }

  if (result.errors?.length) {
    throw new Error(
      `Runware error: ${result.errors.map((e) => e.message).join("; ")}`
    );
  }

  if (!result.data) {
    throw new Error("Runware API returned no data");
  }

  return Array.isArray(result.data) ? result.data : [result.data];
}

async function runwareUploadImage(
  imageBase64: string,
  mimeType: string
): Promise<string> {
  const taskUUID = randomUUID();
  const dataUri = `data:${mimeType};base64,${imageBase64}`;
  const results = await runwareRequest([
    {
      taskType: "imageUpload",
      taskUUID,
      image: dataUri,
    },
  ]);

  const imageUUID = results[0]?.imageUUID;
  if (!imageUUID) {
    throw new Error("Runware image upload did not return an imageUUID");
  }
  return imageUUID;
}

async function runwareImageToResult(
  results: RunwareTaskResult[]
): Promise<OpenRouterImageResult> {
  const images: Array<{ base64: string; mimeType: string }> = [];
  const text: string[] = [];

  for (const item of results) {
    if (item.imageBase64Data) {
      images.push({ base64: item.imageBase64Data, mimeType: "image/png" });
    } else if (item.imageDataURI) {
      const { base64, mimeType } = extractBase64FromDataUrl(item.imageDataURI);
      images.push({ base64, mimeType });
    } else if (item.imageURL) {
      const imgResponse = await fetch(item.imageURL);
      if (!imgResponse.ok) {
        throw new Error(
          `Failed to download Runware image (${imgResponse.status})`
        );
      }
      const buffer = Buffer.from(await imgResponse.arrayBuffer());
      const contentType = imgResponse.headers.get("content-type") || "image/png";
      images.push({ base64: buffer.toString("base64"), mimeType: contentType });
    }

    if (item.cost !== undefined) {
      text.push(`Cost: $${item.cost.toFixed(4)}`);
    }
  }

  return { images, text };
}

async function runwareGenerate(
  prompt: string,
  modelId: string,
  aspectRatio: string,
  imageSize: string,
  options?: {
    negativePrompt?: string;
    steps?: number;
    cfgScale?: number;
  }
): Promise<OpenRouterImageResult> {
  const { width, height } = runwareDimensions(aspectRatio, imageSize);
  const taskUUID = randomUUID();

  const task: Record<string, unknown> = {
    taskType: "imageInference",
    taskUUID,
    model: modelId,
    positivePrompt: prompt,
    width,
    height,
    steps: options?.steps ?? 30,
    outputType: "base64Data",
    numberResults: 1,
    includeCost: true,
  };

  if (options?.negativePrompt) {
    task.negativePrompt = options.negativePrompt;
  }
  if (options?.cfgScale !== undefined) {
    task.CFGScale = options.cfgScale;
  }

  const results = await runwareRequest([task]);
  return runwareImageToResult(results);
}

async function runwareEdit(
  prompt: string,
  imageBase64: string,
  imageMimeType: string,
  modelId: string,
  aspectRatio: string | undefined,
  imageSize: string,
  options?: {
    negativePrompt?: string;
    steps?: number;
    cfgScale?: number;
    strength?: number;
  }
): Promise<OpenRouterImageResult> {
  const { model: editModelId, fallbackNote } = resolveRunwareEditModel(modelId);
  const seedImageUUID = await runwareUploadImage(imageBase64, imageMimeType);
  const { width, height } = runwareDimensions(
    aspectRatio || "1:1",
    imageSize
  );
  const taskUUID = randomUUID();

  const task: Record<string, unknown> = {
    taskType: "imageInference",
    taskUUID,
    model: editModelId,
    positivePrompt: prompt,
    seedImage: seedImageUUID,
    strength: options?.strength ?? 0.85,
    width,
    height,
    steps: options?.steps ?? 30,
    outputType: "base64Data",
    numberResults: 1,
    includeCost: true,
  };

  if (options?.negativePrompt) {
    task.negativePrompt = options.negativePrompt;
  }
  if (options?.cfgScale !== undefined) {
    task.CFGScale = options.cfgScale;
  }

  const results = await runwareRequest([task]);
  const output = await runwareImageToResult(results);
  if (fallbackNote) {
    output.text.unshift(fallbackNote);
  }
  return output;
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
  "Generate an image from a text prompt using OpenRouter (default), Runware, or direct Gemini API",
  {
    prompt: z.string().describe("Text description of the image to generate"),
    model: z
      .string()
      .default("google/gemini-2.5-flash-image")
      .describe(
        'Model to use. OpenRouter/Gemini: "google/gemini-2.5-flash-image" (fast) or "google/gemini-3-pro-image-preview" (quality). Shortcuts: "flash", "pro". Runware: "runware:400@6" (default) or any Runware model ID (e.g. "runware:101@1", "civitai:101055@128078").'
      ),
    aspectRatio: z
      .enum(ASPECT_RATIOS)
      .default("1:1")
      .describe("Aspect ratio of the generated image"),
    imageSize: z
      .enum(IMAGE_SIZE_OPTIONS)
      .optional()
      .describe(
        'Resolution tier. Runware defaults to "1K" (1024px, cheapest). OpenRouter/Gemini default to "2K". Runware caps at 2048px unless "4K" is explicitly set. Dimensions are rounded to multiples of 64.'
      ),
    outputDir: z
      .string()
      .default("./generated-images")
      .describe("Directory to save generated images"),
    provider: z
      .enum(["openrouter", "gemini", "runware"])
      .optional()
      .describe(
        'Provider: "openrouter" (default, preferred), "runware", or "gemini". Auto-detected from env vars if omitted.'
      ),
    negativePrompt: z
      .string()
      .optional()
      .describe(
        "Runware only: what to avoid in the image (e.g. blurry, watermark, extra fingers). Ignored by other providers."
      ),
    steps: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Runware only: denoising steps (default 30). Ignored by other providers."),
    cfgScale: z
      .number()
      .min(0)
      .max(30)
      .optional()
      .describe(
        "Runware only: CFG scale for prompt adherence. Ignored by other providers."
      ),
  },
  async ({
    prompt,
    model,
    aspectRatio,
    imageSize,
    outputDir,
    provider,
    negativePrompt,
    steps,
    cfgScale,
  }) => {
    try {
      const activeProvider = resolveProvider(provider);
      const modelId = resolveModel(model, activeProvider);
      const resolvedImageSize = resolveImageSize(imageSize, activeProvider);
      const size =
        activeProvider === "runware"
          ? runwareDimensions(aspectRatio, resolvedImageSize)
          : IMAGE_SIZES[resolvedImageSize];

      let result: OpenRouterImageResult;

      if (activeProvider === "openrouter") {
        result = await openrouterGenerate(
          prompt,
          modelId,
          aspectRatio,
          resolvedImageSize
        );
      } else if (activeProvider === "runware") {
        result = await runwareGenerate(
          prompt,
          modelId,
          aspectRatio,
          resolvedImageSize,
          { negativePrompt, steps, cfgScale }
        );
      } else {
        result = await geminiGenerate(prompt, modelId, aspectRatio);
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
        `Aspect ratio: ${aspectRatio} | Size: ${resolvedImageSize} (${size.width}x${size.height})`,
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
  "Edit an existing image with text instructions using OpenRouter (default), Runware, or direct Gemini API",
  {
    prompt: z
      .string()
      .describe("Text instructions for how to edit the image"),
    imagePath: z.string().describe("Path to the source image to edit"),
    model: z
      .string()
      .default("google/gemini-2.5-flash-image")
      .describe(
        'Model to use. OpenRouter/Gemini: "google/gemini-2.5-flash-image" or "google/gemini-3-pro-image-preview". Shortcuts: "flash", "pro". Runware: "runware:400@6" (default) or any Runware model ID.'
      ),
    aspectRatio: z
      .enum(ASPECT_RATIOS)
      .optional()
      .describe("Aspect ratio for the output image"),
    imageSize: z
      .enum(IMAGE_SIZE_OPTIONS)
      .optional()
      .describe(
        'Runware only: resolution tier (defaults to "1K"). Ignored by other providers.'
      ),
    outputDir: z
      .string()
      .default("./generated-images")
      .describe("Directory to save edited images"),
    provider: z
      .enum(["openrouter", "gemini", "runware"])
      .optional()
      .describe(
        'Provider: "openrouter" (default, preferred), "runware", or "gemini". Auto-detected from env vars if omitted.'
      ),
    negativePrompt: z
      .string()
      .optional()
      .describe("Runware only: what to avoid in the edited image."),
    steps: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Runware only: denoising steps (default 30)."),
    cfgScale: z
      .number()
      .min(0)
      .max(30)
      .optional()
      .describe("Runware only: CFG scale for prompt adherence."),
    strength: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "Runware only: image-to-image strength (default 0.85). Higher = more transformation."
      ),
  },
  async ({
    prompt,
    imagePath,
    model,
    aspectRatio,
    imageSize,
    outputDir,
    provider,
    negativePrompt,
    steps,
    cfgScale,
    strength,
  }) => {
    try {
      const activeProvider = resolveProvider(provider);
      const modelId = resolveModel(model, activeProvider);

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

      const resolvedImageSize = resolveImageSize(imageSize, activeProvider);

      let result: OpenRouterImageResult;

      if (activeProvider === "openrouter") {
        result = await openrouterEdit(
          prompt,
          imageBase64,
          imageMimeType,
          modelId,
          aspectRatio
        );
      } else if (activeProvider === "runware") {
        result = await runwareEdit(
          prompt,
          imageBase64,
          imageMimeType,
          modelId,
          aspectRatio,
          resolvedImageSize,
          { negativePrompt, steps, cfgScale, strength }
        );
      } else {
        result = await geminiEdit(
          prompt,
          imageBase64,
          imageMimeType,
          modelId,
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

      let sizeInfo = "";
      if (activeProvider === "runware") {
        const dims = runwareDimensions(aspectRatio || "1:1", resolvedImageSize);
        sizeInfo = ` | Size: ${resolvedImageSize} (${dims.width}x${dims.height})`;
      }

      const summary = [
        `Edited image using ${activeProvider} → ${modelId}`,
        `Source: ${resolvedPath}${sizeInfo}`,
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
