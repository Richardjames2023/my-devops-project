
import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { getReturnEvidenceViewUrl } from "./return-evidence-view.service";

export async function viewEvidence(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const paramsResult = z
    .object({
      evidenceId: z.uuid("Invalid evidence ID"),
    })
    .safeParse(req.params);

  if (!paramsResult.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(paramsResult.error).fieldErrors,
    });
    return;
  }

  const evidence = await getReturnEvidenceViewUrl(
    paramsResult.data.evidenceId,
    req.user.id,
    req.user.permissions,
  );

  res.status(200).json({
    message: "Evidence viewing URL generated successfully",
    evidence,
  });
}
