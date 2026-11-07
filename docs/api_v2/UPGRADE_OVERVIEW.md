# Tổng quan Nâng cấp & Thay đổi API v2 (`backend_rag`)

Bản nâng cấp **`/api/v2`** chuẩn hóa toàn diện giao thức HTTP theo các tiêu chuẩn quốc tế (IETF RFC, OAuth 2.0, RESTful Design Guidelines) mà **không làm thay đổi bất kỳ dòng code nào trong tầng Service và Schema**.

---

## 1. Các Nâng cấp Cốt lõi

| Khía cạnh | API v1 (Cũ) | API v2 (Nâng cấp) | Lợi ích |
| :--- | :--- | :--- | :--- |
| **Kiến trúc Version** | Chỉ có `/api/v1` | Chạy **song song cả `/api/v1` và `/api/v2`** | 100% không ảnh hưởng frontend/client cũ. |
| **Định dạng Lỗi** | Format tự chế (`statusCode, error, message`) | Chuẩn quốc tế **RFC 9457 (Problem Details)** | Xóa bỏ triệt để "200 OK with Error Body", client tự động parse lỗi theo chuẩn IETF. |
| **Tên Route Auth** | `token-rotations`, `token-revocations` | `/auth/tokens/refresh`, `/auth/tokens/revoke` | Chuẩn hóa theo **RFC 6749** & **RFC 7009** (OAuth 2.0). |
| **Tên Route RAG** | `/rag/chat`, `/rag/chat/stream` | `/rag/queries`, `/rag/queries/stream` | Dùng danh từ tài nguyên (`queries`) thay cho động từ (`chat`). |
| **Query Tìm kiếm** | `?q=...` | `?search=...` (hỗ trợ alias `?q=...`) | Rõ nghĩa, tự tài liệu hóa (Self-documenting). |
| **Tài liệu Swagger** | Gộp chung tại `/api/v1/docs` | Tách riêng: **`/api/v2/docs`** (JSON: `/api/v2/docs-json`) | Tài liệu OpenAPI 3.0 chuyên biệt cho từng version. |

---

## 2. Chuẩn hóa Lỗi RFC 9457 (`application/problem+json`)

Khi xảy ra lỗi tại bất kỳ endpoint `/api/v2/*` nào, response trả về có định dạng:

```json
{
  "type": "urn:rag:error:validation-failed",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "Display name is invalid",
  "instance": "/api/v2/users/me",
  "request_id": "0199f0c2-7a3e-7c1d-9a52-3c9d8f1e2b10",
  "timestamp": "2026-11-07T15:40:00.000Z",
  "invalid_params": [
    { "name": "display_name", "reason": "invalid display_name: length must be between 1 and 60" }
  ]
}
```

---

## 3. Bảng Ánh xạ Endpoint v1 ➔ v2

* **Discovery**: `GET /api/v2` (trả về HATEOAS discovery links v2).
* **Health**: `GET /api/v2/health`, `/health/live`, `/health/ready`.
* **Auth**:
  - Đăng nhập: `POST /api/v2/auth/tokens`
  - Cấp lại token: `POST /api/v2/auth/tokens/refresh`
  - Thu hồi token: `POST /api/v2/auth/tokens/revoke`
* **Users**:
  - Đăng ký: `POST /api/v2/users`
  - Profile: `GET /api/v2/users/me` & `PATCH /api/v2/users/me`
  - Đổi mật khẩu: `PUT /api/v2/users/me/password`
* **Chat Sessions**:
  - Danh sách: `GET /api/v2/chat-sessions?search=...` (Cursor pagination: `limit`, `cursor`).
  - Chi tiết & Tin nhắn: `GET /api/v2/chat-sessions/:id`, `GET /api/v2/chat-sessions/:id/messages`.
  - Đổi tên & Xóa: `PATCH /api/v2/chat-sessions/:id`, `DELETE /api/v2/chat-sessions/:id`, `DELETE /api/v2/chat-sessions?ids=...`.
* **Papers**: `GET /api/v2/papers?ids=...`, `GET /api/v2/papers/:paper_id`.
* **RAG Queries**:
  - Đồng bộ: `POST /api/v2/rag/queries` (hỗ trợ alias `/rag/chat`).
  - Streaming SSE: `POST /api/v2/rag/queries/stream` (hỗ trợ alias `/rag/chat/stream`).
* **Admin**: 13 route tại `/api/v2/admin/*` với RBAC 3 lớp và `@AuditContext()`.

