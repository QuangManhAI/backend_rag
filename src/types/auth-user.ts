export type Role = 'user' | 'admin';

/** Identity attached to `req.user` by the JWT guards. */
export interface AuthUser {
  id: string;
  roles: Role[];
  /** Snapshot of the account email, used by the audit trail. */
  email?: string;
  /**
   * `users.token_version` the access token was issued with. A mismatch with the stored value means
   * the account's permissions changed and the token must be rejected (prompt_security S3).
   */
  tokenVersion?: number;
}
