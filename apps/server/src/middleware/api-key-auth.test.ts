import { Hono } from "hono";
import { createApiKeyAuth, parseApiKeys } from "./api-key-auth.js";

describe("createApiKeyAuth", () => {
  const validKeys = new Set(["test-key-1", "test-key-2"]);
  const middleware = createApiKeyAuth(validKeys);

  it("allows requests with valid API key", async () => {
    const app = new Hono();
    app.use(middleware);
    app.get("/", (c) => c.text("OK"));

    const res = await app.request("/", {
      headers: { "x-api-key": "test-key-1" },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  it("rejects requests without API key", async () => {
    const app = new Hono();
    app.use(middleware);
    app.get("/", (c) => c.text("OK"));

    const res = await app.request("/");

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBe("API key is required");
  });

  it("rejects requests with invalid API key", async () => {
    const app = new Hono();
    app.use(middleware);
    app.get("/", (c) => c.text("OK"));

    const res = await app.request("/", {
      headers: { "x-api-key": "invalid-key" },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBe("Invalid API key");
  });

  it("allows different valid keys", async () => {
    const app = new Hono();
    app.use(middleware);
    app.get("/", (c) => c.text("OK"));

    const res = await app.request("/", {
      headers: { "x-api-key": "test-key-2" },
    });

    expect(res.status).toBe(200);
  });
});

describe("parseApiKeys", () => {
  it("parses comma-separated keys", () => {
    const keys = parseApiKeys("key1,key2,key3");
    expect(keys).toEqual(new Set(["key1", "key2", "key3"]));
  });

  it("trims whitespace from keys", () => {
    const keys = parseApiKeys(" key1 , key2 , key3 ");
    expect(keys).toEqual(new Set(["key1", "key2", "key3"]));
  });

  it("returns empty set for undefined input", () => {
    const keys = parseApiKeys(undefined);
    expect(keys).toEqual(new Set());
  });

  it("returns empty set for empty string", () => {
    const keys = parseApiKeys("");
    expect(keys).toEqual(new Set());
  });
});
