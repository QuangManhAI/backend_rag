import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import * as dotenv from 'dotenv';

dotenv.config();

const MODEL_URL =
  'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf';

// Priority: process.env.MODEL_PATH -> process.env.LLM_MODEL_PATH -> '../model/qwen2.5-7b-instruct-q4_k_m.gguf'
const targetConfigPath =
  process.env.MODEL_PATH ||
  process.env.LLM_MODEL_PATH ||
  path.join('..', 'model', 'qwen2.5-7b-instruct-q4_k_m.gguf');

const TARGET_FILE = path.resolve(process.cwd(), targetConfigPath);
const TARGET_DIR = path.dirname(TARGET_FILE);

async function downloadModel() {
  if (fs.existsSync(TARGET_FILE)) {
    const stats = fs.statSync(TARGET_FILE);
    const sizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(2);
    // Qwen2.5-7B Q4_K_M is ~4.68 GB (approx 4.3 GB to 5.0 GB)
    if (stats.size > 4 * 1024 * 1024 * 1024) {
      console.log(`[INFO] Model already exists at: ${TARGET_FILE} (${sizeGB} GB)`);
      return;
    }
    console.log(`[WARN] Existing file at ${TARGET_FILE} is only ${sizeGB} GB (incomplete). Re-downloading...`);
  }

  console.log(`[INFO] Target directory: ${TARGET_DIR}`);
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  console.log(`[INFO] Target file path: ${TARGET_FILE}`);
  console.log(`[INFO] Downloading Qwen2.5-7B GGUF model (~4.68 GB) from Hugging Face...`);
  console.log(`[INFO] URL: ${MODEL_URL}`);

  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download model: ${res.status} ${res.statusText}`);
  }

  const totalLength = Number(res.headers.get('content-length') || 0);
  let downloaded = 0;
  let lastLogged = 0;

  const reader = res.body.getReader();
  const fileStream = fs.createWriteStream(TARGET_FILE);

  const readable = new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done) {
        this.push(null);
      } else {
        downloaded += value.length;
        if (totalLength > 0 && downloaded - lastLogged > 50 * 1024 * 1024) {
          lastLogged = downloaded;
          const pct = ((downloaded / totalLength) * 100).toFixed(1);
          const dlMB = (downloaded / 1024 / 1024).toFixed(1);
          const totalMB = (totalLength / 1024 / 1024).toFixed(1);
          console.log(`Progress: ${pct}% (${dlMB} / ${totalMB} MB)`);
        }
        this.push(Buffer.from(value));
      }
    },
  });

  await pipeline(readable, fileStream);
  console.log(`[SUCCESS] Download completed successfully: ${TARGET_FILE}`);
}

downloadModel().catch((err) => {
  console.error('[ERROR] Error downloading model:', err);
  process.exitCode = 1;
});
