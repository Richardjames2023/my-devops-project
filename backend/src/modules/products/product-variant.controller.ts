import type { Request, Response } from "express";
import { z } from "zod";
import {
  createProductVariantSchema,
  productVariantStatusSchema,
  updateProductVariantSchema,
} from "./product-variant.validation";
import {
  createProductVariant,
  deactivateProductVariant,
  setProductVariantActive,
  updateProductVariant,
} from "./product-variant.service";

const variantIdParamsSchema = z.object({
  variantId: z.uuid("Invalid product variant ID"),
});

export async function create(req: Request, res: Response): Promise<void> {
  const result = createProductVariantSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(result.error).fieldErrors,
    });
    return;
  }

  const variant = await createProductVariant(result.data);
  res.status(201).json({
    message: "Product variant created successfully",
    variant,
  });
}

export async function update(req: Request, res: Response): Promise<void> {
  const params = variantIdParamsSchema.safeParse(req.params);
  const body = updateProductVariantSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: {
        ...(!params.success ? { variantId: ["Invalid product variant ID"] } : {}),
        ...(body.success ? {} : z.flattenError(body.error).fieldErrors),
      },
    });
    return;
  }

  const variant = await updateProductVariant(params.data.variantId, body.data);
  res.status(200).json({
    message: "Product variant updated successfully",
    variant,
  });
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  const params = variantIdParamsSchema.safeParse(req.params);
  const body = productVariantStatusSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: {
        ...(!params.success ? { variantId: ["Invalid product variant ID"] } : {}),
        ...(body.success ? {} : z.flattenError(body.error).fieldErrors),
      },
    });
    return;
  }

  const variant = await setProductVariantActive(params.data.variantId, body.data.isActive);
  res.status(200).json({
    message: body.data.isActive ? "Product variant activated successfully" : "Product variant deactivated successfully",
    variant,
  });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const params = variantIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: "Invalid product variant ID" });
    return;
  }

  const variant = await deactivateProductVariant(params.data.variantId);
  res.status(200).json({
    message: "Product variant deactivated successfully",
    variant,
  });
}
