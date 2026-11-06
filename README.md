# RAG_TS — Backend (Monolith NestJS)

Backend hỏi đáp khoa học có trích dẫn: embed câu hỏi (Nomic v1.5) ➔ đi qua cây World 3D ➔ tìm trong Qdrant ➔ rerank theo PageRank tác giả ➔ Qwen2.5-7B trả lời, stream qua SSE cho frontend 3D.

- **Hợp đồng API:** [`../docs/api/API_DESIGN.md`](../docs/api/API_DESIGN.md) — 18 route dưới `/api/v1`.
- **Kế hoạch triển khai:** [`../docs/prompts/prompt_backend.md`](../docs/prompts/prompt_backend.md) (B1–B11, Phụ lục A đồng bộ FE, Phụ lục B yêu cầu pipeline).
- **Giả định & tiến độ:** [`ASSUMPTIONS.md`](ASSUMPTIONS.md), [`PROGRESS.md`](PROGRESS.md).
- **Swagger:** `http://localhost:3000/api/v1/docs` (JSON: `/api/v1/docs-json`).

## Kiến trúc

| Thành phần | Vai trò | Ghi chú |
| :-- | :-- | :-- |
| MongoDB | `users`, `refresh_tokens`, `login_attempts`, `chat_sessions`, `chat_messages` | Replica set (cần cho transaction) |
| Qdrant `scientific_papers_gold` | Vector + payload chunk | **Chỉ đọc** — pipeline UTH ghi |
| `MINING_DIR` | `graph_coauthorship.json`, `association_rules.json` | Pipeline xuất (MinIO `gold/mining/`) |
| `WORLD_DATA_DIR` | `tree.json`, `centroids_l1.json`, `centroids_l2.json`, `categories.json` | Pipeline xuất; thiếu ➔ event `route` có `steps: []` |
| `MODEL_PATH` | GGUF Qwen2.5-7B Q4_K_M | node-llama-cpp, tự chọn Metal/CUDA/CPU |

Module: `auth`, `rag` (+ `embedding`, `vector-store`, `mining`, `tree-router`, `llm`), `chat-sessions`, `papers`, `health`; dùng chung ở `common/` (request-id, log JSON 1 dòng/request, body lỗi §1.2, pagination).

## Chạy dev (Mac M-series, Metal)

```bash
cp .env.example .env        # sửa MONGO_URI, QDRANT_URL/QDRANT_API_KEY, JWT_*; giữ MODEL_PATH, *_DIR
npm ci
npm run start:dev           # http://localhost:3000/api/v1
```

- Cần MongoDB replica set: đặt các biến `RAGTS_MONGO_*` trong `.env` (xem `.env.example`), chạy `docker compose up -d mongo`, rồi `MONGO_URI=mongodb://<app user>:<password>@localhost:27018/rag_ts?authSource=admin&replicaSet=rs0&directConnection=true` (cổng host đổi bằng `RAGTS_MONGO_PORT`).
- Qdrant: dùng Qdrant của pipeline (`QDRANT_URL=http://localhost:6333` + `QDRANT_API_KEY`).
- Lần đầu chạy, model embedding (~550 MB) được tải từ Hugging Face (vài phút), sau đó dùng cache.
- LLM nạp nền khoảng 5 s trên Metal; trước lúc đó `/health` báo `degraded` và chat trả 503 `llm unavailable`.

## Chạy bằng Docker

```bash
# Đặt JWT_*, QDRANT_API_KEY và RAGTS_MONGO_* trong .env (xem .env.example)
export JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...   # mỗi khoá >= 32 ký tự
export QDRANT_API_KEY=...                              # key Qdrant của pipeline
docker compose up --build                              # app :3000 + mongo (rs0)
docker compose --profile standalone up                 # thêm Qdrant rỗng (không cần pipeline)
```

Biến riêng cho compose có tiền tố `RAGTS_` (`RAGTS_QDRANT_URL`, `RAGTS_PORT`, `RAGTS_MODEL_FILE`, …) để không đụng `.env` dev mà compose tự đọc. Volume: `../model` ➔ `/models`, `../data` ➔ `/data`, cache Hugging Face ở volume `hf-cache`.

> Docker trên Mac không có Metal: LLM chạy CPU, Qwen 7B cần ~6 GB RAM cho container. Máy ảo Docker 8 GB chạy kèm container khác sẽ bị kill (exit 137) — tăng RAM Docker, hoặc chạy app ngoài Docker khi dev.

## Biến môi trường

| Biến | Bắt buộc | Mặc định | Ý nghĩa |
| :-- | :--: | :-- | :-- |
| `MONGO_URI` | ✓ | — | MongoDB (replica set, có xác thực) |
| `TRUST_PROXY_HOPS` | | `0` | Số reverse proxy thật sự đứng trước app; `0` = bỏ qua `X-Forwarded-For` |
| `QDRANT_URL` | ✓ | — | Qdrant |
| `QDRANT_API_KEY` | | — | Key Qdrant |
| `QDRANT_COLLECTION` | | `scientific_papers_gold` | Collection đọc |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ✓ | — | ≥ 32 ký tự |
| `EMBEDDING_MODEL` | | `nomic-ai/nomic-embed-text-v1.5` | Id Hub hoặc thư mục local |
| `MODEL_PATH` | ✓ | — | File GGUF |
| `LLM_GPU` | | `auto` | `auto` / `cuda` / `metal` / `vulkan` / `false` |
| `LLM_CONCURRENCY` | | `1` | Số lượt sinh song song |
| `LLM_MAX_QUEUE` | | `8` | Hàng chờ tối đa, đầy ➔ 429 |
| `LLM_TIMEOUT_MS` | | `60000` | Quá hạn ➔ 504 |
| `WORLD_DATA_DIR`, `MINING_DIR` | ✓ | — | File pipeline xuất |
| `PORT` | | `3000` | |
| `CORS_ORIGINS` | | `http://localhost:5173` | Phân tách bằng dấu phẩy |

Thiếu biến bắt buộc ➔ app dừng (exit 1) và liệt kê đủ các biến lỗi.

## Kiểm thử

```bash
npm test                                  # unit + integration (mongodb-memory-server, port giả)
npm run test:e2e                          # cả app, LLM/embedding giả, Qdrant in-memory
E2E_QDRANT_URL=http://localhost:6555 npm run test:e2e   # e2e với Qdrant thật (seed collection *_test)
QDRANT_URL=... QDRANT_COLLECTION=rag_ts_test npx ts-node scripts/seed-qdrant.ts
npx tsc --noEmit && npm run lint
```

`scripts/seed-qdrant.ts` từ chối mọi collection không có hậu tố `_test`.

## Đồng bộ với frontend 3D (Phụ lục A, tóm tắt)

| Điểm | Việc FE cần làm |
| :-- | :-- |
| Base URL | `VITE_API_BASE=/api/v1`, proxy Vite `/api/v1` ➔ `http://localhost:3000` |
| `nprobe` | Đã hỗ trợ trong body chat (1–6, mặc định 2) |
| Event SSE | Khớp; `done` có thêm `session_id`, `message_id` |
| Health | Đọc `components.{mongo,qdrant,llm,world}` thay cho `{ lancedb, llm, world }` |
| World 3D, luồng cào | Gọi pipeline UTH (`VITE_PIPELINE_BASE`), không qua RAG_TS |

## Giới hạn đã biết

- Pipeline chưa xuất file world (`tree.json`, centroid, `categories.json`) và payload `twig_id`, `chunk_index` (Phụ lục B) ➔ `route` rỗng, `compare` không lọc theo nhánh, `category_index` = -1.
- Huỷ stream khi LLM còn đang đọc prompt dài: slot LLM chỉ giải phóng khi sinh tới token đầu (~15 s với `top_k` 5 trên Metal).
- `prompt_fe_3d.md` (được tham chiếu trong kế hoạch) không có trong repo — định dạng world lấy theo type FE `frontend_rag/src/shared/types/world.ts`.
