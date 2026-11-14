import prisma from "../../infrastructure/prisma/client";
import { AppError } from "../../common/errors/AppError";
import { getCloudinary } from "../../config/cloudinary";
import { hashGuestOrderAccessToken } from "../orders/guest-order-access";

const MIME_TO_FORMAT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

const ALLOWED_MIME_TYPES = new Set(Object.keys(MIME_TO_FORMAT));

type EvidenceRecord = {
  id: string;
  returnRequestId: string;
  type: string | null;
  description: string | null;
  publicId: string | null;
  resourceType: string | null;
};

function assertEvidenceStorage(evidence: EvidenceRecord): void {
  if (
    !evidence.publicId ||
    (evidence.resourceType !== "image" && evidence.resourceType !== "video")
  ) {
    throw new AppError("Evidence storage information is unavailable", 500);
  }

  if (!evidence.type || !ALLOWED_MIME_TYPES.has(evidence.type)) {
    throw new AppError("Unsupported evidence file type", 500);
  }
}

async function getAuthorizedEvidence(
  evidenceId: string,
  userId: string,
  permissions: string[],
) {
  const evidence = await prisma.returnEvidence.findUnique({
    where: { id: evidenceId },
    select: {
      id: true,
      returnRequestId: true,
      type: true,
      description: true,
      publicId: true,
      resourceType: true,
      returnRequest: {
        select: { userId: true },
      },
    },
  });

  if (!evidence) {
    throw new AppError("Return evidence not found", 404);
  }

  const isOwner = evidence.returnRequest.userId === userId;
  const canViewReturns = permissions.some((permission) =>
    ["orders.manage", "returns.read", "returns.manage"].includes(permission),
  );

  if (!isOwner && !canViewReturns) {
    throw new AppError("You are not allowed to access this evidence", 403);
  }

  assertEvidenceStorage(evidence);
  return evidence;
}

async function getGuestAuthorizedEvidence(
  evidenceId: string,
  orderId: string,
  guestAccessToken: string,
) {
  const evidence = await prisma.returnEvidence.findFirst({
    where: {
      id: evidenceId,
      returnRequest: {
        is: {
          orderId,
          userId: null,
          order: {
            is: {
              userId: null,
              guestAccessTokenHash: hashGuestOrderAccessToken(guestAccessToken),
              guestAccessTokenExpiresAt: { gt: new Date() },
              guestAccessTokenRevokedAt: null,
            },
          },
        },
      },
    },
    select: {
      id: true,
      returnRequestId: true,
      type: true,
      description: true,
      publicId: true,
      resourceType: true,
      returnRequest: {
        select: { userId: true, orderId: true },
      },
    },
  });

  if (!evidence || evidence.returnRequest.userId !== null) {
    throw new AppError("Return evidence not found", 404);
  }

  assertEvidenceStorage(evidence);
  return evidence;
}

function createSignedCloudinaryUrl(
  publicId: string,
  resourceType: "image" | "video",
  mimeType: string,
): string {
  const cloudinary = getCloudinary();
  const format = MIME_TO_FORMAT[mimeType];

  if (!format) {
    throw new AppError("Unsupported evidence file format", 500);
  }

  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: resourceType,
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 300,
    attachment: false,
  });
}

function toFileSource(evidence: EvidenceRecord) {
  return {
    type: evidence.type!,
    signedUrl: createSignedCloudinaryUrl(
      evidence.publicId!,
      evidence.resourceType as "image" | "video",
      evidence.type!,
    ),
  };
}

export async function getReturnEvidenceViewUrl(
  evidenceId: string,
  userId: string,
  permissions: string[],
) {
  const evidence = await getAuthorizedEvidence(evidenceId, userId, permissions);

  return {
    id: evidence.id,
    returnRequestId: evidence.returnRequestId,
    type: evidence.type,
    description: evidence.description,
    viewUrl: `/api/v1/returns/evidence/${evidence.id}/file`,
  };
}

export async function getReturnEvidenceFileSource(
  evidenceId: string,
  userId: string,
  permissions: string[],
) {
  const evidence = await getAuthorizedEvidence(evidenceId, userId, permissions);
  return toFileSource(evidence);
}

export async function getGuestReturnEvidenceViewUrl(
  evidenceId: string,
  orderId: string,
  guestAccessToken: string,
) {
  const evidence = await getGuestAuthorizedEvidence(
    evidenceId,
    orderId,
    guestAccessToken,
  );

  return {
    id: evidence.id,
    returnRequestId: evidence.returnRequestId,
    type: evidence.type,
    description: evidence.description,
    viewUrl: `/api/v1/returns/guest/${orderId}/evidence/${evidence.id}/file`,
  };
}

export async function getGuestReturnEvidenceFileSource(
  evidenceId: string,
  orderId: string,
  guestAccessToken: string,
) {
  const evidence = await getGuestAuthorizedEvidence(
    evidenceId,
    orderId,
    guestAccessToken,
  );
  return toFileSource(evidence);
}
