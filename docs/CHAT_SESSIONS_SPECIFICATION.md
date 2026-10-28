# Chat Sessions — Full-Stack Specification

- **Motivation/Background**: The application originally persisted only one ephemeral in-memory conversation, while multi-session conversational RAG requires persistent sessions that can be lazily created, listed, reopened, renamed, and deleted across backend MongoDB collections and frontend state.
- **Purpose**: Define the authoritative full-stack specification for chat-session identity, versioned REST APIs, cursor pagination, MongoDB persistence, security scoping, offline caching, and lifecycle operations.
- **Overview Pipeline**: Synthesizes the core domain model, JWT-authenticated NestJS backend contract, MongoDB schema design, and planned React/IndexedDB frontend synchronization into a single active source of truth.
- **Detailed Plan**: §1 Input constraints and architectural stance; §2 Domain and data model; §3 Backend API contract (`/api/v1/chat-sessions`); §4 Frontend and offline behavior (target specification); §5 Lifecycle, concurrency, and consistency rules; §6 Rejected or risky interpretations; §7 Finalized architectural decisions & status; §8 Acceptance criteria and test verification.
- **References**: [`../../frontend_rag/src/types/rag.ts`](../../frontend_rag/src/types/rag.ts), [`../src/types/scientific-rag.ts`](../src/types/scientific-rag.ts), [`MONGODB_SCHEMA_DESIGN.md`](MONGODB_SCHEMA_DESIGN.md), [`CHAT_SESSIONS-SPEC-TESTS.md`](CHAT_SESSIONS-SPEC-TESTS.md), [`../../docs/API_SPECIFICATION.md`](../../docs/API_SPECIFICATION.md), [`../../agents/rules/MD_CONVENTION.md`](../../agents/rules/MD_CONVENTION.md), [`../../docs/AI_chat_log/Khoi_chat_log.md`](../../docs/AI_chat_log/Khoi_chat_log.md)
- **Created**: 2026-10-16T16:36:03+07:00
- **Last Updated**: 2026-10-28T16:47:00+07:00

---

[STATUS: ACTIVE]

## Table of Contents

- [1. Input constraints and architectural stance](#1-input-constraints-and-architectural-stance)
- [2. Domain and data model](#2-domain-and-data-model)
  - [2.1 Session summary](#21-session-summary)
  - [2.2 Session detail](#22-session-detail)
  - [2.3 Identity and initial title](#23-identity-and-initial-title)
  - [2.4 Message persistence and RAG metadata](#24-message-persistence-and-rag-metadata)
  - [2.5 Tenancy and ownership](#25-tenancy-and-ownership)
- [3. Backend API contract](#3-backend-api-contract)
  - [3.1 List session summaries (`GET /api/v1/chat-sessions`)](#31-list-session-summaries-get-apiv1chat-sessions)
  - [3.2 Get session detail (`GET /api/v1/chat-sessions/:id`)](#32-get-session-detail-get-apiv1chat-sessionsid)
  - [3.3 Lazy session creation (`POST /api/v1/rag/chat`)](#33-lazy-session-creation-post-apiv1ragchat)
  - [3.4 Rename session (`PATCH /api/v1/chat-sessions/:id`)](#34-rename-session-patch-apiv1chat-sessionsid)
  - [3.5 Delete session (`DELETE /api/v1/chat-sessions/:id`)](#35-delete-session-delete-apiv1chat-sessionsid)
- [4. Frontend and offline behavior (Target specification)](#4-frontend-and-offline-behavior-target-specification)
  - [4.1 IndexedDB shape](#41-indexeddb-shape)
  - [4.2 The "10 most recent" cache rule](#42-the-10-most-recent-cache-rule)
  - [4.3 Online and offline state](#43-online-and-offline-state)
  - [4.4 Session-list actions and PC context menu](#44-session-list-actions-and-pc-context-menu)
  - [4.5 Session list loading and cursor paging](#45-session-list-loading-and-cursor-paging)
  - [4.6 Reload and session restoration](#46-reload-and-session-restoration)
- [5. Lifecycle, concurrency, and consistency rules](#5-lifecycle-concurrency-and-consistency-rules)
  - [5.1 Rename](#51-rename)
  - [5.2 Delete and TTL purging](#52-delete-and-ttl-purging)
  - [5.3 Concurrent updates (Last-Write-Wins)](#53-concurrent-updates-last-write-wins)
  - [5.4 Error handling matrix](#54-error-handling-matrix)
- [6. Rejected or risky interpretations](#6-rejected-or-risky-interpretations)
- [7. Finalized architectural decisions & status](#7-finalized-architectural-decisions--status)
- [8. Acceptance criteria and test verification](#8-acceptance-criteria-and-test-verification)

---

## 1. Input constraints and architectural stance

The functional requirements for chat sessions include:

1. A session is initially named using a timestamp based on its creation time in `UTC+07`.
2. The frontend offline cache retains the 10 most recent chats in local storage (IndexedDB).
3. The session list returns lightweight summaries using server-side cursor pagination with a fixed page size of 10 items.
4. Users can rename and delete their sessions.
5. All operations are strictly authenticated and multi-tenant isolated.

### Architectural decisions summary

| Area | Final Stance | Reason |
| :--- | :--- | :--- |
| **Session identity** | Opaque, immutable UUIDv7 `_id` (`string`) | Time-ordered, globally unique, avoids timestamp collision, presentation-independent |
| **Initial title** | `YY-MM-DD:HH-MM-SS` in `UTC+07` derived at creation | Meets timestamp naming requirement without coupling presentation to identity |
| **List response** | Summaries only, sorted by `last_message_at DESC, _id DESC` | Keeps list bandwidth minimal; renaming does not reorder the session list |
| **Pagination** | Fixed page size of 10 summaries (`SESSION_PAGE_SIZE = 10`), opaque base64url cursor | Enforces predictable payload sizes; supports optional substring search `q` (max 120 chars) |
| **Ownership & Auth** | Authenticated JWT Bearer token (`user_id: ObjectId`) using [`JwtAuthGuard`](../src/auth/guards/jwt-auth.guard.ts) | Integrates with repository authentication module; replaces initial anonymous `device_id` cookie proposal |
| **Server retention** | Uncapped active session retention in MongoDB; 10-session limit applies strictly to client IndexedDB cache | Server supports full conversation archives while browser offline cache remains lean |
| **Persistence** | Two collections: `chat_sessions` (metadata) and `chat_messages` (ordered messages) | Eliminates unbounded document growth inside MongoDB; enforces 16 MB BSON safety |
| **Lazy creation** | Sessions created on the first question/answer exchange via RAG chat; `POST /api/v1/chat-sessions` omitted | Prevents empty/abandoned sessions when a user visits without chatting |
| **Concurrency** | Last-Write-Wins (LWW) on `PATCH /api/v1/chat-sessions/:id` | Straightforward, idempotent, avoids user-facing `409` lock failures on simple renames |
| **Delete semantics** | Cascaded soft delete (`deleted_at: Date`) with 3-day TTL index (`SESSION_TTL_SECONDS = 259200`), idempotent `204` | Hides sessions immediately, allows sync recovery window, auto-purges expired records via MongoDB TTL |

---

## 2. Domain and data model

Full schema definitions and index definitions are specified in [`MONGODB_SCHEMA_DESIGN.md`](MONGODB_SCHEMA_DESIGN.md).

### 2.1 Session summary

The list endpoint returns only lightweight summaries:

```ts
interface ChatSessionSummary {
  id: string;               // UUIDv7 string
  title: string;            // Default timestamp or custom title (max 120 chars)
  created_at: string;       // ISO 8601 UTC timestamp
  updated_at: string;       // ISO 8601 UTC timestamp
  message_count: number;    // Denormalized count of active messages
  last_message_at: string | null; // Timestamp of latest message exchange
}
```

### 2.2 Session detail

Opening a single session returns session metadata plus its ordered messages (capped at `MAX_MESSAGES = 200` newest in chronological order):

```ts
interface ChatSession extends ChatSessionSummary {
  messages: ChatMessage[];
}
```

### 2.3 Identity and initial title

- **Session `id`**: Server-generated UUIDv7 string. UUIDv7 provides millisecond-level time-ordering while maintaining 74 bits of cryptographic entropy to prevent enumeration attacks.
- **Title derivation**: Default title generated on creation as `YY-MM-DD:HH-MM-SS` in `UTC+07` (e.g., `26-10-28:16-45-00`). Once renamed by the user, the custom title is preserved across subsequent chat exchanges.
- **Constraints**: Custom title must be 1 to 120 characters long. Leading and trailing whitespace is automatically trimmed.

### 2.4 Message persistence and RAG metadata

Messages are persisted in a separate `chat_messages` collection:

```ts
interface ChatMessageDocument {
  _id: string;                 // UUIDv7 string
  session_id: string;          // Owning session UUIDv7
  user_id: Types.ObjectId;     // Owning user ObjectId
  role: 'user' | 'assistant';  // Message sender
  content: string;             // Raw text query or markdown response
  citations?: Citation[];      // Scientific paper citations from RAG
  grounded_chunks?: GroundedChunk[]; // Retrieved context passages
  timings?: TimingMetrics;     // Latency breakdowns
  created_at: Date;            // Message timestamp
  deleted_at: Date | null;     // Soft-delete timestamp
}
```

RAG metadata (`citations`, `grounded_chunks`, `timings`) is preserved verbatim, ensuring the frontend Grounded Inspector renders identical citations when switching between historical sessions.

### 2.5 Tenancy and ownership

Every session document and message document contains an immutable `user_id: Types.ObjectId` field extracted from the validated JWT token (`@CurrentUser()`). All queries and mutations apply `{ user_id: currentUserId, deleted_at: null }`. Cross-user access returns `404 Not Found` to prevent tenancy enumeration.

---

## 3. Backend API contract

All chat-session endpoints are hosted under `/api/v1/chat-sessions` and require a valid Bearer token (`Authorization: Bearer <jwt>`).

### 3.1 List session summaries (`GET /api/v1/chat-sessions`)

Fetches paginated session summaries for the authenticated user.

- **URL**: `GET /api/v1/chat-sessions`
- **Query Parameters**:
  - `cursor` (optional, string, max 512 chars): Opaque base64url cursor encoding `last_message_at` and `_id`.
  - `q` (optional, string, max 120 chars): Case-insensitive substring search filter on `title` (regex-escaped).
- **Page Size**: Fixed at 10 items (`SESSION_PAGE_SIZE = 10`). Clients cannot override the page size.
- **Response** (`200 OK`):
  ```json
  {
    "items": [
      {
        "id": "0192e21b-8000-7000-8000-000000000001",
        "title": "26-10-28:16-45-00",
        "created_at": "2026-10-28T09:45:00.000Z",
        "updated_at": "2026-10-28T09:45:00.000Z",
        "message_count": 2,
        "last_message_at": "2026-10-28T09:45:02.000Z"
      }
    ],
    "next_cursor": "eyJ0IjoiMjAyNi0xMC0yOFQwOTo0NTowMi4wMDBaIiwiaWQiOiIwMTkyZTIxYi04MDAwLTcwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ",
    "has_more": false
  }
  ```
- **Ordering**: `last_message_at DESC, _id DESC`. Sessions with null `last_message_at` sort after active conversations.
- **Errors**:
  - `400 Bad Request`: Malformed cursor, or `q` > 120 chars.
  - `401 Unauthorized`: Missing or invalid JWT.

### 3.2 Get session detail (`GET /api/v1/chat-sessions/:id`)

Fetches full session metadata and its chronologically ordered messages.

- **URL**: `GET /api/v1/chat-sessions/{session_id}`
- **Truncation**: Returns up to the most recent 200 messages (`MAX_MESSAGES = 200`), chronologically ordered (`created_at ASC, _id ASC`).
- **Response** (`200 OK`):
  ```json
  {
    "id": "0192e21b-8000-7000-8000-000000000001",
    "title": "LoRA fine-tuning discussion",
    "created_at": "2026-10-28T09:45:00.000Z",
    "updated_at": "2026-10-28T09:48:12.000Z",
    "message_count": 2,
    "last_message_at": "2026-10-28T09:45:02.000Z",
    "messages": [
      {
        "id": "0192e21b-8000-7000-8000-000000000002",
        "role": "user",
        "content": "How does LoRA reduce trainable parameters?",
        "created_at": "2026-10-28T09:45:00.000Z"
      },
      {
        "id": "0192e21b-8000-7000-8000-000000000003",
        "role": "assistant",
        "content": "LoRA decomposes weight updates into two low-rank matrices...",
        "citations": [],
        "grounded_chunks": [],
        "timings": { "total_ms": 1250 },
        "created_at": "2026-10-28T09:45:02.000Z"
      }
    ]
  }
  ```
- **Errors**:
  - `401 Unauthorized`: Missing or invalid JWT.
  - `404 Not Found`: Session does not exist, was soft-deleted, belongs to another user, or has a malformed ID.

### 3.3 Lazy session creation (`POST /api/v1/rag/chat`)

Explicit empty session creation (`POST /api/v1/chat-sessions`) is deliberately omitted. Sessions are created lazily upon the first user interaction:

- **URL**: `POST /api/v1/rag/chat`
- **Body**:
  ```json
  {
    "query": "What are transformer attention mechanisms?",
    "session_id": null
  }
  ```
- **Behavior**:
  - When `session_id` is omitted or `null`, a new UUIDv7 session is generated with default title `YY-MM-DD:HH-MM-SS` in `UTC+07`.
  - User and assistant messages are saved atomically via `ChatSessionsService.saveExchange()`.
  - The returned RAG response includes the authoritative `session_id` and metadata.

### 3.4 Rename session (`PATCH /api/v1/chat-sessions/:id`)

Updates a session's mutable title.

- **URL**: `PATCH /api/v1/chat-sessions/{session_id}`
- **Body**:
  ```json
  {
    "title": "Transformer Attention Mechanisms"
  }
  ```
- **Validation**:
  - Trim whitespace.
  - Length: minimum 1 character, maximum 120 Unicode characters.
- **Concurrency**: Last-Write-Wins (LWW).
- **Response** (`200 OK`): Returns updated `ChatSessionSummary`.
- **Note**: Renaming updates `updated_at` but does **not** modify `last_message_at`; therefore, renaming does not alter the session's position in cursor pagination.
- **Errors**:
  - `400 Bad Request`: Empty title, whitespace-only title, or title exceeding 120 characters.
  - `401 Unauthorized`: Missing or invalid JWT.
  - `404 Not Found`: Session does not exist, belongs to another user, or is soft-deleted.

### 3.5 Delete session (`DELETE /api/v1/chat-sessions/:id`)

Soft-deletes a session and its associated messages.

- **URL**: `DELETE /api/v1/chat-sessions/{session_id}`
- **Behavior**: Sets `deleted_at = new Date()` on the session and all its messages. MongoDB TTL index (`SESSION_TTL_SECONDS = 259200`) permanently deletes both after 3 days.
- **Response** (`204 No Content`): Always returns 204 (idempotent; repeated deletes or non-existent IDs return 204).
- **Errors**:
  - `401 Unauthorized`: Missing or invalid JWT.

---

## 4. Frontend and offline behavior (Target specification)

*Note: This section defines the target frontend behavior for `frontend_rag` to be implemented.*

### 4.1 IndexedDB shape

The client will replace single-session storage with a local database named `rag_chat_db` containing:

```ts
interface CachedChatSession {
  session: ChatSession;
  sync_state: 'synced' | 'pending';
  cached_at: string;
}
```

### 4.2 The "10 most recent" cache rule

1. The browser cache stores full session records for at most 10 sessions, ranked by `last_message_at` descending.
2. The active conversation is always retained in cache.
3. If the cache reaches 11 sessions, the least recently active cached session is evicted from IndexedDB.
4. Evicted sessions remain preserved on the backend and can be retrieved when online.

### 4.3 Online and offline state

- **Read-Only Offline**: Users can browse and read cached sessions and messages while offline.
- **Disabled Mutations**: New message sending, rename, and delete actions are disabled in offline mode.
- **Visual Indicator**: The UI displays an "Offline — showing cached history" banner when connectivity is lost.

### 4.4 Session-list actions and PC context menu

1. **Sidebar Navigation**: Replaces the legacy "Clear conversation" button with a vertical session sidebar.
2. **PC Right-Click Context Menu**:
   - Right-clicking a session item opens a context menu with **Rename** and **Delete**.
   - **Rename**: Opens an inline editable input pre-filled with the current title.
   - **Delete**: Displays a confirmation modal ("Delete conversation?"). Upon confirmation, issues `DELETE /api/v1/chat-sessions/:id`.
3. **Post-Delete UX**: If the active session is deleted, the chat interface resets to a clean, empty state ready for lazy creation.

### 4.5 Session list loading and cursor paging

- Renders cached session summaries immediately on mount.
- Requests the first page (`GET /api/v1/chat-sessions`) in the background.
- Employs infinite scroll using `next_cursor` until `has_more` is false.
- Deduplicates items by session `id`.

### 4.6 Reload and session restoration

- Persists the active `selected_session_id` in `localStorage`.
- On application reload:
  - If `selected_session_id` is found and valid, fetches detail via `GET /api/v1/chat-sessions/:id` (or loads from IndexedDB if offline).
  - If the session was deleted or returns `404`, resets to a clean empty conversation.

---

## 5. Lifecycle, concurrency, and consistency rules

### 5.1 Rename

- Renaming updates `title` and `updated_at`.
- Renaming **never** alters `created_at`, `last_message_at`, `message_count`, or `id`.
- The session retains its sort position in the sidebar.

### 5.2 Delete and TTL purging

- Soft deletion marks `deleted_at = new Date()`.
- MongoDB TTL background thread (`expireAfterSeconds: 259200`) purges the tombstoned documents after 72 hours.
- A soft-deleted session cannot be loaded, renamed, or appended to.

### 5.3 Concurrent updates (Last-Write-Wins)

- Updates apply Last-Write-Wins (LWW) semantics.
- Concurrent renames will persist the most recent write to arrive at the MongoDB primary without throwing `409 Conflict`.

### 5.4 Error handling matrix

| Condition | HTTP Status | Response Code | User-Facing Action |
| :--- | :--- | :--- | :--- |
| Missing/expired JWT | `401` | `UNAUTHORIZED` | Redirect to login |
| Title empty or > 120 chars | `400` | `BAD_REQUEST` | Highlight input field with validation message |
| Cursor corrupted/tampered | `400` | `BAD_REQUEST` | Reset cursor pagination to page 1 |
| Session not found / cross-user | `404` | `NOT_FOUND` | Reset active UI to empty conversation |
| Soft-deleted session access | `404` | `NOT_FOUND` | Remove from local cache and sidebar |
| Search injection attempt | `200` | `OK` | Safely escaped regex search returns matched items |

---

## 6. Rejected or risky interpretations

1. **Timestamp as Session ID**: Rejected due to collision risk and coupling identity to presentation. (UUIDv7 adopted).
2. **Embedding all messages in Session document**: Rejected due to MongoDB 16 MB BSON document limit. (Dedicated `chat_messages` collection adopted).
3. **Explicit empty session creation endpoint (`POST /api/v1/chat-sessions`)**: Rejected to prevent abandoned empty conversations. (Lazy creation on first message exchange adopted).
4. **Anonymous `device_id` cookie**: Superseded by JWT `user_id` authentication to support cross-device user accounts and integrate with monolith auth.
5. **Optimistic Locking (`409 Conflict`) for simple renames**: Rejected in favor of Last-Write-Wins (LWW) to eliminate disruptive lock errors on desktop UI.
6. **Client-driven page size**: Rejected to keep MongoDB query complexity and response payloads strictly bounded (`SESSION_PAGE_SIZE = 10`).

---

## 7. Finalized architectural decisions & status

| Decision | Specification | Backend Status | Frontend Status |
| :--- | :--- | :--- | :--- |
| **D-1: Identity** | UUIDv7 opaque identifier | ✅ Implemented & Tested | ⏳ Planned |
| **D-2: Default Title** | `YY-MM-DD:HH-MM-SS` in UTC+07 | ✅ Implemented & Tested | ⏳ Planned |
| **D-3: Pagination** | Cursor-based, fixed 10 items | ✅ Implemented & Tested | ⏳ Planned |
| **D-4: Tenancy & Auth** | JWT Bearer `user_id: ObjectId` | ✅ Implemented & Tested | ⏳ Planned |
| **D-5: Lazy Creation** | Created on first RAG exchange | ✅ Implemented & Tested | ⏳ Planned |
| **D-6: Soft-Delete & TTL** | 3-day tombstone TTL index | ✅ Implemented & Tested | ⏳ Planned |
| **D-7: Message Limit** | Max 200 chronological messages in detail | ✅ Implemented & Tested | ⏳ Planned |
| **D-8: Title Search** | Optional `q` filter with regex escape | ✅ Implemented & Tested | ⏳ Planned |
| **D-9: Offline Cache** | IndexedDB 10 most recent sessions | N/A (Client-only) | ⏳ Planned |
| **D-10: Context Menu** | Desktop right-click Rename/Delete | N/A (Client-only) | ⏳ Planned |

---

## 8. Acceptance criteria and test verification

All backend specification items have been implemented and verified via automated test suites:

- **Specification Test Suite**: [`CHAT_SESSIONS-SPEC-TESTS.md`](CHAT_SESSIONS-SPEC-TESTS.md) covers 34 comprehensive scenarios across 20 test suites in [`chat-sessions.spec.ts`](../src/chat-sessions/chat-sessions.spec.ts).
- **End-to-End Test Suite**: [`test/flow.e2e-spec.ts`](../test/flow.e2e-spec.ts) validates complete registration, login, RAG query lazy session creation, list paging, rename, and soft delete.
- **Verification Results**:
  - `npm --prefix backend_rag test -- chat-sessions.spec.ts`: 20 / 20 test suites passing (34 test cases).
  - `npm --prefix backend_rag run test:e2e`: 6 / 6 end-to-end flows passing.
  - `npm --prefix backend_rag run lint && npm --prefix backend_rag run build`: 0 lint errors, 0 build warnings.
