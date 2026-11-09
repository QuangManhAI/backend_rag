/**
 * serve-qwen-judge.mjs
 * -------------------
 * Lightweight OpenAI-compatible HTTP server running on port 9001
 * Serving local Qwen2.5-7B-Instruct GGUF for DeepEval Judge.
 */
import http from 'http';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const PORT = 9001;
const MODEL_PATH = resolve('../models/qwen2.5-7b-instruct-q4_k_m/qwen2.5-7b-instruct-q4_k_m.gguf');

async function main() {
  console.log(`[QWEN-JUDGE] Initializing node-llama-cpp on CUDA...`);
  const { getLlama, LlamaChatSession } = await import('node-llama-cpp');

  const llama = await getLlama({ gpu: 'auto' });
  console.log(`[QWEN-JUDGE] GPU Backend: ${llama.gpu}`);

  console.log(`[QWEN-JUDGE] Loading model: ${MODEL_PATH}`);
  const model = await llama.loadModel({ modelPath: MODEL_PATH });

  const context = await model.createContext({
    contextSize: 8192,
    sequences: 1,
  });
  console.log(`[QWEN-JUDGE] Context initialized (8192 tokens).`);

  // Serial execution queue to prevent "No sequences left" on concurrent requests
  let jobQueue = Promise.resolve();

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === 'GET' && (req.url === '/v1/models' || req.url === '/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [{ id: 'qwen2.5-7b-instruct', object: 'model', owned_by: 'local' }]
      }));
      return;
    }

    if (req.method === 'POST' && (req.url === '/v1/chat/completions' || req.url === '/chat/completions')) {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const messages = payload.messages || [];
          const temperature = payload.temperature ?? 0.01;
          const maxTokens = payload.max_tokens ?? 1024;

          // Extract system and user prompts
          let systemPrompt = '';
          const userMessages = [];
          for (const m of messages) {
            if (m.role === 'system') {
              systemPrompt += (systemPrompt ? '\n' : '') + m.content;
            } else if (m.role === 'user') {
              userMessages.push(m.content);
            }
          }
          const promptText = userMessages.join('\n\n');

          // Process sequentially through jobQueue
          const resultPromise = jobQueue.then(async () => {
            const sequence = context.getSequence();
            let generatedText = '';
            try {
              const session = new LlamaChatSession({
                contextSequence: sequence,
                systemPrompt: systemPrompt || undefined,
              });

              await session.prompt(promptText, {
                temperature,
                maxTokens,
                onTextChunk: (chunk) => { generatedText += chunk; }
              });
              session.dispose({ disposeSequence: false });
            } finally {
              await sequence.dispose();
            }
            return generatedText;
          });

          // Keep chain alive even on error
          jobQueue = resultPromise.catch(() => undefined);

          const generatedText = await resultPromise;

          const response = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: payload.model || 'qwen2.5-7b-instruct',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: generatedText.trim()
              },
              finish_reason: 'stop'
            }],
            usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0
            }
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (err) {
          console.error('[QWEN-JUDGE] Error processing request:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: err.message || String(err) } }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[QWEN-JUDGE] OpenAI-compatible server listening on http://127.0.0.1:${PORT}/v1`);
  });
}

main().catch(err => {
  console.error('[QWEN-JUDGE] Fatal error:', err);
  process.exit(1);
});
