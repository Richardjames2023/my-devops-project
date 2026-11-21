
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiRequest,
  getAccessToken,
  setAccessToken,
} from "./client";

describe("API client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    setAccessToken(null);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    setAccessToken(null);
    vi.unstubAllGlobals();
  });

  it("stores and retrieves the in-memory access token", () => {
    setAccessToken("test-access-token");

    expect(getAccessToken()).toBe("test-access-token");
  });

  it("rejects authenticated requests when no access token exists", async () => {
    await expect(
      apiRequest("/customer", { authenticated: true }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds a bearer token to authenticated requests", async () => {
    setAccessToken("test-access-token");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "customer-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiRequest("/customer", { authenticated: true });

    const [, options] = fetchMock.mock.calls[0];
    const headers = new Headers(options?.headers);

    expect(headers.get("Authorization")).toBe(
      "Bearer test-access-token",
    );
  });

  it("does not add authorization to unauthenticated requests", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiRequest("/products");

    const [, options] = fetchMock.mock.calls[0];
    const headers = new Headers(options?.headers);

    expect(headers.has("Authorization")).toBe(false);
  });

  it("uses same-origin credentials by default", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiRequest("/products");

    expect(fetchMock.mock.calls[0][1]?.credentials).toBe("same-origin");
  });

  it("supports cross-origin guest cookie requests", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiRequest("/guest-cart", {
      credentials: "include",
    });

    expect(fetchMock.mock.calls[0][1]?.credentials).toBe("include");
  });

  it("serializes JSON request bodies and sets content type", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const body = { productVariantId: "variant-1", quantity: 2 };

    await apiRequest("/cart/items", {
      method: "POST",
      body,
    });

    const [, options] = fetchMock.mock.calls[0];
    const headers = new Headers(options?.headers);

    expect(headers.get("Content-Type")).toBe("application/json");
    expect(options?.body).toBe(JSON.stringify(body));
  });


  it("sends FormData without JSON serialization or a manual content type", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "image-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const formData = new FormData();
    formData.append("image", new Blob(["image-bytes"]), "image.png");

    await apiRequest("/products/images", {
      method: "POST",
      body: formData,
      headers: { "Content-Type": "application/json" },
    });

    const [, options] = fetchMock.mock.calls[0];
    const headers = new Headers(options?.headers);

    expect(options?.body).toBe(formData);
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("returns parsed JSON responses", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "product-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(apiRequest("/products")).resolves.toEqual({
      id: "product-1",
    });
  });

  it("returns undefined for 204 responses", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiRequest("/cart")).resolves.toBeUndefined();
  });

  it("preserves backend error messages and details", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Invalid checkout request",
          errors: [{ field: "shippingAddress", message: "Required" }],
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    try {
      await apiRequest("/orders", { method: "POST", body: {} });
      throw new Error("Expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        message: "Invalid checkout request",
        status: 400,
        details: [{ field: "shippingAddress", message: "Required" }],
      });
    }
  });

  it("handles non-JSON HTTP error responses", async () => {
    fetchMock.mockResolvedValue(
      new Response("Service unavailable", { status: 503 }),
    );

    await expect(apiRequest("/products")).rejects.toMatchObject({
      name: "ApiError",
      message: "Service unavailable",
      status: 503,
    });
  });

  it("reports malformed JSON on successful responses", async () => {
    fetchMock.mockResolvedValue(
      new Response("{invalid-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(apiRequest("/products")).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      message: "The server returned an invalid JSON response.",
    });
  });

  it("preserves the HTTP status for malformed JSON error responses", async () => {
    fetchMock.mockResolvedValue(
      new Response("{invalid-json", {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(apiRequest("/products")).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
    });
  });

  it("propagates network failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(apiRequest("/products")).rejects.toThrow("Failed to fetch");
  });
});
