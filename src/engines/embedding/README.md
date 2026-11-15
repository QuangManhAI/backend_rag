# engines/embedding — Engine Nhúng Ngữ nghĩa Nomic v1.5 (768 Chiều)

- **Motivation/Background**: Cung cấp tài liệu đặc tả tự chứa ngay tại `backend_rag/src/engines/embedding/` theo yêu cầu chuẩn hóa kiến trúc, giúp người đọc nắm bắt nhanh mục đích thư mục, trách nhiệm từng file và luồng nghiệp vụ mà không phải dò thủ công toàn bộ mã nguồn.
- **Purpose**: Bao bọc `@huggingface/transformers` tải mô hình `nomic-ai/nomic-embed-text-v1.5` cục bộ khi khởi động module (`OnModuleInit`), tiền xử lý chuỗi câu hỏi với tiền tố `search_query: ` và xuất vector `Float32Array` 768 chiều đã chuẩn hóa.
- **Overview Pipeline**: `OnModuleInit` khởi tạo extractor pipeline từ `EMBEDDING_MODEL`  -> `normalizeQuery(q)` làm sạch khoảng trắng và gắn prefix `search_query: `... -> Sinh vector `EMBEDDING_DIM = 768`; nếu mô hình chưa sẵn sàng thì báo lỗi....
- **Detailed Plan**: Mục 1 định nghĩa phạm vi & vai trò; Mục 2 liệt kê cấu trúc thư mục con và danh mục file/export thực tế; Mục 3 mô tả chức năng, luồng nghiệp vụ kèm sơ đồ Mermaid; Mục 4 quy định hợp đồng I/O, bất biến hệ thống và lệnh kiểm chứng.
- **References**: [tree-router/README.md](../tree-router/README.md), [vector-store/README.md](../vector-store/README.md), [AGENTS.md](../../../AGENTS.md).
- **Created**: 2026-11-15T12:55:00+07:00
- **Last Updated**: 2026-11-15T12:55:00+07:00

[STATUS: ACTIVE]

---
## 1. Mục đích & Phạm vi Thư mục (Directory Scope & Architectural Role)

Bao bọc `@huggingface/transformers` tải mô hình `nomic-ai/nomic-embed-text-v1.5` cục bộ khi khởi động module (`OnModuleInit`), tiền xử lý chuỗi câu hỏi với tiền tố `search_query: ` và xuất vector `Float32Array` 768 chiều đã chuẩn hóa.

---

## 2. Đặc tả Kỹ thuật & Danh mục File (Technical Specification)

### 2.2. Danh mục File & Ký hiệu Kỹ thuật (File & Symbol Inventory)

| File | Loại / Tầng | Exports / Routes / Ký hiệu Chính | Mô tả Trách nhiệm |
| :--- | :--- | :--- | :--- |
| [`embedding.module.ts`](embedding.module.ts) | NestJS Module | `EmbeddingModule` | Module NestJS khai báo imports, providers và exports DI. |
| [`embedding.service.spec.ts`](embedding.service.spec.ts) | Jest Integration/Unit Spec | - | Bộ kiểm thử tự động xác minh hành vi cho `backend_rag/src/engines/embedding`. |
| [`embedding.service.ts`](embedding.service.ts) | Domain Service | `EMBEDDING_DIM`, `QUERY_PREFIX`, `EMBEDDING_UNAVAILABLE`, `EmbeddingPort`, `EMBEDDING_PORT`, `Extractor`, `normalizeQuery` (+1) | What the RAG pipeline needs from an embedder; mocked in tests. |
| [`index.ts`](index.ts) | Barrel Export | Re-exports: `./embedding.module`, `./embedding.service` | Barrel thống nhất điểm import công khai của thư mục |

---

## 3. Mô tả Chức năng & Luồng Nghiệp vụ (Business Flow)

1. `OnModuleInit` khởi tạo extractor pipeline từ `EMBEDDING_MODEL` (có cache cục bộ tránh tải lại).
2. `normalizeQuery(q)` làm sạch khoảng trắng và gắn prefix `search_query: ` chuẩn Nomic v1.5.
3. Sinh vector `EMBEDDING_DIM = 768`; nếu mô hình chưa sẵn sàng thì báo lỗi `EMBEDDING_UNAVAILABLE` cho `/health` và `/rag`.

```mermaid
flowchart LR
    TXT["User Query String"] --> NORM["normalizeQuery (+ search_query: )"]
    NORM --> HF["Transformers.js Nomic v1.5"]
    HF --> VEC["Float32 Vector (768-D)"]
```

---

## 4. Hợp đồng Đầu vào / Đầu ra, Bất biến & Kiểm chứng

- **Đầu vào (Inputs)**: Chuỗi truy vấn hoặc cụm mở rộng từ `MiningService`.
- **Đầu ra & Tác động (Outputs / Side Effects)**: Vector nhúng `number[]` có kích thước cố định 768 chiều.

### Bất biến & Quy tắc Kiến trúc (System Invariants)
- Luôn giữ nguyên tiền tố `search_query: ` khớp với pipeline nhúng tài liệu `search_document: `.

### Lệnh Kiểm chứng (Verification)
```powershell
cd backend_rag && npx jest src/engines/embedding/embedding.service.spec.ts --runInBand
```
