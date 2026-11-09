import { Router } from "express";
import prisma from "../../infrastructure/prisma/client";

const router = Router();

function reportLiveness(_req: express.Request, res: express.Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ status: "UP" });
}

router.get(["/", "/live"], reportLiveness);

router.get("/ready", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");

  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: "READY",
      checks: {
        database: "UP",
      },
    });
  } catch {
    res.status(503).json({
      status: "NOT_READY",
      checks: {
        database: "DOWN",
      },
    });
  }
});

export default router;
