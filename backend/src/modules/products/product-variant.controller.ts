import type { Request, Response } from "express";
import { z } from "zod";
import { createProductVariantSchema } from "./product-variant.validation";
import { createProductVariant } from "./product-variant.service";

export async function create(
  req: Request,
  res: Response,
): Promise<void> {
  const result = createProductVariantSchema.safeParse(
    req.body,
  );

  if (!result.success) {
    const { fieldErrors } = z.flattenError(result.error);

    res.status(400).json({
      message: "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  const variant = await createProductVariant(result.data);

  res.status(201).json({
    message: "Product variant created successfully",
    variant,
  });
}