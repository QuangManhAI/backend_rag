/**
 * Canonical author name for exact matching: lowercase, accents removed, "et al." and anything in
 * parentheses dropped, punctuation and whitespace collapsed. "Nguyễn Văn A (UTH)" ➔ "nguyen van a".
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bet\s+al\b\.?/g, ' ')
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lowercase, accent-free word tokens; separators are anything but letters and digits. */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
