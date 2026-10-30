import type { Request, Response } from "express";
import { z } from "zod";
import { createProductSchema } from "./product.validation";
import { createProduct } from "./product.service";

export async function create(
  req: Request,
  res: Response,
): Promise<void> {
  const result = createProductSchema.safeParse(
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

  const product = await createProduct(
    result.data,
  );

  res.status(201).json({
    message: "Product created successfully",
    product,
  });
}