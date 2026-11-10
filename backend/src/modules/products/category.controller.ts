import type { Request, Response } from "express";
import { z } from "zod";
import {
  categoryStatusSchema,
  createCategorySchema,
  updateCategorySchema,
} from "./category.validation";
import {
  createCategory,
  deactivateCategory,
  listActiveCategories,
  listAdminCategories,
  setCategoryActive,
  updateCategory,
} from "./category.service";

const categoryIdParamsSchema = z.object({
  categoryId: z.uuid("Invalid category ID"),
});

export async function list(_req: Request, res: Response): Promise<void> {
  const categories = await listActiveCategories();
  res.status(200).json({
    message: "Categories retrieved successfully",
    categories,
  });
}

export async function listAdmin(_req: Request, res: Response): Promise<void> {
  const categories = await listAdminCategories();
  res.status(200).json({
    message: "Admin categories retrieved successfully",
    categories,
  });
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = createCategorySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: z.flattenError(body.error).fieldErrors,
    });
    return;
  }

  const category = await createCategory(body.data);
  res.status(201).json({
    message: "Category created successfully",
    category,
  });
}

export async function update(req: Request, res: Response): Promise<void> {
  const params = categoryIdParamsSchema.safeParse(req.params);
  const body = updateCategorySchema.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: {
        ...(!params.success ? { categoryId: ["Invalid category ID"] } : {}),
        ...(body.success ? {} : z.flattenError(body.error).fieldErrors),
      },
    });
    return;
  }

  const category = await updateCategory(params.data.categoryId, body.data);
  res.status(200).json({
    message: "Category updated successfully",
    category,
  });
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  const params = categoryIdParamsSchema.safeParse(req.params);
  const body = categoryStatusSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: {
        ...(!params.success ? { categoryId: ["Invalid category ID"] } : {}),
        ...(body.success ? {} : z.flattenError(body.error).fieldErrors),
      },
    });
    return;
  }

  const category = await setCategoryActive(params.data.categoryId, body.data.isActive);
  res.status(200).json({
    message: body.data.isActive ? "Category activated successfully" : "Category deactivated successfully",
    category,
  });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const params = categoryIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: "Invalid category ID" });
    return;
  }

  const category = await deactivateCategory(params.data.categoryId);
  res.status(200).json({
    message: "Category deactivated successfully",
    category,
  });
}
