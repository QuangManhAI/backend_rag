# AGENTS.md — Backend AI Agent Operating Manual (`backend_rag`)

- **Motivation/Background**: `backend_rag` is a high-concurrency NestJS 11 monolith integrating remote MongoDB (over a Cloudflare TCP tunnel), Qdrant vector search, local GGUF LLM inference (`node-llama-cpp`), PageRank/FP-Growth data mining, `Argon2id` + JWT authentication, UUIDv7 chat persistence, and an in-memory generation-versioned `LRUCache` layer certified for `400 CUs` (`250 RPS`). AI agents working on `backend_rag` need an authoritative module map and invariant checklist so new changes never break security or latency SLAs.
- **Purpose**: Provide AI coding agents with the complete module map, database/caching invariants, error-handling rules, and test/benchmark verification workflows for `backend_rag`.
- **Overview Pipeline**: HTTP Request (`/api/v1/*`) → `JwtAuthGuard` / `OptionalJwtAuthGuard` → `ValidationPipe` DTO Check → Service Layer (`LRUCache` / `Singleflight` / `.lean()` MongoDB / Qdrant / LLM) → Standardized Response or `HttpExceptionFilter` Envelope.
- **Detailed Plan**: Section 1 maps the `src/` Module Directory; Section 2 enforces the 7 Non-Negotiable Backend Invariants; Section 3 documents the Caching & Invalidation Contract; Section 4 specifies the Error & Validation Contract; Section 5 lists Unit, Integration, and SRE Benchmark Commands.
- **References**: [../AGENTS.md](../AGENTS.md), [../docs/INDEX.md](../docs/INDEX.md), [../docs/prompt_security.md](../docs/prompt_security.md), [docs/AUTH_AND_SECURITY_ARCHITECTURE.md](docs/AUTH_AND_SECURITY_ARCHITECTURE.md), [docs/PERFORMANCE_AND_CACHING.md](docs/PERFORMANCE_AND_CACHING.md), [docs/MONGODB_SCHEMA_DESIGN.md](docs/MONGODB_SCHEMA_DESIGN.md), [docs/CHAT_SESSIONS_SPECIFICATION.md](docs/CHAT_SESSIONS_SPECIFICATION.md), [benchmark/BOTTLENECK_ANALYSIS_AND_OPTIMIZATION.md](benchmark/BOTTLENECK_ANALYSIS_AND_OPTIMIZATION.md).
- **Created**: 2026-10-29T19:44:00+07:00
- **Last Updated**: 2026-11-02T11:15:00+07:00

[STATUS: ACTIVE]

---

## 1. Backend Module Map (`backend_rag/src/`)

| Path | Module / Component | Key Responsibilities |
| :--- | :--- | :--- |
| [`src/main.ts`](src/main.ts) | **Bootstrap & HTTP Tuning** | Pins `UV_THREADPOOL_SIZE = '4'` (for `Argon2id`), sets global prefix `/api/v1`, configures `ValidationPipe`, registers `HttpExceptionFilter`, and sets HTTP Keep-Alive (`keepAliveTimeout = 65_000`, `headersTimeout = 66_000`). |
| [`src/app.module.ts`](src/app.module.ts) | **Root Module & MongoDB Pool** | Configures `MongooseModule.forRootAsync` with `maxPoolSize: 120`, `minPoolSize: 20`, `maxIdleTimeMS: 60_000` over `MONGODB_URI` (`localhost:27018`). |
| [`src/config/`](src/config/) | **`ConfigModule` (`env.schema.ts`)** | Validates environment variables at startup (`PORT`, `MONGODB_URI`, `QDRANT_HOST`, `JWT_ACCESS_SECRET`, `LLM_CONCURRENCY`, `LLM_MAX_QUEUE`, etc.). |
| [`src/common/`](src/common/) | **Shared Filters, Pipes & Utils** | [`http-exception.filter.ts`](src/common/http-exception.filter.ts) (unified error envelope), [`uuid.ts`](src/common/uuid.ts) (RFC 9562 UUIDv7 generator & validator), [`sanitize.ts`](src/common/sanitize.ts) (`escapeRegex` for ReDoS prevention), [`security.ts`](src/common/security.ts) (`helmet` config + `trust proxy` setting), [`throttler.ts`](src/common/throttler.ts) (`RATE_LIMITS` + `@RateLimit()` decorator). |
| [`src/auth/`](src/auth/) | **`AuthModule`** | [`auth.controller.ts`](src/auth/auth.controller.ts), [`auth.service.ts`](src/auth/auth.service.ts) (`Argon2id` register/login/change-password, progressive lockout, `DUMMY_HASH` anti-enumeration, `userCache`/`userByEmailCache`/`tokenVersionCache`), [`token.service.ts`](src/auth/token.service.ts) (JWT signing with the `ver` claim + 1-RTT atomic refresh token rotation with family reuse revocation), [`common-passwords.ts`](src/auth/common-passwords.ts) (password policy: 10–200 chars, 200-password blacklist, email-local-part rejection). |
| [`src/admin/`](src/admin/) | **`AdminModule`** (RBAC `admin`/`user`) | [`admin.controller.ts`](src/admin/admin.controller.ts) (13 routes, every one behind `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`), [`admin-identity.service.ts`](src/admin/admin-identity.service.ts) (A1–A4, A6, E1 + self-protection), [`admin-ops.service.ts`](src/admin/admin-ops.service.ts) (B1, B1b, C1–C3 — **read-only**, no delete endpoints), [`admin-audit.service.ts`](src/admin/admin-audit.service.ts) (append-only `admin_audit_logs`), [`schemas/admin-audit-log.schema.ts`](src/admin/schemas/admin-audit-log.schema.ts). |
| [`src/chat-sessions/`](src/chat-sessions/) | **`ChatSessionsModule`** | [`chat-sessions.controller.ts`](src/chat-sessions/chat-sessions.controller.ts), [`chat-sessions.service.ts`](src/chat-sessions/chat-sessions.service.ts) (UUIDv7 sessions & messages, cursor pagination, regex search, soft-delete, `Singleflight` + generation-versioned `LRUCache`). |
| [`src/rag/`](src/rag/) | **`RagModule`** | [`rag.controller.ts`](src/rag/rag.controller.ts), [`rag.service.ts`](src/rag/rag.service.ts) (`POST /rag/chat` and SSE `POST /rag/chat/stream`, hybrid Qdrant retrieval + PageRank/FP-Growth mining + LLM citation grounding + automatic session exchange persistence). |
| [`src/embedding/`](src/embedding/) | **`EmbeddingModule`** | Nomic Embed Text v1.5 (`768`-dim) query embedding generation with mandatory `search_query: ` prefix. |
| [`src/vector-store/`](src/vector-store/) | **`VectorStoreModule`** | Read-only Qdrant client (`scientific_papers_gold`), auto-detecting `https: true` on port `443` (`D-004`). |
| [`src/mining/`](src/mining/) | **`MiningModule`** | Loads co-authorship PageRank scores (`graph_coauthorship.json`) and FP-Growth association rules (`association_rules.json`) for authority boosting and query expansion. |
| [`src/llm/`](src/llm/) | **`LlmModule`** | `node-llama-cpp` GGUF inference runner (`Qwen2.5-7B-Instruct-Q4_K_M`) with bounded semaphore queue (`LLM_CONCURRENCY=1`, `LLM_MAX_QUEUE=8`) that sheds excess load with `429 Too Many Requests`. |
| [`src/tree-router/`](src/tree-router/) | **`TreeRouterModule`** | Serves 3D Knowledge Tree topology (`GET /world/tree`), cluster centroids, and paper details for `frontend_rag`. |
| [`src/papers/`](src/papers/) | **`PapersModule`** | Paper metadata lookup and citation formatting endpoints. |
| [`src/health/`](src/health/) | **`HealthModule`** | `GET /api/v1/health` readiness probe checking MongoDB, Qdrant, Embedding model, and LLM status. |

---

## 2. Seven Non-Negotiable Backend Invariants

1. **Never Weaken `Argon2id` or Change `UV_THREADPOOL_SIZE` Without Benchmarking (`D-021`, `D-022`)**:
   - [`auth.service.ts`](src/auth/auth.service.ts) uses `argon2.argon2id` with `memoryCost: 65536` (`64 MB`), `timeCost: 3`, `parallelism: 4`.
   - [`main.ts`](src/main.ts) sets `process.env.UV_THREADPOOL_SIZE = '4'`. Increasing this to `12` caused DRAM bandwidth thrashing (`+26.7%` latency regression).
2. **Preserve 1-RTT Atomic Refresh Token Rotation & Reuse Detection (`D-021`)**:
   - In [`token.service.ts`](src/auth/token.service.ts), `consume(rawToken)` uses a single atomic `findOneAndUpdate({ token_hash, revoked_at: null }, { $set: { revoked_at: now } })` on the happy path.
   - If `findOneAndUpdate` returns `null`, it inspects the existing document: if `revoked_at !== null`, it **must** revoke the entire token family (`updateMany({ family_id }, { $set: { revoked_at: now } })`) and throw `401 TOKEN_REUSE_DETECTED`.
3. **Always Use `.lean()` and Parallelize Independent Queries over the Tunnel (`D-021`)**:
   - Because MongoDB runs over a Cloudflare TCP tunnel (`localhost:27018`, ~15–25ms RTT), never execute sequential `await model.findOne()` calls when they can run concurrently via `Promise.all([...])`.
   - Always chain `.lean()` on read and `findOneAndUpdate` queries that return DTOs to bypass Mongoose `Document` hydration overhead.
4. **Enforce UUIDv7 Keys, Soft-Delete (`deleted_at: null`), and Ownership (`404`, Never `403`)**:
   - `ChatSession` and `ChatMessage` `_id` fields are RFC 9562 **UUIDv7** strings (`generateUuidV7()`).
   - Every query on `chat_sessions` or `chat_messages` must filter by `deleted_at: null`.
   - If a session ID does not exist, is soft-deleted, or belongs to a different `user_id`, always throw `NotFoundException` (`404 Not Found`) so attackers cannot enumerate valid UUIDv7 session IDs across users.
5. **Maintain Cache Coherency on Every Write Path (`D-021`)**:
   - See Section 3 below for the exact cache invalidation calls required when modifying `AuthService` or `ChatSessionsService`.
6. **Sanitize Regex Search Queries**:
   - Always pass user search strings through `escapeRegex(q)` ([`src/common/sanitize.ts`](src/common/sanitize.ts)) before constructing MongoDB `$regex` filters to prevent ReDoS attacks.
7. **Strict Type Safety & Privacy Logging**:
   - Never use `any` in DTOs or service contracts.
   - Never log plaintext passwords, JWTs, refresh tokens, or raw user query strings (log only `query_len`).

---

## 2.1 Security & RBAC Invariants (added by `docs/prompt_security.md`)

8. **Every Admin Route Needs Three Layers**:
   - `JwtAuthGuard` (authenticate) ➔ `RolesGuard` with `@Roles('admin')` (authorize) ➔ service-level scope check (defense in depth, `AdminIdentityService.assertAdmin`).
   - The admin surface is **read-mostly**: there is deliberately **no** endpoint that deletes chat content or audit records.
9. **Permission Changes Must Kill Live Tokens Immediately**:
   - Any role change, account lock, or password change **must** call `AuthService.revokeAllForUser(userId)` — it revokes every refresh token **and** increments `users.token_version`.
   - The access-token claim `ver` carries the `token_version` at issue time; `JwtAuthGuard` rejects a token whose `ver` no longer matches the stored value.
   - The account-state cache (`tokenVersionCache`, `LRU`, `5 s` TTL) **must** be invalidated explicitly (`AuthService.invalidateUserCaches`) on every admin mutation, otherwise the change only takes effect after the TTL.
10. **Self-Protection Rules Can Never Be Bypassed**:
    - An admin cannot demote or lock **their own** account ➔ `409 SELF_LOCKOUT_FORBIDDEN`.
    - The **last** active admin cannot be demoted or locked ➔ `409 LAST_ADMIN_PROTECTED`.
    - Both checks live in the service layer, not only in the controller.
11. **The Audit Trail Is Append-Only**:
    - `admin_audit_logs` has **no** delete or update path — neither a service method nor an HTTP route.
    - Every admin action, **including read-only ones** (`USER_LIST_VIEW`, `HEALTH_VIEW`, `AUDIT_LOG_VIEW`), writes a record with actor, target, before/after state, IP and request id.
12. **No Admin Endpoint May Write `password_hash`**:
    - The admin bootstrap is a **CLI script** (`npm run create:admin`), never an HTTP endpoint — there is no network path to escalate privileges.
13. **Security Headers & Rate Limiting Are Global, Not Per-Route**:
    - `helmet` is applied in [`app.setup.ts`](src/app.setup.ts) for every response; Swagger is **disabled** in production.
    - `trust proxy` is set through `app.getHttpAdapter().getInstance().set('trust proxy', …)` (`1` in production, `'loopback'` in test, `false` in dev) so the rate limiter keys on the real client IP.
    - Exactly **one** throttler named `default` is registered in `ThrottlerModule.forRoot([...])`; `ThrottlerGuard` is bound via `APP_GUARD`. Sensitive routes narrow the limit with `@RateLimit('login')` etc. from [`src/common/throttler.ts`](src/common/throttler.ts).
14. **Passwords Follow the Policy in `src/auth/common-passwords.ts`**:
    - 10–200 characters, not one of the 200 most common passwords, and must not contain the local part of the account email.
    - `validatePassword()` is called from `register()`, `changePassword()` and the admin bootstrap CLI — never bypass it.
15. **Never Log or Return Secrets**:
    - No plaintext MongoDB URI, Qdrant API key or JWT secret may appear in a committed file (`README.md`, `benchmark/*.js`, docs).

---

## 3. In-Memory Caching & Invalidation Contract (`lru-cache`)

To sustain **`400 CUs` (`250 RPS`)** over the Cloudflare MongoDB tunnel with `P95 = 265.54ms < 500ms`, two services maintain bounded `LRUCache` instances (`300s` sliding TTL with `updateAgeOnGet: true`). Any new mutation method **must** follow these invalidation rules:

| Service | Cache Instance(s) | Read Path | Mandatory Write-Path Invalidation / Update |
| :--- | :--- | :--- | :--- |
| [`AuthService`](src/auth/auth.service.ts) | `userCache` (by `userId`)<br>`userByEmailCache` (by `email`)<br>`attemptCountCache` (by `email`) | `getMe()`, `login()`, `updateProfile()` | • `register()`: populate `userCache` & `userByEmailCache`.<br>• `updateProfile()`: update `userCache` & `userByEmailCache` in-place.<br>• `changePassword()`: `userByEmailCache.delete(email)`.<br>• `login()` failure: increment `attemptCountCache`; on lockout or success: `attemptCountCache.set(email, 0)`. |
| [`ChatSessionsService`](src/chat-sessions/chat-sessions.service.ts) | `listCache` (keyed by `userId:gen:limit:cursor:q`)<br>`sessionDetailCache` (keyed by `userId:sessionId:gen`)<br>`inflightDetail` (`Singleflight` map) | `list()`, `get()` | • `saveExchange()`: call **`this.bumpUserGen(userId)`** ($O(1)$ invalidation of all list & detail entries for `userId`).<br>• `remove()` (soft-delete): call **`this.bumpUserGen(userId)`**.<br>• `rename()`: call **`this.bumpUserGen(userId)`** (or update cached detail + bump list generation). |

For deep architectural details and why `Singleflight` + sliding TTL prevents cache stampedes at `t = 120s`, read [`docs/PERFORMANCE_AND_CACHING.md`](docs/PERFORMANCE_AND_CACHING.md).

---

## 4. Standardized Error Envelope Contract

All exceptions are caught by [`HttpExceptionFilter`](src/common/http-exception.filter.ts) and serialized into the canonical JSON envelope defined in [`../docs/API_DESIGN.md`](../docs/API_DESIGN.md):

```json
{
  "statusCode": 401,
  "error": "TOKEN_REUSE_DETECTED",
  "message": "Refresh token has already been used; token family revoked",
  "details": null,
  "timestamp": "2026-10-29T18:00:00.000Z",
  "path": "/api/v1/auth/refresh"
}
```

When throwing custom `HttpException` subclasses in services, always pass `{ error: '<MACHINE_CODE>', message: '<Human message>', details: ... }` so frontend error handlers can branch deterministically on `error`.

---

## 5. Verification, Testing & SRE Benchmarking Commands

### 5.1 Unit & Integration Tests (In-Memory MongoDB)
Unit and integration specs use `mongodb-memory-server` and mocked external stores — no live tunnel or GPU required:
```powershell
# Run the security-critical suites (Auth + Admin + Chat Sessions)
npx jest src/auth/auth.spec.ts src/admin/admin.spec.ts src/chat-sessions/chat-sessions.spec.ts --runInBand

# Run full backend test suite (193 tests / 16 suites)
npm test
```

> A test that issues a JWT **must** seed the matching account in MongoDB via `seedUser()` from [`src/testing/test-app.ts`](src/testing/test-app.ts) — the guards now look the account up on every request.

### 5.2 Production Build & Typecheck
```powershell
npm run build
```

### 5.3 3-Stage Production SRE Stress Test Suite (`benchmark/`)
Requires the `cloudflared` tunnel on `localhost:27018` and production build (`node dist/main.js`):
```powershell
# 1. Seed 100 users, 1,500 UUIDv7 sessions, and 15,000 messages
node benchmark/seed_prod_auth_data.js

# 2. Stage A: Open-Workload Ramping Arrival Rate Breakpoint Finder (50 -> 500 RPS)
k6 run --summary-export=benchmark/results/prod_open_breakpoint_summary.json benchmark/k6_prod_open_breakpoint.ts

# 3. Stage B: Rule L1 3-Minute Continuous Hold-Out Certification (400 CUs / 250 RPS)
k6 run --summary-export=benchmark/results/prod_certified_holdout_summary.json benchmark/k6_prod_certified_holdout.ts

# 4. Stage C: Argon2id Crypto & Token Rotation Isolation Stress
k6 run --summary-export=benchmark/results/prod_auth_crypto_summary.json benchmark/k6_prod_auth_crypto.ts
```
See [`docs/PERFORMANCE_AND_CACHING.md`](docs/PERFORMANCE_AND_CACHING.md) and [`benchmark/README.md`](benchmark/README.md) for full details.
