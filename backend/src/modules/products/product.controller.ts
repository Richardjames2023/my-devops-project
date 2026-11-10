import type { Request, Response } from "express";
import { z } from "zod";
import {
  createProductSchema,
  productStatusSchema,
  updateProductSchema,
} from "./product.validation";
import { productCatalogQuerySchema } from "./product-catalog.validation";
import {
  createProduct,
  deactivateProduct,
  getAdminProductById,
  getCatalogProductBySlug,
  listAdminProducts,
  listCatalogProducts,
  setProductActive,
  updateProduct,
} from "./product.service";

const productIdParamsSchema = z.object({
  productId: z.uuid("Invalid product ID"),
});

const adminProductListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

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

export async function listAdmin(req: Request, res: Response): Promise<void> {
  const result = adminProductListQuerySchema.safeParse(req.query);
  if (!result.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(result.error).fieldErrors,
    });
    return;
  }

  const catalog = await listAdminProducts(result.data.page, result.data.limit);
  res.status(200).json({
    message: "Admin products retrieved successfully",
    ...catalog,
  });
}

export async function getAdminById(req: Request, res: Response): Promise<void> {
  const params = productIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: "Invalid product ID" });
    return;
  }

  const product = await getAdminProductById(params.data.productId);
  res.status(200).json({
    message: "Product retrieved successfully",
    product,
  });
}

export async function update(req: Request, res: Response): Promise<void> {
  const params = productIdParamsSchema.safeParse(req.params);
  const body = updateProductSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: {
        ...(!params.success ? { productId: ["Invalid product ID"] } : {}),
        ...(body.success ? {} : z.flattenError(body.error).fieldErrors),
      },
    });
    return;
  }

  const product = await updateProduct(params.data.productId, body.data);
  res.status(200).json({
    message: "Product updated successfully",
    product,
  });
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  const params = productIdParamsSchema.safeParse(req.params);
  const body = productStatusSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: {
        ...(!params.success ? { productId: ["Invalid product ID"] } : {}),
        ...(body.success ? {} : z.flattenError(body.error).fieldErrors),
      },
    });
    return;
  }

  const product = await setProductActive(params.data.productId, body.data.isActive);
  res.status(200).json({
    message: body.data.isActive ? "Product activated successfully" : "Product deactivated successfully",
    product,
  });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const params = productIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: "Invalid product ID" });
    return;
  }

  const product = await deactivateProduct(params.data.productId);
  res.status(200).json({
    message: "Product deactivated successfully",
    product,
  });
}
