import type { Request, Response } from "express";
import { z } from "zod";
import { createProductSchema } from "./product.validation";
import { productCatalogQuerySchema } from "./product-catalog.validation";
import {
  createProduct,
  getCatalogProductBySlug,
  listCatalogProducts,
} from "./product.service";

export async function list(req: Request, res: Response): Promise<void> {
  const result = productCatalogQuerySchema.safeParse(req.query);

  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(result.error).fieldErrors,
    });
    return;
  }

  const catalog = await listCatalogProducts(result.data);
  res.status(200).json({
    message: "Products retrieved successfully",
    ...catalog,
  });
}

export async function getBySlug(req: Request, res: Response): Promise<void> {
  const slugResult = z.string().trim().min(1).safeParse(req.params.slug);

  if (!slugResult.success) {
    res.status(400).json({ message: "Invalid product slug" });
    return;
  }

  const product = await getCatalogProductBySlug(slugResult.data);
  res.status(200).json({
    message: "Product retrieved successfully",
    product,
  });
}

export async function create(req: Request, res: Response): Promise<void> {
  const result = createProductSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(result.error).fieldErrors,
    });
    return;
  }

  const product = await createProduct(result.data);
  res.status(201).json({
    message: "Product created successfully",
    product,
  });
}
