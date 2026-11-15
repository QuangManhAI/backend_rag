# common/metrics — Bộ Thu thập Chỉ số Giám sát Prometheus

- **Motivation/Background**: Cung cấp tài liệu đặc tả tự chứa ngay tại `backend_rag/src/common/metrics/` theo yêu cầu chuẩn hóa kiến trúc, giúp người đọc nắm bắt nhanh mục đích thư mục, trách nhiệm từng file và luồng nghiệp vụ mà không phải dò thủ công toàn bộ mã nguồn.
- **Purpose**: Cài đặt `PrometheusMetricsRegistry` tự chứa (không phụ thuộc nặng ngoài) để ghi nhận bộ đếm request, histogram độ trễ các pha RAG (embed, route, search, rerank, llm), số kết nối SSE đang hoạt động và tình trạng hàng đợi.
- **Overview Pipeline**: Các controller và service gọi phương thức ghi nhận counter / histogram trong... -> Endpoint metric xuất chuỗi text format chuẩn `text/plain; version=0.0.4` cho....
- **Detailed Plan**: Mục 1 định nghĩa phạm vi & vai trò; Mục 2 liệt kê cấu trúc thư mục con và danh mục file/export thực tế; Mục 3 mô tả chức năng, luồng nghiệp vụ kèm sơ đồ Mermaid; Mục 4 quy định hợp đồng I/O, bất biến hệ thống và lệnh kiểm chứng.
- **References**: [AGENTS.md](../../../AGENTS.md).
- **Created**: 2026-11-15T12:55:00+07:00
- **Last Updated**: 2026-11-15T12:55:00+07:00

[STATUS: ACTIVE]

---
## 1. Mục đích & Phạm vi Thư mục (Directory Scope & Architectural Role)

Cài đặt `PrometheusMetricsRegistry` tự chứa (không phụ thuộc nặng ngoài) để ghi nhận bộ đếm request, histogram độ trễ các pha RAG (embed, route, search, rerank, llm), số kết nối SSE đang hoạt động và tình trạng hàng đợi.

---

## 2. Đặc tả Kỹ thuật & Danh mục File (Technical Specification)

### 2.2. Danh mục File & Ký hiệu Kỹ thuật (File & Symbol Inventory)

| File | Loại / Tầng | Exports / Routes / Ký hiệu Chính | Mô tả Trách nhiệm |
| :--- | :--- | :--- | :--- |
| [`index.ts`](index.ts) | Barrel Export | Re-exports: `./prometheus-metrics` | Barrel thống nhất điểm import công khai của thư mục |
| [`prometheus-metrics.spec.ts`](prometheus-metrics.spec.ts) | Jest Integration/Unit Spec | - | Bộ kiểm thử tự động xác minh hành vi cho `backend_rag/src/common/metrics`. |
| [`prometheus-metrics.ts`](prometheus-metrics.ts) | TypeScript Module | `PrometheusMetricsRegistry` | Thành phần `TypeScript Module` thuộc `metrics`. |

---

## 3. Mô tả Chức năng & Luồng Nghiệp vụ (Business Flow)

1. Các controller và service gọi phương thức ghi nhận counter / histogram trong `PrometheusMetricsRegistry`.
2. Endpoint metric (hoặc health/ops) xuất chuỗi text format chuẩn `text/plain; version=0.0.4` cho Prometheus scrape.

```mermaid
flowchart LR
    APP["Controllers & RAG Service"] -->|"observe / inc"| REG["PrometheusMetricsRegistry"]
    REG -->|"Render Prometheus Text"| SCRAPE["GET Metrics Scraper"]
```

---

## 4. Hợp đồng Đầu vào / Đầu ra, Bất biến & Kiểm chứng

- **Đầu vào (Inputs)**: Tên metric, nhãn (labels) và giá trị đo thời gian/số lượng từ runtime.
- **Đầu ra & Tác động (Outputs / Side Effects)**: Báo cáo text chuẩn Prometheus Exposition Format.

### Bất biến & Quy tắc Kiến trúc (System Invariants)
- Số lượng giá trị nhãn (label cardinality) được giữ hữu hạn để không gây tràn bộ nhớ.

### Lệnh Kiểm chứng (Verification)
```powershell
cd backend_rag && npx jest src/common/metrics/prometheus-metrics.spec.ts --runInBand
```
