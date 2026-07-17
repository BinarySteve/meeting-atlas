import { NextRequest } from "next/server";
import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeEach, describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

beforeEach(() => { process.env.SESSION_SECRET = "01234567890123456789012345678901"; });

describe("authentication proxy", () => {
  it("matches private pages and redirects missing sessions", async () => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/meetings/private" })).toBe(true);
    const response = await proxy(new NextRequest("http://localhost:6982/meetings/private"));
    expect(getRedirectUrl(response)).toBe("http://localhost:6982/login");
  });

  it("leaves health public", async () => {
    const response = await proxy(new NextRequest("http://localhost:6982/api/health"));
    expect(response.status).toBe(200);
  });
});
