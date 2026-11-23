# modules/admin/repositories — Tầng Repository Chỉ-Ghi-Thêm cho Audit Trail

- **Motivation/Background**: Tách biệt truy vấn Mongoose (`@InjectModel(AdminAuditLog.name)`) khỏi `AdminAuditService` để phân hệ Admin tuân thủ chuẩn `Controller → Service → Repository → Database`.
- **Purpose**: Đóng gói thao tác ghi nối tiếp (append-only) và đọc phân trang trên collection `admin_audit_logs`.
- **Overview Pipeline**: `AdminAuditService` → `AdminAuditLogsRepository` → MongoDB (`admin_audit_logs`).
- **Detailed Plan**: Mục 1 mô tả bất biến append-only; Mục 2 liệt kê file; Mục 3 hướng dẫn kiểm chứng.
- **References**: [admin/README.md](../README.md), [AGENTS.md](../../../../AGENTS.md).
- **Created**: 2026-11-23T09:05:00+07:00
- **Last Updated**: 2026-11-23T09:05:00+07:00

[STATUS: ACTIVE]

---

## 1. Mục đích & Phạm vi

`AdminAuditLogsRepository` là cổng truy cập duy nhất xuống `admin_audit_logs`. Theo bất biến hệ thống, repository này **không bao giờ** cung cấp hàm `update` hoặc `delete`.

## 2. Danh mục File & Exports

| File | Lớp / Ký hiệu Chính | Trách nhiệm |
| :--- | :--- | :--- |
| [`admin-audit-logs.repository.ts`](admin-audit-logs.repository.ts) | `AdminAuditLogsRepository`, `LeanAdminAuditLog`, `AppendAuditLogRecord` | `append(...)` và `findPageLean(...)` cho nhật ký quản trị. |
| [`index.ts`](index.ts) | Barrel Export | Re-export `AdminAuditLogsRepository`. |

## 3. Kiểm chứng

- `cd backend_rag && npx jest src/modules/admin/admin.spec.ts --runInBand`
