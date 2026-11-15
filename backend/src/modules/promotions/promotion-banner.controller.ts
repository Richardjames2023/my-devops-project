import type { Request, Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import { AppError } from "../../common/errors/AppError";
import { createBannerSchema, listBannersQuerySchema, positionSchema, updateBannerSchema } from "./promotion-banner.validation";
import { createBanner, deleteBanner, deleteDefaultBanner, getBanner, getPublicBanners, listBanners, setDefaultBanner, updateBanner } from "./promotion-banner.service";

function actor(req: AuthenticatedRequest): string {
  if (!req.user || req.user.identityType !== "STAFF") throw new AppError("Staff authentication required", 401);
  return req.user.id;
}
function metadata(req: AuthenticatedRequest) {
  const userAgent = req.get("user-agent");
  return { ...(req.ip ? { ipAddress: req.ip } : {}), ...(userAgent ? { userAgent } : {}) };
}
function uuid(value: unknown, label: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError(`Invalid ${label} ID`, 400);
  return parsed.data;
}

export async function create(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = createBannerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  const banner = await createBanner(parsed.data, req.file, actor(req), metadata(req));
  res.status(201).json({ message: "Promotion banner created successfully", banner });
}
export async function list(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = listBannersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  res.status(200).json({ message: "Promotion banners retrieved successfully", ...await listBanners(parsed.data) });
}
export async function getById(req: AuthenticatedRequest, res: Response): Promise<void> {
  res.status(200).json({ message: "Promotion banner retrieved successfully", banner: await getBanner(uuid(req.params.bannerId, "banner")) });
}
export async function update(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = uuid(req.params.bannerId, "banner");
  const parsed = updateBannerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  const banner = await updateBanner(id, parsed.data, req.file, actor(req), metadata(req));
  res.status(200).json({ message: "Promotion banner updated successfully", banner });
}
export async function remove(req: AuthenticatedRequest, res: Response): Promise<void> {
  const result = await deleteBanner(uuid(req.params.bannerId, "banner"), actor(req), metadata(req));
  res.status(200).json({ message: "Promotion banner deleted successfully", ...result });
}
export async function putDefault(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = z.object({
    position: positionSchema,
    targetUrl: z.string().trim().max(2048).nullable().optional(),
    altText: z.string().trim().max(255).nullable().optional(),
  }).safeParse({ ...req.body, position: req.params.position });
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  const banner = await setDefaultBanner(parsed.data.position, req.file, parsed.data.targetUrl ?? null, parsed.data.altText ?? null, actor(req), metadata(req));
  res.status(200).json({ message: "Default promotion banner saved successfully", banner });
}
export async function removeDefault(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = positionSchema.safeParse(req.params.position);
  if (!parsed.success) throw new AppError("Invalid banner position", 400);
  res.status(200).json({ message: "Default promotion banner deleted successfully", ...await deleteDefaultBanner(parsed.data, actor(req)) });
}
export async function storefront(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ message: "Promotion banners retrieved successfully", banners: await getPublicBanners() });
}
