export type NormalizedBook = {
  id: string | number | null;
  title: string | null;
  author: string | null;
  fileName: string | null;
  format: string | null;
  size: number | null;
  progress: number | null;
  favorite: boolean | null;
  raw: Record<string, unknown>;
};

export type NormalizedUser = {
  id: string | number | null;
  email: string | null;
  name: string | null;
  language: string | null;
  raw: Record<string, unknown>;
};

export type NormalizedBooksResult = {
  total: number | null;
  offset: number;
  limit: number;
  count: number;
  books: NormalizedBook[];
  rawContainerKeys: string[];
};

export function normalizeUserPayload(payload: unknown): NormalizedUser {
  const record = unwrapRecord(payload);

  return {
    id: pickId(record, ["user_id", "userId", "id", "uuid"]),
    email: pickString(record, ["email", "login", "username", "user_email"]),
    name: pickString(record, ["name", "full_name", "display_name", "first_name"]),
    language: pickString(record, ["language", "lang", "locale"]),
    raw: record,
  };
}

export function normalizeBooksPayload(payload: unknown, offset: number, limit: number): NormalizedBooksResult {
  const container = unwrapRecord(payload);
  const books = extractArray(payload).map(normalizeBook);
  const total = pickNumber(container, ["total", "count", "total_count", "totalCount", "books_count"]);

  return {
    total,
    offset,
    limit,
    count: books.length,
    books,
    rawContainerKeys: Object.keys(container).sort(),
  };
}

export function normalizeStatsPayload(payload: unknown): Record<string, unknown> {
  return unwrapRecord(payload);
}

export function normalizeUploadPayload(payload: unknown, remoteName: string | undefined): Record<string, unknown> {
  const record = unwrapRecord(payload);
  return {
    remoteName: remoteName ?? null,
    ...record,
  };
}

function normalizeBook(value: unknown): NormalizedBook {
  const record = unwrapRecord(value);
  const author = pickString(record, ["author", "authors", "author_name", "authorName"]);

  return {
    id: pickId(record, ["id", "book_id", "bookId", "uuid", "fast_hash", "hash"]),
    title: pickString(record, ["title", "name", "book_name", "bookName"]),
    author,
    fileName: pickString(record, ["file_name", "fileName", "filename", "path"]),
    format: pickString(record, ["format", "extension", "file_type", "fileType"]),
    size: pickNumber(record, ["size", "file_size", "fileSize"]),
    progress: pickNumber(record, ["progress", "reading_progress", "readingProgress", "percent"]),
    favorite: pickBoolean(record, ["favorite", "is_favorite", "isFavorite"]),
    raw: record,
  };
}

function extractArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = unwrapRecord(payload);
  for (const key of ["books", "items", "data", "result", "results", "files"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function unwrapRecord(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) {
    return {};
  }

  for (const key of ["data", "result", "response", "user"]) {
    const nested = payload[key];
    if (isRecord(nested)) {
      return nested;
    }
  }

  return payload;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  const value = pickValue(record, keys);
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(String).join(", ");
  }
  return value === null ? null : value === undefined ? null : String(value);
}

function pickId(record: Record<string, unknown>, keys: string[]): string | number | null {
  const value = pickValue(record, keys);
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return null;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  const value = pickValue(record, keys);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function pickBoolean(record: Record<string, unknown>, keys: string[]): boolean | null {
  const value = pickValue(record, keys);
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 0 || value === "0" || value === "false") {
    return false;
  }
  if (value === 1 || value === "1" || value === "true") {
    return true;
  }
  return null;
}

function pickValue(record: Record<string, unknown>, keys: string[]): string | number | boolean | unknown[] | null {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key] as string | number | boolean | unknown[];
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
