# Hướng dẫn Khởi chạy & Sử dụng API v2 (`backend_rag`)

Tài liệu hướng dẫn nhanh cách khởi chạy ứng dụng, truy cập Swagger UI v2 và gọi thử nghiệm các API chính.

---

## 1. Khởi chạy Ứng dụng

```bash
# Di chuyển vào thư mục backend
cd backend_rag

# Cài đặt dependencies (nếu chưa cài)
npm ci

# Chạy server ở chế độ dev
npm run start:dev
```

Server sẽ khởi động tại: `http://localhost:3000`

---

## 2. Truy cập Tài liệu Swagger UI v2

* **Giao diện trực quan (Swagger UI v2)**:  
  👉 [`http://localhost:3000/api/v2/docs`](http://localhost:3000/api/v2/docs)
* **OpenAPI Specification JSON v2**:  
  👉 [`http://localhost:3000/api/v2/docs-json`](http://localhost:3000/api/v2/docs-json)

*(Lưu ý: Swagger v1 cũ vẫn song song tại `http://localhost:3000/api/v1/docs`)*

---

## 3. Các Lệnh Gọi API v2 Mẫu (cURL)

### 3.1. Kiểm tra Root Discovery & Health
```bash
# Khám phá toàn bộ liên kết HATEOAS v2
curl http://localhost:3000/api/v2

# Kiểm tra trạng thái hệ thống
curl http://localhost:3000/api/v2/health
```

### 3.2. Đăng ký & Đăng nhập (Auth)
```bash
# Đăng ký tài khoản
curl -X POST http://localhost:3000/api/v2/users \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"correct horse battery","display_name":"Developer"}'

# Đăng nhập lấy cặp Access + Refresh Token
curl -X POST http://localhost:3000/api/v2/auth/tokens \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"correct horse battery"}'
```

### 3.3. Hỏi đáp Khoa học (RAG Queries)
```bash
# 1. Hỏi đáp đồng bộ (Sync JSON)
curl -X POST http://localhost:3000/api/v2/rag/queries \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -d '{"query":"How does low-rank adaptation work?","top_k":3}'

# 2. Hỏi đáp dạng Stream (Server-Sent Events)
curl -N -X POST http://localhost:3000/api/v2/rag/queries/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -d '{"query":"How does low-rank adaptation work?","top_k":3}'
```

### 3.4. Quản lý Phiên trò chuyện (Chat Sessions)
```bash
# Tìm kiếm phiên chat theo từ khóa (param 'search')
curl "http://localhost:3000/api/v2/chat-sessions?search=low-rank&limit=10" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"

# Xem chi tiết một phiên chat
curl "http://localhost:3000/api/v2/chat-sessions/<SESSION_ID>" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### 3.5. Cấp lại & Thu hồi Token (OAuth 2.0 RFC 6749 / RFC 7009)
```bash
# Cấp lại token mới (Token Refresh)
curl -X POST http://localhost:3000/api/v2/auth/tokens/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"<REFRESH_TOKEN>"}'

# Thu hồi token / Đăng xuất (Token Revoke)
curl -X POST http://localhost:3000/api/v2/auth/tokens/revoke \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"<REFRESH_TOKEN>"}'
```

---

## 4. Chạy Kiểm thử Tự động (Tests)

```bash
# Chạy bộ test End-to-End chuyên biệt cho API v2
npm run test:e2e test/flow.v2.e2e-spec.ts

# Chạy bộ test E2E kiểm tra tính toàn vẹn của API v1 cũ
npm run test:e2e test/flow.e2e-spec.ts

# Chạy toàn bộ các suite kiểm thử quan trọng (Auth, Admin, Chat Sessions)
npx jest src/modules/auth/auth.spec.ts src/modules/admin/admin.spec.ts src/modules/chat-sessions/chat-sessions.spec.ts --runInBand
```

