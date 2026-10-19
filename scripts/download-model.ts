import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const MODEL_URL =
  'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf?download=true';

const TARGET_DIR = path.resolve(
  process.cwd(),
  '../models/qwen2.5-7b-instruct-q4_k_m',
);
const TARGET_FILE = path.join(
  TARGET_DIR,
  'qwen2.5-7b-instruct-q4_k_m.gguf',
);

async function downloadModel() {
  if (fs.existsSync(TARGET_FILE)) {
    const stats = fs.statSync(TARGET_FILE);
    console.log(
      `Model already exists at: ${TARGET_FILE} (${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GB)`,
    );
    return;
  }

  console.log(`Target directory: ${TARGET_DIR}`);
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  console.log(`Downloading Qwen2.5-7B GGUF model from Hugging Face...`);
  console.log(`URL: ${MODEL_URL}`);

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
          console.log(
            `Progress: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} / ${(totalLength / 1024 / 1024).toFixed(1)} MB)`,
          );
        }
        this.push(Buffer.from(value));
      }
    },
  });

  await pipeline(readable, fileStream);
  console.log(`Download completed successfully: ${TARGET_FILE}`);
}

downloadModel().catch((err) => {
  console.error('Error downloading model:', err);
  process.exit(1);
});
