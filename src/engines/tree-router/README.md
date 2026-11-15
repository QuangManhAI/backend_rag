# engines/tree-router — Bộ Định tuyến Cây Chỉ mục Phân cấp K-Means (World 3D Tree)

- **Motivation/Background**: Cung cấp tài liệu đặc tả tự chứa ngay tại `backend_rag/src/engines/tree-router/` theo yêu cầu chuẩn hóa kiến trúc, giúp người đọc nắm bắt nhanh mục đích thư mục, trách nhiệm từng file và luồng nghiệp vụ mà không phải dò thủ công toàn bộ mã nguồn.
- **Purpose**: Nạp cấu trúc cây phân cấp (`tree.json`, `centroids_l1.json`, `centroids_l2.json`, `categories.json`) từ `WORLD_DATA_DIR`, tính điểm cosine tại từng tầng của cây 3D để chọn tối đa `nprobe` nhánh (`1..6`) hẹp phạm vi tìm kiếm trên Qdrant và trả dữ liệu `route` trực quan hóa quả cầu bay cho Frontend 3D.
- **Overview Pipeline**: `OnModuleInit` đọc các JSON từ `WORLD_DATA_DIR`; nếu thư mục/tệp thiếu thì... -> `route(vec, nprobe, index)` chấm điểm tương đồng giữa vector câu hỏi với... -> Trả về các `RouteStep` kèm tọa độ nút và mảng ID cành/lá mục tiêu cho....
- **Detailed Plan**: Mục 1 định nghĩa phạm vi & vai trò; Mục 2 liệt kê cấu trúc thư mục con và danh mục file/export thực tế; Mục 3 mô tả chức năng, luồng nghiệp vụ kèm sơ đồ Mermaid; Mục 4 quy định hợp đồng I/O, bất biến hệ thống và lệnh kiểm chứng.
- **References**: [embedding/README.md](../embedding/README.md), [vector-store/README.md](../vector-store/README.md), [AGENTS.md](../../../AGENTS.md).
- **Created**: 2026-11-15T12:55:00+07:00
- **Last Updated**: 2026-11-15T12:55:00+07:00

[STATUS: ACTIVE]

---
## 1. Mục đích & Phạm vi Thư mục (Directory Scope & Architectural Role)

Nạp cấu trúc cây phân cấp (`tree.json`, `centroids_l1.json`, `centroids_l2.json`, `categories.json`) từ `WORLD_DATA_DIR`, tính điểm cosine tại từng tầng của cây 3D để chọn tối đa `nprobe` nhánh (`1..6`) hẹp phạm vi tìm kiếm trên Qdrant và trả dữ liệu `route` trực quan hóa quả cầu bay cho Frontend 3D.

---

## 2. Đặc tả Kỹ thuật & Danh mục File (Technical Specification)

### 2.2. Danh mục File & Ký hiệu Kỹ thuật (File & Symbol Inventory)

| File | Loại / Tầng | Exports / Routes / Ký hiệu Chính | Mô tả Trách nhiệm |
| :--- | :--- | :--- | :--- |
| [`index.ts`](index.ts) | Barrel Export | Re-exports: `./tree-router.module`, `./tree-router.service` | Barrel thống nhất điểm import công khai của thư mục |
| [`tree-router.module.ts`](tree-router.module.ts) | NestJS Module | `TreeRouterModule` | Module NestJS khai báo imports, providers và exports DI. |
| [`tree-router.service.spec.ts`](tree-router.service.spec.ts) | Jest Integration/Unit Spec | - | Branches 1, 2, 3 point along axes x, y, z. Twigs 11, 12 under 1; 21, 22 under 2; 31 under 3. |
| [`tree-router.service.ts`](tree-router.service.ts) | Domain Service | `NPROBE_MIN`, `NPROBE_MAX`, `TreeNode`, `Category`, `CentroidMatrix`, `WorldIndex`, `clampNprobe` (+7) | Node of `tree.json` (same file the frontend World 3D draws). |

---

## 3. Mô tả Chức năng & Luồng Nghiệp vụ (Business Flow)

1. `OnModuleInit` đọc các JSON từ `WORLD_DATA_DIR`; nếu thư mục/tệp thiếu thì rơi về chế độ an toàn `steps: []`.
2. `route(vec, nprobe, index)` chấm điểm tương đồng giữa vector câu hỏi với centroid tầng 1 và tầng 2 (`clampNprobe` trong `[1, 6]`).
3. Trả về các `RouteStep` kèm tọa độ nút và mảng ID cành/lá mục tiêu cho `VectorStoreService` lọc truy vấn.

```mermaid
flowchart LR
    VEC["768-D Query Vector"] --> L1["L1 Centroids Cosine Score"]
    L1 -->|"Top Nprobe (1..6)"| L2["L2 Twig Centroids"]
    L2 --> STEPS["RouteStep[] (FE Ball Flight) + Twig IDs"]
```

---

## 4. Hợp đồng Đầu vào / Đầu ra, Bất biến & Kiểm chứng

- **Đầu vào (Inputs)**: Vector 768 chiều, tham số `nprobe` (`1..6`) và thư mục `WORLD_DATA_DIR`.
- **Đầu ra & Tác động (Outputs / Side Effects)**: Lịch trình các bước bay `RouteStep[]` cho hiệu ứng 3D và danh mục/nhánh để lọc tìm kiếm.

### Bất biến & Quy tắc Kiến trúc (System Invariants)
- `nprobe` luôn bị kẹp cứng trong `[NPROBE_MIN=1, NPROBE_MAX=6]`; thiếu tệp world không làm sập ứng dụng.

### Lệnh Kiểm chứng (Verification)
```powershell
cd backend_rag && npx jest src/engines/tree-router/tree-router.service.spec.ts --runInBand
```
