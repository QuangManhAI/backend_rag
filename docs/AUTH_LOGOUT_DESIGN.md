# Thiết kế API: Route & Controller Logout (Monolithic)

## 1. Route & Controller

- **Endpoint:** `POST /api/v1/auth/logout`
- **Controller:** `AuthController.logout()` (`src/auth/auth.controller.ts`)
- **Guard:** `JwtAuthGuard` (yêu cầu Access Token hợp lệ của user)
- **Cơ chế Monolith:**
  - Controller tiếp nhận request và gọi trực tiếp `AuthService.logout(refresh_token, me)`.
  - `TokenService` băm token (`HMAC-SHA256` với secret) và cập nhật trường `revoked_at` trực tiếp trên collection `refresh_tokens` trong MongoDB nội bộ.
  - Không cần gọi RPC/HTTP sang bất kỳ Auth Service rời nào.

---

## 2. Request & Response Payload (JSON)

### 2.1. Request

- **Headers:**
  ```http
  Authorization: Bearer <access_token>
  Content-Type: application/json
  ```
- **Body (JSON):**
  ```json
  {
    "refresh_token": "gAAAAABl..."
  }
  ```

### 2.2. Response

- **Thành công (204):** Empty Body (Không có nội dung trả về).
- **Thất bại (4xx / 5xx):** Trả về định dạng lỗi chuẩn Monolith:
  ```json
  {
    "statusCode": 401,
    "error": "Unauthorized",
    "message": "unauthorized",
    "request_id": "0192e4ab-cdef-7000-8000-123456789abc"
  }
  ```

---

## 3. Mã Status Code & Message trả về

| HTTP Status Code | Message | Điều kiện / Nguyên nhân |
| :--- | :--- | :--- |
| **`204 No Content`** | *(Empty body)* | Thu hồi refresh token thành công, phiên đăng xuất hoàn tất. |
| **`400 Bad Request`** | `"refresh_token must be a string"` hoặc `"refresh token invalid or expired"` | Body thiếu `refresh_token` hoặc không đúng định dạng chuỗi (1–200 ký tự). |
| **`401 Unauthorized`** | `"unauthorized"` hoặc `"token expired"` | Header `Authorization` thiếu, sai định dạng Bearer hoặc Access Token đã hết hạn / không hợp lệ. |
| **`500 Internal Server Error`** | `"internal server error"` | Lỗi kết nối MongoDB hoặc sự cố hệ thống chưa bắt được. |

---

## 4. Log đầu ra (Pino JSON 1 dòng/request)

Hệ thống ghi log dạng JSON chuẩn một dòng cho mỗi request (đã cấu hình ẩn các dữ liệu nhạy cảm như Bearer Token và Refresh Token).

### 4.1. Khi đăng xuất thành công (Status 204)
```json
{
  "level": "info",
  "time": "2026-10-20T15:08:41.123Z",
  "request_id": "0192e4ab-cdef-7000-8000-123456789abc",
  "method": "POST",
  "path": "/api/v1/auth/logout",
  "status": 204,
  "latency_ms": 15,
  "user_id": "6714dbf5e239274291e0a811",
  "msg": "LOGOUT_OK"
}
```

### 4.2. Khi thất bại do chưa xác thực (Status 401)
```json
{
  "level": "warn",
  "time": "2026-10-20T15:09:12.456Z",
  "request_id": "0192e4ab-cdef-7000-8000-987654321def",
  "method": "POST",
  "path": "/api/v1/auth/logout",
  "status": 401,
  "latency_ms": 3,
  "user_id": null,
  "msg": "REQUEST_FAILED"
}
```

> **Lưu ý bảo mật:** Pino Logger đã cấu hình `REDACT_PATHS` (`authorization`, `refresh_token`), đảm bảo tuyệt đối không rò rỉ token trên server log hay console.
