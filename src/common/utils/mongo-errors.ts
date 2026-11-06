/** Duplicate key error of a unique index (E11000). */
export function isDuplicateKey(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 11000;
}

/** Error of a transaction on a standalone server (IllegalOperation, code 20). */
export function isTransactionUnsupported(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown };
  return (
    err?.code === 20 ||
    (typeof err?.message === 'string' &&
      /Transaction numbers are only allowed on a replica set|transactions are not supported/i.test(
        err.message,
      ))
  );
}
