import type { Request, Response } from "express";
import { listActiveCategories } from "./category.service";

export async function list(_req: Request, res: Response): Promise<void> {
  const categories = await listActiveCategories();
  res.status(200).json({
    message: "Categories retrieved successfully",
    categories,
  });
}
