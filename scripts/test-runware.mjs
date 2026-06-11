/**
 * Runware integration test suite.
 * Run: RUNWARE_API_KEY=... node scripts/test-runware.mjs
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const API_KEY = process.env.RUNWARE_API_KEY;
const API_URL = "https://api.runware.ai/v1";
const DEFAULT_MODEL = "runware:400@6";
const OUT_DIR = "./generated-images/test-runware";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function roundTo64(n) {
  return Math.max(64, Math.round(n / 64) * 64);
}

function runwareDimensions(aspectRatio, imageSize) {
  const [wRatio, hRatio] = aspectRatio.split(":").map(Number);
  let maxDim;
  switch (imageSize) {
    case "0.5K": maxDim = 512; break;
    case "1K": maxDim = 1024; break;
    case "2K": maxDim = 2048; break;
    case "4K": maxDim = 4096; break;
    default: maxDim = 1024;
  }
  if (imageSize !== "4K") maxDim = Math.min(maxDim, 2048);
  if (wRatio >= hRatio) {
    return { width: maxDim, height: roundTo64((maxDim * hRatio) / wRatio) };
  }
  return { width: roundTo64((maxDim * wRatio) / hRatio), height: maxDim };
}

function isDiv64(n) {
  return n % 64 === 0;
}

async function runwareRequest(tasks) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tasks),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
  }
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join("; "));
  }
  const data = Array.isArray(result.data) ? result.data : [result.data];
  return data;
}

async function generate({ prompt, model, width, height, negativePrompt, steps = 20 }) {
  const task = {
    taskType: "imageInference",
    taskUUID: randomUUID(),
    model,
    positivePrompt: prompt,
    width,
    height,
    steps,
    outputType: "base64Data",
    numberResults: 1,
    includeCost: true,
  };
  if (negativePrompt) task.negativePrompt = negativePrompt;
  return runwareRequest([task]);
}

async function uploadImage(base64, mimeType = "image/png") {
  const taskUUID = randomUUID();
  const results = await runwareRequest([
    {
      taskType: "imageUpload",
      taskUUID,
      image: `data:${mimeType};base64,${base64}`,
    },
  ]);
  return results[0]?.imageUUID;
}

function saveBase64(base64, filename) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filepath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(base64, "base64"));
  return filepath;
}

// --- Tests ---

console.log("\n=== Dimension calculations ===\n");

const dimCases = [
  ["1:1", "1K", 1024, 1024],
  ["16:9", "2K", 2048, 1152],
  ["9:16", "1K", 576, 1024],
  ["21:9", "2K", 2048, 896],
];

for (const [ar, size, expW, expH] of dimCases) {
  const d = runwareDimensions(ar, size);
  assert(d.width === expW && d.height === expH, `${ar} ${size} → ${d.width}×${d.height}`);
  assert(isDiv64(d.width) && isDiv64(d.height), `${ar} ${size} divisible by 64`);
}

const capped = runwareDimensions("1:1", "2K");
assert(capped.width === 2048 && capped.height === 2048, "2K capped at 2048 (not 4096)");

if (!API_KEY) {
  console.error("\nRUNWARE_API_KEY not set — skipping API tests.\n");
  process.exit(failed > 0 ? 1 : 0);
}

console.log("\n=== Text-to-image (default 1:1 @ 1K) ===\n");

try {
  const dims = runwareDimensions("1:1", "1K");
  const results = await generate({
    prompt: "A single red apple on a white table, studio product photo",
    model: DEFAULT_MODEL,
    width: dims.width,
    height: dims.height,
  });
  const item = results[0];
  assert(Boolean(item?.imageBase64Data), "returns base64 image data");
  assert(item?.cost > 0, `cost reported ($${item?.cost})`);
  const saved = saveBase64(item.imageBase64Data, "test-1k-square.png");
  assert(fs.statSync(saved).size > 1000, `saved file has content (${saved})`);
} catch (e) {
  assert(false, `1K generate failed: ${e.message}`);
}

console.log("\n=== Text-to-image (16:9 @ 2K) ===\n");

try {
  const dims = runwareDimensions("16:9", "2K");
  assert(dims.width === 2048 && dims.height === 1152, `16:9 2K dims ${dims.width}×${dims.height}`);
  const results = await generate({
    prompt: "Wide cinematic landscape of mountains at golden hour, 16:9 banner",
    model: DEFAULT_MODEL,
    width: dims.width,
    height: dims.height,
  });
  assert(Boolean(results[0]?.imageBase64Data), "16:9 2K generation succeeded");
  saveBase64(results[0].imageBase64Data, "test-16x9-2k.png");
} catch (e) {
  assert(false, `16:9 2K generate failed: ${e.message}`);
}

console.log("\n=== Negative prompt ===\n");

try {
  const dims = runwareDimensions("1:1", "1K");
  const results = await generate({
    prompt: "A professional headshot of a woman in a modern office",
    model: DEFAULT_MODEL,
    width: dims.width,
    height: dims.height,
    negativePrompt: "blurry, distorted, extra fingers, watermark, text",
  });
  assert(Boolean(results[0]?.imageBase64Data), "negative prompt request succeeded");
} catch (e) {
  assert(false, `negative prompt failed: ${e.message}`);
}

console.log("\n=== Image-to-image (edit) ===\n");

const IMG2IMG_MODEL = "runware:101@1";

try {
  const sourcePath = path.join(OUT_DIR, "test-1k-square.png");
  if (!fs.existsSync(sourcePath)) throw new Error("source image missing");
  const sourceB64 = fs.readFileSync(sourcePath).toString("base64");
  const imageUUID = await uploadImage(sourceB64);
  assert(Boolean(imageUUID), `image uploaded (UUID: ${imageUUID?.slice(0, 8)}...)`);

  // runware:400@6 does not support seedImage — MCP falls back to runware:101@1
  try {
    await runwareRequest([
      {
        taskType: "imageInference",
        taskUUID: randomUUID(),
        model: DEFAULT_MODEL,
        positivePrompt: "test",
        seedImage: imageUUID,
        strength: 0.85,
        width: 1024,
        height: 1024,
        steps: 5,
        outputType: "base64Data",
      },
    ]);
    assert(false, "runware:400@6 should reject seedImage");
  } catch {
    assert(true, "runware:400@6 correctly rejects seedImage (MCP uses runware:101@1 fallback)");
  }

  const dims = runwareDimensions("1:1", "1K");
  const results = await runwareRequest([
    {
      taskType: "imageInference",
      taskUUID: randomUUID(),
      model: IMG2IMG_MODEL,
      positivePrompt: "The same apple but painted in watercolor style, soft pastel colors",
      seedImage: imageUUID,
      strength: 0.85,
      width: dims.width,
      height: dims.height,
      steps: 20,
      outputType: "base64Data",
      numberResults: 1,
      includeCost: true,
    },
  ]);
  assert(Boolean(results[0]?.imageBase64Data), "image-to-image edit succeeded with runware:101@1");
  saveBase64(results[0].imageBase64Data, "test-edit-watercolor.png");
} catch (e) {
  assert(false, `img2img failed: ${e.message}`);
}

console.log("\n=== Server startup (RUNWARE only) ===\n");

try {
  const { spawn } = await import("node:child_process");
  const proc = spawn("node", ["dist/index.js"], {
    env: { ...process.env, RUNWARE_API_KEY: API_KEY, OPENROUTER_API_KEY: "", GEMINI_API_KEY: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const startup = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 5000);
    proc.stderr.on("data", (d) => {
      const msg = d.toString();
      if (msg.includes("default provider: runware")) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`exit ${code}`));
    });
  });
  proc.kill();
  assert(startup.includes("runware"), "server starts with Runware as default provider");
} catch (e) {
  assert(false, `server startup failed: ${e.message}`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
