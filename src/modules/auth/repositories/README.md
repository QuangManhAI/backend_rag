# modules/auth/repositories — Tầng Repository cho Users, Refresh Tokens & Login Attempts

- **Motivation/Background**: Tách biệt hoàn toàn truy vấn Mongoose (`@InjectModel`) khỏi `AuthService`, `TokenService` và `Admin*Service` để luồng xử lý Backend tuân thủ chuẩn `Controller → Service → Repository → Database`.
- **Purpose**: Đóng gói toàn bộ thao tác đọc/ghi MongoDB trên 3 collection `users`, `refresh_tokens` và `login_attempts` kèm các bất biến hiệu năng (`.lean()`, atomic 1-RTT `findOneAndUpdate`).
- **Overview Pipeline**: `AuthService` / `TokenService` / `AdminIdentityService` / `AdminOpsService` → `UsersRepository` / `RefreshTokensRepository` / `LoginAttemptsRepository` → MongoDB.
- **Detailed Plan**: Mục 1 mô tả vai trò; Mục 2 liệt kê danh mục file & exports; Mục 3 trình bày bất biến hiệu năng và kiểm chứng.
- **References**: [auth/README.md](../README.md), [auth/schemas/README.md](../schemas/README.md), [AGENTS.md](../../../../AGENTS.md).
- **Created**: 2026-11-23T09:05:00+07:00
- **Last Updated**: 2026-11-23T09:05:00+07:00

[STATUS: ACTIVE]

---

## 1. Mục đích & Phạm vi

Tầng truy cập dữ liệu duy nhất cho các schema xác thực (`User`, `RefreshToken`, `LoginAttempt`). Không chứa logic nghiệp vụ hay `LRUCache`; chịu trách nhiệm thực thi truy vấn MongoDB tối ưu và trả về lean object.

## 2. Danh mục File & Exports

| File | Lớp / Ký hiệu Chính | Trách nhiệm |
| :--- | :--- | :--- |
| [`users.repository.ts`](users.repository.ts) | `UsersRepository` | CRUD lean & đếm người dùng, cập nhật mật khẩu, vai trò, khóa tài khoản và tăng `token_version`. |
| [`refresh-tokens.repository.ts`](refresh-tokens.repository.ts) | `RefreshTokensRepository`, `LeanRefreshToken` | Xoay vòng refresh token nguyên tử 1-RTT (`consumeActiveByHashLean`), thu hồi token/family. |
| [`login-attempts.repository.ts`](login-attempts.repository.ts) | `LoginAttemptsRepository`, `LeanLoginAttempt` | Đếm, ghi nhận, xóa và phân trang khóa brute-force `login_attempts`. |
| [`index.ts`](index.ts) | Barrel Export | Re-export toàn bộ repository của `auth`. |

## 3. Bất biến & Kiểm chứng

- Mọi truy vấn đọc đều giữ `.lean()`; `consumeActiveByHashLean` sử dụng một lệnh `findOneAndUpdate` nguyên tử để chống race condition.
- Kiểm chứng: `cd backend_rag && npx jest src/modules/auth/auth.spec.ts --runInBand`
