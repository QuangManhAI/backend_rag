# modules/chat-sessions/repositories — Tầng Repository cho ChatSession, ChatMessage & ChatRequest

- **Motivation/Background**: Tách biệt truy vấn MongoDB (`@InjectModel`) khỏi `ChatSessionsService`, `ChatRequestsService` và `AdminOpsService` để luồng Backend tuân thủ chuẩn `Controller → Service → Repository → Database`.
- **Purpose**: Đóng gói toàn bộ truy vấn UUIDv7 trên `chat_sessions`, `chat_messages` và `chat_requests` kèm bất biến lọc xóa mềm (`deleted_at: null`), quyền sở hữu (`user_id`), `.lean()` và hỗ trợ transaction (`ClientSession`).
- **Overview Pipeline**: `ChatSessionsService` / `ChatRequestsService` / `AdminOpsService` → `ChatSessionsRepository` / `ChatMessagesRepository` / `ChatRequestsRepository` → MongoDB.
- **Detailed Plan**: Mục 1 mô tả phạm vi; Mục 2 liệt kê danh mục file; Mục 3 tóm tắt bất biến và kiểm chứng.
- **References**: [chat-sessions/README.md](../README.md), [chat-sessions/schemas/README.md](../schemas/README.md), [AGENTS.md](../../../../AGENTS.md).
- **Created**: 2026-11-23T09:05:00+07:00
- **Last Updated**: 2026-11-23T09:05:00+07:00

[STATUS: ACTIVE]

---

## 1. Mục đích & Phạm vi

Tầng truy cập dữ liệu cho hội thoại chat (`chat_sessions`, `chat_messages`) và khóa idempotency (`chat_requests`). Toàn bộ bộ nhớ đệm `LRUCache`, `Singleflight` và logic fallback transaction vẫn do tầng Service quản lý.

## 2. Danh mục File & Exports

| File | Lớp / Ký hiệu Chính | Trách nhiệm |
| :--- | :--- | :--- |
| [`chat-sessions.repository.ts`](chat-sessions.repository.ts) | `ChatSessionsRepository`, `LeanChatSession` | Đọc phân trang, kiểm tra sở hữu (`404` trên tầng Service), đổi tên và soft-delete UUIDv7 sessions. |
| [`chat-messages.repository.ts`](chat-messages.repository.ts) | `ChatMessagesRepository`, `LeanChatMessage` | Truy vấn phân trang tin nhắn, tải lịch sử gần nhất, chèn cặp hỏi/đáp trong transaction và soft-delete. |
| [`chat-requests.repository.ts`](chat-requests.repository.ts) | `ChatRequestsRepository` | Đặt khóa idempotency nguyên tử, tiếp quản lock hết hạn và đánh dấu hoàn tất giao dịch. |
| [`index.ts`](index.ts) | Barrel Export | Re-export toàn bộ repository của `chat-sessions`. |

## 3. Bất biến & Kiểm chứng

- Mọi truy vấn đọc/cập nhật session và message đều bắt buộc điều kiện `deleted_at: null`.
- Kiểm chứng: `cd backend_rag && npx jest src/modules/chat-sessions/chat-sessions.spec.ts --runInBand`
