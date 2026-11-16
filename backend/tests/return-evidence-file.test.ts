import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/common/errors/AppError";
import { streamEvidenceSource } from "../src/modules/return/return-evidence-file.controller";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

function createResponseRecorder() {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let body: Buffer | undefined;

  return {
    headers,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | number) {
      headers.set(name.toLowerCase(), String(value));
      return this;
    },
    end(value?: Buffer) {
      body = value;
      return this;
    },
  };
}

describe("return evidence file streaming", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams private evidence with safe response headers and no-store caching", async () => {
    const bytes = Buffer.from("verified evidence bytes");
    fetchMock.mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { "content-length": String(bytes.length) },
      }),
    );
    const response = createResponseRecorder();

    await streamEvidenceSource(
      { type: "image/jpeg", signedUrl: "https://cloudinary.example/signed" },
      response as never,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cloudinary.example/signed",
      expect.objectContaining({
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
  });

  it("rejects an upstream response that is unsuccessful or has no body", async () => {
    fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));

    await expect(
      streamEvidenceSource(
        { type: "image/jpeg", signedUrl: "https://cloudinary.example/signed" },
        createResponseRecorder() as never,
      ),
    ).rejects.toMatchObject({ message: "Unable to retrieve evidence file", statusCode: 502 });
  });

  it("rejects invalid or oversized declared content lengths before reading the file", async () => {
    for (const contentLength of ["not-a-number", String(MAX_FILE_SIZE + 1)]) {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
      });
      fetchMock.mockResolvedValueOnce(
        new Response(body, {
          status: 200,
          headers: { "content-length": contentLength },
        }),
      );

      await expect(
        streamEvidenceSource(
          { type: "image/jpeg", signedUrl: "https://cloudinary.example/signed" },
          createResponseRecorder() as never,
        ),
      ).rejects.toBeInstanceOf(AppError);
    }
  });

  it("enforces the file size limit while streaming when content length is absent or understated", async () => {
    const oversizedChunk = new Uint8Array(MAX_FILE_SIZE + 1);

    for (const headers of [{}, { "content-length": "1" }]) {
      fetchMock.mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(oversizedChunk);
            },
          }),
          {
            status: 200,
            headers,
          },
        ),
      );

      await expect(
        streamEvidenceSource(
          { type: "video/mp4", signedUrl: "https://cloudinary.example/signed" },
          createResponseRecorder() as never,
        ),
      ).rejects.toMatchObject({
        message: "Evidence file exceeds the allowed size",
        statusCode: 413,
      });
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
