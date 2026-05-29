import { describe, expect, it } from "vitest";
import {
  normalizeBooksPayload,
  normalizeStatsPayload,
  normalizeUploadPayload,
  normalizeUserPayload,
} from "../src/normalizers.js";

describe("normalizers", () => {
  it("normalizes user payloads from direct objects", () => {
    expect(
      normalizeUserPayload({
        user_id: 4070456,
        email: "reader@example.test",
        language: "ru",
      }),
    ).toMatchObject({
      id: 4070456,
      email: "reader@example.test",
      language: "ru",
    });
  });

  it("normalizes user payloads from nested response objects", () => {
    expect(
      normalizeUserPayload({
        data: {
          id: "u1",
          username: "reader@example.test",
          display_name: "Reader",
        },
      }),
    ).toMatchObject({
      id: "u1",
      email: "reader@example.test",
      name: "Reader",
    });
  });

  it("redacts sensitive fields from raw normalized output", () => {
    const user = normalizeUserPayload({
      email: "reader@example.test",
      internal_account: {
        password: "secret",
      },
      download_url: "https://example.test/book.epub?access_token=secret-token&format=epub",
    });

    expect(user.raw).toMatchObject({
      internal_account: {
        password: "[redacted]",
      },
      download_url: "https://example.test/book.epub?access_token=[redacted]&format=epub",
    });
  });

  it("normalizes book arrays from a books container", () => {
    const result = normalizeBooksPayload(
      {
        total: 2,
        books: [
          {
            book_id: 1,
            title: "Aleph",
            authors: ["Jorge Luis Borges"],
            file_size: "123",
            reading_progress: 42,
            is_favorite: 1,
          },
        ],
      },
      0,
      100,
    );

    expect(result).toMatchObject({
      total: 2,
      offset: 0,
      limit: 100,
      count: 1,
    });
    expect(result.books[0]).toMatchObject({
      id: 1,
      title: "Aleph",
      author: "Jorge Luis Borges",
      size: 123,
      progress: 42,
      favorite: true,
    });
  });

  it("normalizes book arrays from direct arrays", () => {
    const result = normalizeBooksPayload([{ id: "hash", name: "Book", extension: "epub" }], 10, 5);

    expect(result).toMatchObject({
      total: null,
      offset: 10,
      limit: 5,
      count: 1,
    });
    expect(result.books[0]).toMatchObject({
      id: "hash",
      title: "Book",
      format: "epub",
    });
  });

  it("preserves stats records", () => {
    expect(normalizeStatsPayload({ read: 2, total: 4 })).toEqual({
      read: 2,
      total: 4,
    });
  });

  it("adds requested upload remote name to upload payload", () => {
    expect(normalizeUploadPayload({ status: "ok" }, "book.epub")).toEqual({
      remoteName: "book.epub",
      status: "ok",
    });
  });
});
