# PROGRESS — backend RAG_TS

| Prompt | Trạng thái | Test | Ghi chú |
| :-- | :-- | :-- | :-- |
| B1 Bootstrap & Common | Xong | 22 unit + 2 e2e pass | Thiếu env ➔ exit 1 liệt kê đủ biến; 404 đúng §1.2 + `X-Request-Id`; 1 dòng log JSON/request, không chứa Authorization |
| B2 Auth | Xong | 18 integration (mongodb-memory-server) | 7 route; xoay vòng refresh, dùng lại ➔ thu hồi cả họ; 2 refresh đồng thời chỉ 1 thành công; 5 lần sai ➔ 429; log `LOGIN_FAILED` chỉ có `email_hash` |
| B3 Embedding | Xong | 8 unit | Chạy thật: 768 chiều, norm 1.0, 43 ms/câu; khớp vector Python của pipeline (cosine 0.99999999999) |
| B4 Qdrant (chỉ đọc) | Xong | 15 unit | Qdrant thật: câu LoRA ➔ top 1 là 2106.09685 (0.8275); lọc `cs.CL` đúng; `scrollByPaper` 18 chunk; payload chưa có `twig_id` |
| B5 Mining & Tree Router | Xong (thiếu dữ liệu world) | 26 unit | Dữ liệu mining thật: 120 tác giả, 7 luật chữ; "Liu" không khớp "Yang Liu". Chưa kiểm được `node_id` với `tree.json` vì pipeline chưa xuất file world (Phụ lục B P1) — route trả `steps: []` |
| B6 LLM Queue | Xong | 11 unit | Model thật (Metal): nạp 4,6 s; 10 request cùng lúc với LLM_MAX_QUEUE=8 ➔ 1 chạy + 8 chờ + 1 nhận 429; abort ➔ queue_length về 0 |
| B7 RAG & SSE | Xong | 20 integration | Chạy thật: thứ tự event đúng; câu LoRA có citation + LaTeX, 520 token / 42 s (Metal); huỷ stream ➔ log `CHAT_STREAM_ABORTED`, không lưu; slot LLM giải phóng ~15 s sau (đang đọc prompt). Chưa chạy được bước FE `VITE_USE_MOCK=false` (cần FE đổi base URL + health) |
| B8 Chat sessions | Xong | 11 integration | Thật: hỏi 2 câu cùng session có JWT ➔ `message_count` = 4; phân trang 3 trang không trùng/sót (cả khi trùng `updated_at`) |
| B9 Papers | Xong | 7 integration | Thật: `2106.09685` ➔ 18 chunk, abstract đầu, year 2021; `s2_…` ➔ 181 chunk. `category_index` = -1 vì chưa có `categories.json` |
| B10 Health | Xong | 7 unit | Thật (Qdrant qua proxy bị tắt): `/health/ready` 503 + `HEALTH_CHANGED` up➔down; bật lại ➔ 200 + down➔up |
| B11 E2E, Docker, OpenAPI, README | Xong | 6 e2e (Qdrant in-memory và Qdrant thật) | `/api/v1/docs-json` đủ 18 route; `seed-qdrant` từ chối `scientific_papers_gold`; `docker compose up` ➔ app healthy, `/health` degraded khi không có model |
| S1 Security Baseline | Xong | 5 unit (`env.schema.spec.ts`) | `helmet` 8.3 (CSP + HSTS khi production + nosniff + frameguard DENY); `trust proxy` = 1 (production) / loopback (test) / false (dev) qua `express.set()`; `@nestjs/throttler` 6.7.1 đăng ký 1 throttler tên `default` + `APP_GUARD`; Swagger **tắt** khi `NODE_ENV=production`; `env.schema.ts` chặn secret placeholder, 2 secret trùng nhau, `MONGO_URI` thiếu credential; `DUMMY_HASH` Argon2id chống user enumeration; dọn credential plaintext khỏi `README.md` + `benchmark/seed_prod_auth_data.js`; `/health` mask chi tiết ở production |
| S2 User Schema & Password Policy | Xong | 7 unit (`common-passwords.spec.ts`) | `users` thêm `is_active`, `disabled_at`, `disabled_by`, `disabled_reason`, `token_version`, `last_login_at`; policy: 10–200 ký tự, blacklist 200 mật khẩu phổ biến, chặn mật khẩu chứa local-part của email (bỏ `.` `-` `_`) |
| S3 Token Hardening & Revocation | Xong | 19 integration (`auth.spec.ts`) | JWT access thêm claim `ver` (= `users.token_version`); `JwtAuthGuard` + `OptionalJwtAuthGuard` tra `is_active` + `token_version` mỗi request (cache LRU 5 s, invalidate tức thì khi admin hành động); `revokeAllForUser` thu hồi refresh + bump `token_version` ➔ token cũ chết ngay |
| S4 AdminModule Core & Audit Log | Xong | 22 integration (`admin.spec.ts`) | `admin_audit_logs` append-only (không có endpoint/service xoá/sửa); audit ghi **mọi** hành động admin kể cả read-only; `AdminAuditService` / `AdminIdentityService` / `AdminOpsService` tách theo trách nhiệm |
| S5 Admin — Quản lý danh tính | Xong | (chung `admin.spec.ts`) | A1 list user (lọc `q`/`role`/`active`, cursor, không lộ `password_hash`), A2 chi tiết, A3 đổi role (tự hạ cấp ➔ 409 `SELF_LOCKOUT_FORBIDDEN`; admin cuối ➔ 409 `LAST_ADMIN_PROTECTED`), A4 khoá/mở khoá, A6 thu hồi token, E1 xem token family. **Không** có reset password (A5) |
| S6 Admin — Nội dung & Vận hành | Xong | (chung `admin.spec.ts`) | B1 xem session của user, B1b xem message (chỉ đọc, **không** có endpoint xoá), C1 thống kê tổng quan, C2 login attempts, C3 health chi tiết |
| S7 Admin Bootstrap CLI | Xong | — | `npm run create:admin -- --email <email> [--password <pw>]`; idempotent (chạy lại ➔ nâng role lên admin + bump `token_version`); mật khẩu đọc từ `--password` / `ADMIN_PASSWORD` / prompt stdin |
| S8 Test Matrix & Doc Sync | Xong | 193 unit/integration pass (16 suite) | `npm run build` sạch; `eslint src/**/*.ts` sạch; `tsc --noEmit` sạch cho `src/` |

**Tổng:** 193 unit/integration pass (16 suite); `npm run build`, `tsc --noEmit` (src) và `eslint` sạch.

## Vấn đề tồn tại

1. Pipeline chưa xuất file world (`tree.json`, `centroids_l1/l2.json`, `categories.json`) và payload `twig_id`, `chunk_index` (Phụ lục B P1–P3): event `route` rỗng, `compare` không lọc theo nhánh, `category_index` = -1.
2. FE chưa đổi `VITE_API_BASE=/api/v1` và cách đọc health (Phụ lục A1, A5) — chưa chạy được bước kiểm chứng B7 với FE thật.
3. Huỷ stream khi LLM đang đọc prompt: slot giải phóng chậm (~15 s với top_k 5).
4. Qwen 7B không chạy được trong Docker trên Mac 8 GB (CPU, hết RAM) — dev nên chạy app ngoài Docker.
5. Luật FP-Growth thật chỉ có 7/41 luật dạng chữ, vài tag bị cắt (`attention-mech`) ➔ mở rộng query ít khi kích hoạt.
6. **Backlog (đã chốt, chưa làm)**: FE chuyển token từ Bearer sang cookie `HttpOnly` (`SameSite=Lax`) — hiện access token vẫn nằm trong bộ nhớ JS. Thống kê doanh thu / quota theo user (nhóm chưa thống nhất). Admin xoá nội dung vi phạm (hiện chỉ xem). Rate-limit theo tài khoản thay vì theo IP (chưa có identity trước khi xác thực).
