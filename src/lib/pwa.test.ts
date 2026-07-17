import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import manifest from "../app/manifest";

describe("private PWA policy", () => {
  it("has installable manifest essentials and maskable artwork", () => {
    const value = manifest();
    expect(value).toMatchObject({ name: "Meeting Atlas", short_name: "Atlas", start_url: "/", scope: "/", display: "standalone" });
    expect(value.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("never caches private API or meeting content", async () => {
    const worker = await readFile("public/sw.js", "utf8");
    expect(worker).not.toContain("/api/");
    expect(worker).not.toContain("/meetings/");
    expect(worker).toContain("request.mode === \"navigate\"");
    expect(worker).toContain("/_next/static/");
    expect(worker).toContain("navigationPreload");
  });
});
