import "dotenv/config";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPocketBookActions } from "../src/actions.js";
import { loadConfig } from "../src/config.js";

const hasPasswordAuth = Boolean(process.env.POCKETBOOK_PASSWORD && (process.env.POCKETBOOK_LOGIN || process.env.POCKETBOOK_USERNAME));
const hasLiveAuth = process.env.POCKETBOOK_RUN_INTEGRATION === "1" && (Boolean(process.env.POCKETBOOK_ACCESS_TOKEN) || hasPasswordAuth);
const hasLiveMutationAuth = hasLiveAuth && process.env.POCKETBOOK_RUN_MUTATION_INTEGRATION === "1";
const liveIt = hasLiveAuth ? it : it.skip;
const liveMutationIt = hasLiveMutationAuth ? it : it.skip;
const LIVE_TEST_TIMEOUT_MS = 90_000;

describe("PocketBook Cloud live integration", () => {
  liveIt(
    "fetches the authenticated user profile",
    async () => {
      const response = await liveActions().then((actions) => actions.user());

      expect(response).toMatchObject({
        ok: true,
        status: expect.any(Number),
        user: {
          id: expect.anything(),
        },
      });
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  liveIt(
    "fetches the first page of books",
    async () => {
      const response = await liveActions().then((actions) => actions.listBooks({ offset: 0, limit: 10 }));

      expect(response).toMatchObject({
        ok: true,
        status: expect.any(Number),
        library: {
          offset: 0,
          limit: 10,
          count: expect.any(Number),
        },
      });
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  liveIt(
    "fetches book stats",
    async () => {
      const response = await liveActions().then((actions) => actions.booksInfo());

      expect(response).toMatchObject({
        ok: true,
        status: expect.any(Number),
        stats: expect.any(Object),
      });
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  liveMutationIt(
    "uploads and deletes a temporary test book",
    async () => {
      const actions = await liveActions();
      const dir = await mkdtemp(join(tmpdir(), "pocketbook-live-upload-delete-"));
      const remoteName = `codex-pocketbook-integration-${Date.now()}.txt`;
      const filePath = join(dir, remoteName);
      let fastHash: string | undefined;
      let uploadVerified = false;
      let deletionVerified = false;

      try {
        await writeFile(
          filePath,
          [
            "PocketBook Cloud integration test book",
            `Created for upload/delete validation at ${new Date().toISOString()}.`,
            "",
          ].join("\n"),
        );

        const uploadResponse = await actions.uploadFile({ filePath, remoteName, contentType: "text/plain" });
        expect(uploadResponse).toMatchObject({
          ok: true,
          status: expect.any(Number),
        });

        fastHash = fastHashFromUploadResponse(uploadResponse.upload);
        expect(fastHash).toBeTruthy();
        uploadVerified = await waitForBookPresence(actions, fastHash!);

        const deleteResponse = await actions.deleteBook({ fastHash: fastHash! });
        expect(deleteResponse).toMatchObject({
          ok: true,
          status: expect.any(Number),
        });
        deletionVerified = await waitForBookAbsence(actions, fastHash!);
      } finally {
        if (fastHash) {
          await actions.deleteBook({ fastHash }).catch(() => undefined);
        }
        await rm(dir, { recursive: true, force: true });
      }

      expect(uploadVerified).toBe(true);
      expect(deletionVerified).toBe(true);
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});

async function liveActions(): Promise<ReturnType<typeof createPocketBookActions>> {
  return createPocketBookActions(await loadConfig());
}

function fastHashFromUploadResponse(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const value = (body as Record<string, unknown>).fast_hash;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function waitForBookAbsence(
  actions: ReturnType<typeof createPocketBookActions>,
  fastHash: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!(await bookExists(actions, fastHash))) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  return false;
}

async function waitForBookPresence(
  actions: ReturnType<typeof createPocketBookActions>,
  fastHash: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await bookExists(actions, fastHash)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  return false;
}

async function bookExists(actions: ReturnType<typeof createPocketBookActions>, fastHash: string): Promise<boolean> {
  const response = await actions.get(`/api/v1.0/fileops/info/?fast_hash=${encodeURIComponent(fastHash)}`);
  if (response.status === 404) {
    return false;
  }

  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
  return true;
}
