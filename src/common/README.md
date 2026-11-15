# src/common — Tầng Hạ tầng Dùng chung Xuyên suốt (Cross-Cutting Concerns)

- **Motivation/Background**: Cung cấp tài liệu đặc tả tự chứa ngay tại `backend_rag/src/common/` theo yêu cầu chuẩn hóa kiến trúc, giúp người đọc nắm bắt nhanh mục đích thư mục, trách nhiệm từng file và luồng nghiệp vụ mà không phải dò thủ công toàn bộ mã nguồn.
- **Purpose**: Cung cấp các khối nền tảng không phụ thuộc nghiệp vụ cụ thể: chuẩn hóa HTTP contract/XML/HATEOAS (`http/`), logging có Request ID (`logging/`), metric Prometheus (`metrics/`), phân trang con trỏ Keyset & lọc an toàn (`pagination/`), bảo mật tiêu đề HTTP/rate-limit/chống ReDoS (`security/`) và tiện ích UUIDv7/Mongo errors (`utils/`).
- **Overview Pipeline**: Middleware gắn `X-Request-Id` ngay khi request vào -> Guard & Throttler kiểm soát rate limit theo endpoint -> ValidationPipe, XML parser, ExceptionFilter và HATEOAS interceptor chuẩn hóa....
- **Detailed Plan**: Mục 1 định nghĩa phạm vi & vai trò; Mục 2 liệt kê cấu trúc thư mục con và danh mục file/export thực tế; Mục 3 mô tả chức năng, luồng nghiệp vụ kèm sơ đồ Mermaid; Mục 4 quy định hợp đồng I/O, bất biến hệ thống và lệnh kiểm chứng.
- **References**: [AGENTS.md](../../AGENTS.md).
- **Created**: 2026-11-15T12:55:00+07:00
- **Last Updated**: 2026-11-15T12:55:00+07:00

[STATUS: ACTIVE]

---
## 1. Mục đích & Phạm vi Thư mục (Directory Scope & Architectural Role)

Cung cấp các khối nền tảng không phụ thuộc nghiệp vụ cụ thể: chuẩn hóa HTTP contract/XML/HATEOAS (`http/`), logging có Request ID (`logging/`), metric Prometheus (`metrics/`), phân trang con trỏ Keyset & lọc an toàn (`pagination/`), bảo mật tiêu đề HTTP/rate-limit/chống ReDoS (`security/`) và tiện ích UUIDv7/Mongo errors (`utils/`).

---

## 2. Đặc tả Kỹ thuật & Danh mục File (Technical Specification)

### 2.1. Danh mục Thư mục con (Subdirectories)

| Thư mục con | Liên kết Đặc tả | Vai trò Chính |
| :--- | :--- | :--- |
| **`http/`** | [`http/README.md`](http/README.md) | Thực thi hợp đồng API tại `docs/api/API_DESIGN.md`: tự động gắn `_links` HATEOAS (`WithLinks`, `LinksInterceptor`), hỗ trợ song song JSON và XML (`ContentNegotiationInterceptor`, `xmlBodyMiddleware`), `ValidationPipe` trả lỗi súc tích và `HttpExceptionFilter` ánh xạ mọi exception thành payload chuẩn. |
| **`logging/`** | [`logging/README.md`](logging/README.md) | Quản lý mã truy vết `X-Request-Id` xuyên suốt một vòng đời bất đồng bộ bằng `AsyncLocalStorage`, tự động ẩn thông tin nhạy cảm (`REDACT_PATHS` như password, token, authorization) khi ghi log JSON 1 dòng. |
| **`metrics/`** | [`metrics/README.md`](metrics/README.md) | Cài đặt `PrometheusMetricsRegistry` tự chứa (không phụ thuộc nặng ngoài) để ghi nhận bộ đếm request, histogram độ trễ các pha RAG (embed, route, search, rerank, llm), số kết nối SSE đang hoạt động và tình trạng hàng đợi. |
| **`pagination/`** | [`pagination/README.md`](pagination/README.md) | Định nghĩa chuẩn `PaginationQueryDto`, `ListQueryDto`, `BatchIdsQueryDto` và các hàm mã hóa/giải mã `cursor` base64url, xây dựng bộ lọc MongoDB `keysetFilter` giúp truy vấn O(log N) ổn định bất kể độ sâu trang, cùng parser biểu thức `sort` và `filter` an toàn. |
| **`security/`** | [`security/README.md`](security/README.md) | Tập trung toàn bộ hàng rào phòng thủ vòng ngoài: cấu hình `securityHeaders` (Helmet), xác định `trustProxySetting` độc lập với `NODE_ENV` (`D-054`), `RATE_LIMITS` cho từng tuyến đường nhạy cảm (`login`, `refresh`, `register`, `chat`) và `escapeRegex` chống ReDoS. |
| **`utils/`** | [`utils/README.md`](utils/README.md) | Cung cấp bộ sinh và kiểm tra định dạng **UUIDv7** (đơn điệu theo thời gian 48-bit ms timestamp + bit ngẫu nhiên) làm khóa chính cho `chat_sessions` và `chat_messages`, cùng bộ nhận diện mã lỗi MongoDB E11000 (`isDuplicateKey`) và môi trường không có Replica Set (`isTransactionUnsupported`). |

### 2.2. Danh mục File & Ký hiệu Kỹ thuật (File & Symbol Inventory)

| File | Loại / Tầng | Exports / Routes / Ký hiệu Chính | Mô tả Trách nhiệm |
| :--- | :--- | :--- | :--- |
| [`index.ts`](index.ts) | Barrel Export | Re-exports: `./http`, `./logging`, `./metrics`, `./pagination`, `./security`, `./utils` | Barrel thống nhất điểm import công khai của thư mục |

---

## 3. Mô tả Chức năng & Luồng Nghiệp vụ (Business Flow)

1. Middleware gắn `X-Request-Id` (`logging/`) ngay khi request vào.
2. Guard & Throttler (`security/`) kiểm soát rate limit theo endpoint.
3. ValidationPipe, XML parser, ExceptionFilter và HATEOAS interceptor (`http/`) chuẩn hóa đầu vào/đầu ra.
4. Service dùng `pagination/` để phân trang keyset và `metrics/` để đếm độ trễ & tải.

```mermaid
flowchart LR
    REQ["Incoming HTTP Request"] --> LOG["logging/ (RequestId + Pino)"]
    LOG --> SEC["security/ (Helmet + Throttler + Sanitize)"]
    SEC --> HTTP["http/ (Validation + XML + Links + ExceptionFilter)"]
    HTTP --> PAG["pagination/ + utils/ + metrics/"]
```

---

## 4. Hợp đồng Đầu vào / Đầu ra, Bất biến & Kiểm chứng

- **Đầu vào (Inputs)**: Mọi HTTP Request/Response đi qua NestJS, tham số truy vấn phân trang/lọc và lỗi runtime.
- **Đầu ra & Tác động (Outputs / Side Effects)**: Response hợp chuẩn OpenAPI JSON/XML, `_links`, status code nhất quán, log JSON 1 dòng và chỉ số `/metrics`.

### Bất biến & Quy tắc Kiến trúc (System Invariants)
- Mọi phân trang danh sách đều dùng ngôn ngữ chung `limit`/`cursor`/`sort`/filter từ `pagination.ts` (`D-047`).
- Regex tìm kiếm từ người dùng phải đi qua `escapeRegex` chống tấn công ReDoS.

### Lệnh Kiểm chứng (Verification)
```powershell
cd backend_rag && npx jest src/common --runInBand
```
