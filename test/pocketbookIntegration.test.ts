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

describe("PocketBook Cloud live integration", () => {
  liveIt("fetches the authenticated user profile", async () => {
    const response = await liveActions().then((actions) => actions.user());

    expect(response).toMatchObject({
      ok: true,
      status: expect.any(Number),
      user: {
        id: expect.anything(),
      },
    });
  });

  liveIt("fetches the first page of books", async () => {
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
  });

  liveIt("fetches book stats", async () => {
    const response = await liveActions().then((actions) => actions.booksInfo());

    expect(response).toMatchObject({
      ok: true,
      status: expect.any(Number),
      stats: expect.any(Object),
    });
  });

  liveMutationIt(
    "uploads and deletes a temporary test book",
    async () => {
      const actions = await liveActions();
      const dir = await mkdtemp(join(tmpdir(), "pocketbook-live-upload-delete-"));
      const remoteName = `codex-pocketbook-integration-${Date.now()}.txt`;
      const filePath = join(dir, remoteName);
      let fastHash: string | undefined;

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

        const deleteResponse = await actions.deleteBook({ fastHash: fastHash! });
        expect(deleteResponse).toMatchObject({
          ok: true,
          status: expect.any(Number),
        });
      } finally {
        if (fastHash) {
          await actions.deleteBook({ fastHash }).catch(() => undefined);
        }
        await rm(dir, { recursive: true, force: true });
      }
    },
    45_000,
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
