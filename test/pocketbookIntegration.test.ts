import "dotenv/config";
import { describe, expect, it } from "vitest";
import { PocketBookClient } from "../src/pocketbookClient.js";

const hasLiveAuth = Boolean(process.env.POCKETBOOK_ACCESS_TOKEN);
const liveIt = hasLiveAuth ? it : it.skip;

describe("PocketBookClient live integration", () => {
  liveIt("fetches the authenticated user profile", async () => {
    const response = await liveClient().user();

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(response.contentType).toContain("application/json");
  });

  liveIt("fetches the first page of books", async () => {
    const response = await liveClient().books(0, 10);

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(response.contentType).toContain("application/json");
  });

  liveIt("fetches book stats", async () => {
    const response = await liveClient().booksInfo();

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(response.contentType).toContain("application/json");
  });
});

function liveClient(): PocketBookClient {
  return new PocketBookClient({
    baseUrl: process.env.POCKETBOOK_BASE_URL || "https://cloud.pocketbook.digital",
    accessToken: process.env.POCKETBOOK_ACCESS_TOKEN,
    webClientId: process.env.POCKETBOOK_WEB_CLIENT_ID,
    cookieHeader: process.env.POCKETBOOK_COOKIE_HEADER,
  });
}
