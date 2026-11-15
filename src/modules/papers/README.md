# modules/papers — Phân hệ Tra cứu Chi tiết Bài báo & Chunks (/api/v1/papers)

- **Motivation/Background**: Cung cấp tài liệu đặc tả tự chứa ngay tại `backend_rag/src/modules/papers/` theo yêu cầu chuẩn hóa kiến trúc, giúp người đọc nắm bắt nhanh mục đích thư mục, trách nhiệm từng file và luồng nghiệp vụ mà không phải dò thủ công toàn bộ mã nguồn.
- **Purpose**: Cho phép Frontend tải chi tiết một bài báo (`GET /papers/:paper_id`) hoặc tải lô tối đa `20` bài báo cùng lúc (`GET /papers?ids=...`) khi người dùng hover điểm vector trên cây 3D hoặc bấm vào chip trích dẫn trong câu trả lời.
- **Overview Pipeline**: `PapersController` giới hạn tốc độ tải lô và giải mã `paper_id` URL-encoded -> `PapersService` truy vấn các vector/chunk thuộc bài báo từ Qdrant +... -> Trả về `PaperDetailDto` hoặc `PaperBatchDto`; trả `404 Not Found` nếu bài báo....
- **Detailed Plan**: Mục 1 định nghĩa phạm vi & vai trò; Mục 2 liệt kê cấu trúc thư mục con và danh mục file/export thực tế; Mục 3 mô tả chức năng, luồng nghiệp vụ kèm sơ đồ Mermaid; Mục 4 quy định hợp đồng I/O, bất biến hệ thống và lệnh kiểm chứng.
- **References**: [AGENTS.md](../../../AGENTS.md).
- **Created**: 2026-11-15T12:55:00+07:00
- **Last Updated**: 2026-11-15T12:55:00+07:00

[STATUS: ACTIVE]

---
## 1. Mục đích & Phạm vi Thư mục (Directory Scope & Architectural Role)

Cho phép Frontend tải chi tiết một bài báo (`GET /papers/:paper_id`) hoặc tải lô tối đa `20` bài báo cùng lúc (`GET /papers?ids=...`) khi người dùng hover điểm vector trên cây 3D hoặc bấm vào chip trích dẫn trong câu trả lời.

---

## 2. Đặc tả Kỹ thuật & Danh mục File (Technical Specification)

### 2.1. Danh mục Thư mục con (Subdirectories)

| Thư mục con | Liên kết Đặc tả | Vai trò Chính |
| :--- | :--- | :--- |
| **`dto/`** | [`dto/README.md`](dto/README.md) | Khai báo `ChunkDto`, `PaperDetailDto` và `PaperBatchDto` phản chiếu đúng kiểu `PaperDetail` chia sẻ hợp đồng giữa Backend và Frontend 3D. |

### 2.2. Danh mục File & Ký hiệu Kỹ thuật (File & Symbol Inventory)

| File | Loại / Tầng | Exports / Routes / Ký hiệu Chính | Mô tả Trách nhiệm |
| :--- | :--- | :--- | :--- |
| [`index.ts`](index.ts) | Barrel Export | Re-exports: `./papers.controller`, `./papers.module`, `./papers.service`, `./dto` | Barrel thống nhất điểm import công khai của thư mục |
| [`papers.controller.ts`](papers.controller.ts) | HTTP Controller | @Controller('papers'), @Get('/'), @Get(':paper_id'), `PapersController` | Tiếp nhận HTTP request, kiểm tra guard/DTO và điều phối sang service. |
| [`papers.module.ts`](papers.module.ts) | NestJS Module | `PapersModule` | Module NestJS khai báo imports, providers và exports DI. |
| [`papers.service.ts`](papers.service.ts) | Domain Service | `PAPER_NOT_FOUND`, `PAPER_ID_MAX`, `PAPER_BATCH_MAX`, `orderChunks`, `buildPaperDetail`, `PapersService` | Cài đặt logic nghiệp vụ cốt lõi và tích hợp lưu trữ/engine. |
| [`papers.spec.ts`](papers.spec.ts) | Jest Integration/Unit Spec | - | Bộ kiểm thử tự động xác minh hành vi cho `backend_rag/src/modules/papers`. |

---

## 3. Mô tả Chức năng & Luồng Nghiệp vụ (Business Flow)

1. `PapersController` giới hạn tốc độ tải lô (`@RateLimit('papersBatch')`) và giải mã `paper_id` URL-encoded.
2. `PapersService` truy vấn các vector/chunk thuộc bài báo từ Qdrant + `CorpusService`, sắp xếp lại đoạn văn theo đúng `orderChunks` (`chunk_index`).
3. Trả về `PaperDetailDto` hoặc `PaperBatchDto`; trả `404 Not Found` nếu bài báo không tồn tại.

```mermaid
flowchart LR
    REQ["GET /papers/:id or ?ids=..."] --> CTRL["PapersController (Max 20 ids)"]
    CTRL --> SVC["PapersService"]
    SVC --> QD["VectorStoreService + CorpusService"]
    QD --> ORD["orderChunks -> PaperDetailDto"]
```

---

## 4. Hợp đồng Đầu vào / Đầu ra, Bất biến & Kiểm chứng

- **Đầu vào (Inputs)**: `paper_id` (tối đa 200 ký tự) hoặc chuỗi `?ids=id1,id2,...` (tối đa 20 ID).
- **Đầu ra & Tác động (Outputs / Side Effects)**: `PaperDetailDto` hoặc `PaperBatchDto` kèm mảng `chunks` đã sắp xếp theo thứ tự đọc.

### Bất biến & Quy tắc Kiến trúc (System Invariants)
- Không có endpoint liệt kê toàn bộ papers không lọc (`ids` bắt buộc khi gọi batch); tối đa `PAPER_BATCH_MAX = 20`.

### Lệnh Kiểm chứng (Verification)
```powershell
cd backend_rag && npx jest src/modules/papers/papers.spec.ts --runInBand
```
