import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { AppError } from "../src/common/errors/AppError";

const mocks = vi.hoisted(() => ({
  createReturnRequest: vi.fn(),
  listGuestReturnRequests: vi.fn(),
  getGuestReturnRequest: vi.fn(),
  receiveReturnRequest: vi.fn(),
  reviewReturnRequest: vi.fn(),
  inspectReturnRequest: vi.fn(),
  listCustomerReturnRequests: vi.fn(),
  getCustomerReturnRequest: vi.fn(),
  createWarrantyClaim: vi.fn(),
  listGuestWarrantyClaims: vi.fn(),
  getGuestWarrantyClaim: vi.fn(),
  getCustomerWarrantyClaim: vi.fn(),
  listCustomerWarrantyClaims: vi.fn(),
  listWarrantyClaims: vi.fn(),
  reviewWarrantyClaim: vi.fn(),
  createGuestReturnEvidence: vi.fn(),
  assertGuestReturnEvidenceOrderAccess: vi.fn(),
  getGuestReturnEvidenceViewUrl: vi.fn(),
  getGuestReturnEvidenceFileSource: vi.fn(),
  streamEvidenceSource: vi.fn(),
}));

vi.mock("../src/modules/return/return.service", () => ({
  createReturnRequest: mocks.createReturnRequest,
  listGuestReturnRequests: mocks.listGuestReturnRequests,
  getGuestReturnRequest: mocks.getGuestReturnRequest,
  receiveReturnRequest: mocks.receiveReturnRequest,
  reviewReturnRequest: mocks.reviewReturnRequest,
  inspectReturnRequest: mocks.inspectReturnRequest,
  listCustomerReturnRequests: mocks.listCustomerReturnRequests,
  getCustomerReturnRequest: mocks.getCustomerReturnRequest,
}));

vi.mock("../src/modules/return/return-evidence.service", () => ({
  createGuestReturnEvidence: mocks.createGuestReturnEvidence,
  assertGuestReturnEvidenceOrderAccess: mocks.assertGuestReturnEvidenceOrderAccess,
}));

vi.mock("../src/modules/return/return-evidence-view.service", () => ({
  getGuestReturnEvidenceViewUrl: mocks.getGuestReturnEvidenceViewUrl,
  getGuestReturnEvidenceFileSource: mocks.getGuestReturnEvidenceFileSource,
}));

vi.mock("../src/modules/return/return-evidence-file.controller", () => ({
  streamEvidenceFile: vi.fn(),
  streamEvidenceSource: mocks.streamEvidenceSource,
}));

vi.mock("../src/modules/warranty-claims/warranty-claim.service", () => ({
  createWarrantyClaim: mocks.createWarrantyClaim,
  listGuestWarrantyClaims: mocks.listGuestWarrantyClaims,
  getGuestWarrantyClaim: mocks.getGuestWarrantyClaim,
  getCustomerWarrantyClaim: mocks.getCustomerWarrantyClaim,
  listCustomerWarrantyClaims: mocks.listCustomerWarrantyClaims,
  listWarrantyClaims: mocks.listWarrantyClaims,
  reviewWarrantyClaim: mocks.reviewWarrantyClaim,
}));

import app from "../src/app.ts";

const orderId = "9f3e3b6a-10c8-4b7d-8d2f-4a5c6e7f8091";
const orderItemId = "a4e7e6d2-2b5f-4c55-9b30-3c9c4f3b2a11";
const returnRequestId = "b5f8e7d3-3c6a-4d66-8c41-4d0d5e4c3b22";
const claimId = "c6a9f8e4-4d7b-4e77-9d52-5e1e6f5d4c33";
const guestToken = "a".repeat(64);

describe("guest after-sales HTTP endpoints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createReturnRequest.mockResolvedValue({ id: returnRequestId, userId: null });
    mocks.listGuestReturnRequests.mockResolvedValue({ returnRequests: [] });
    mocks.getGuestReturnRequest.mockResolvedValue({ id: returnRequestId });
    mocks.assertGuestReturnEvidenceOrderAccess.mockResolvedValue(undefined);
    mocks.createGuestReturnEvidence.mockResolvedValue([{ id: "d7b0a9f5-5e8c-4a6d-9f31-7a2c5d8e9b10" }]);
    mocks.getGuestReturnEvidenceViewUrl.mockResolvedValue({
      id: "d7b0a9f5-5e8c-4a6d-9f31-7a2c5d8e9b10",
      returnRequestId,
      viewUrl: `/api/v1/returns/guest/${orderId}/evidence/d7b0a9f5-5e8c-4a6d-9f31-7a2c5d8e9b10/file`,
    });
    mocks.getGuestReturnEvidenceFileSource.mockResolvedValue({
      type: "image/jpeg",
      signedUrl: "https://cloudinary.example/private-file",
    });
    mocks.streamEvidenceSource.mockImplementation(async (_source, res) => {
      res.status(200).send("streamed evidence");
    });
    mocks.createWarrantyClaim.mockResolvedValue({ id: claimId, userId: null });
    mocks.listGuestWarrantyClaims.mockResolvedValue({ claims: [] });
    mocks.getGuestWarrantyClaim.mockResolvedValue({ id: claimId });
  });

  it("does not allow guest return history access without the order token", async () => {
    const response = await request(app).get(`/api/v1/returns/guest/${orderId}`);

    expect(response.status).toBe(404);
    expect(mocks.listGuestReturnRequests).not.toHaveBeenCalled();
  });

  it("scopes guest return creation to the order ID in the route", async () => {
    const response = await request(app)
      .post(`/api/v1/returns/guest/${orderId}`)
      .set("X-Guest-Order-Token", guestToken)
      .send({
        reason: "Item arrived damaged",
        items: [{ orderItemId, quantity: 1, condition: "DAMAGED" }],
      });

    expect(response.status).toBe(201);
    expect(mocks.createReturnRequest).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ orderId, reason: "Item arrived damaged" }),
      guestToken,
    );
  });


  it("does not allow guest evidence uploads without the order token", async () => {
    const response = await request(app)
      .post(`/api/v1/returns/guest/${orderId}/${returnRequestId}/evidence`)
      .attach("evidence", Buffer.from("fake-image"), {
        filename: "evidence.jpg",
        contentType: "image/jpeg",
      });

    expect(response.status).toBe(404);
    expect(mocks.createGuestReturnEvidence).not.toHaveBeenCalled();
  });


  it("rejects expired or revoked guest order access before parsing uploads", async () => {
    mocks.assertGuestReturnEvidenceOrderAccess.mockRejectedValue(
      new AppError("Return evidence not found", 404),
    );

    const response = await request(app)
      .post(`/api/v1/returns/guest/${orderId}/${returnRequestId}/evidence`)
      .set("X-Guest-Order-Token", guestToken)
      .attach("evidence", Buffer.from("fake-image"), {
        filename: "evidence.jpg",
        contentType: "image/jpeg",
      });

    expect(response.status).toBe(404);
    expect(mocks.assertGuestReturnEvidenceOrderAccess).toHaveBeenCalledWith(
      orderId,
      guestToken,
    );
    expect(mocks.createGuestReturnEvidence).not.toHaveBeenCalled();
  });

  it("uploads guest evidence using the route order and return IDs", async () => {
    const response = await request(app)
      .post(`/api/v1/returns/guest/${orderId}/${returnRequestId}/evidence`)
      .set("X-Guest-Order-Token", guestToken)
      .attach("evidence", Buffer.from("fake-image"), {
        filename: "evidence.jpg",
        contentType: "image/jpeg",
      });

    expect(response.status).toBe(201);
    expect(mocks.createGuestReturnEvidence).toHaveBeenCalledWith(
      returnRequestId,
      orderId,
      guestToken,
      expect.arrayContaining([
        expect.objectContaining({ originalname: "evidence.jpg" }),
      ]),
    );
  });

  it("does not allow guest evidence viewing with a malformed token", async () => {
    const response = await request(app)
      .get(`/api/v1/returns/guest/${orderId}/evidence/d7b0a9f5-5e8c-4a6d-9f31-7a2c5d8e9b10/view`)
      .set("X-Guest-Order-Token", "invalid");

    expect(response.status).toBe(404);
    expect(mocks.getGuestReturnEvidenceViewUrl).not.toHaveBeenCalled();
  });

  it("scopes guest evidence viewing to the route order and token", async () => {
    const evidenceId = "d7b0a9f5-5e8c-4a6d-9f31-7a2c5d8e9b10";
    const response = await request(app)
      .get(`/api/v1/returns/guest/${orderId}/evidence/${evidenceId}/view`)
      .set("X-Guest-Order-Token", guestToken);

    expect(response.status).toBe(200);
    expect(mocks.getGuestReturnEvidenceViewUrl).toHaveBeenCalledWith(
      evidenceId,
      orderId,
      guestToken,
    );
  });

  it("streams guest evidence through the protected application endpoint", async () => {
    const evidenceId = "d7b0a9f5-5e8c-4a6d-9f31-7a2c5d8e9b10";
    const response = await request(app)
      .get(`/api/v1/returns/guest/${orderId}/evidence/${evidenceId}/file`)
      .set("X-Guest-Order-Token", guestToken);

    expect(response.status).toBe(200);
    expect(response.text).toBe("streamed evidence");
    expect(mocks.getGuestReturnEvidenceFileSource).toHaveBeenCalledWith(
      evidenceId,
      orderId,
      guestToken,
    );
    expect(mocks.streamEvidenceSource).toHaveBeenCalled();
  });

  it("scopes guest warranty claim creation to the token-authorized order", async () => {
    const response = await request(app)
      .post(`/api/v1/warranty-claims/guest/${orderId}`)
      .set("X-Guest-Order-Token", guestToken)
      .send({ orderItemId, quantity: 1, issue: "Device will not power on" });

    expect(response.status).toBe(201);
    expect(mocks.createWarrantyClaim).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ orderItemId, quantity: 1 }),
      guestToken,
      orderId,
    );
  });

  it("does not allow warranty claim history access without the order token", async () => {
    const response = await request(app).get(
      `/api/v1/warranty-claims/guest/${orderId}`,
    );

    expect(response.status).toBe(404);
    expect(mocks.listGuestWarrantyClaims).not.toHaveBeenCalled();
  });
});
