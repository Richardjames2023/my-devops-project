import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/middleware/authenticate";
import {
  createDeliveryZoneSchema,
  deliveryZoneQuoteQuerySchema,
  updateDeliveryZoneSchema,
} from "./delivery-zone.validation";
import {
  createDeliveryZone,
  listActiveDeliveryZones,
  listDeliveryZones,
  quoteDeliveryFee,
  updateDeliveryZone,
} from "./delivery-zone.service";

function metadata(req: AuthenticatedRequest) {
  return {
    ...(req.ip ? { ipAddress: req.ip } : {}),
    ...(req.get("user-agent") ? { userAgent: req.get("user-agent")! } : {}),
  };
}

function staffActor(req: AuthenticatedRequest, res: Response): string | null {
  if (!req.user || req.user.identityType !== "STAFF") {
    res.status(401).json({ message: "Staff authentication required" });
    return null;
  }
  return req.user.id;
}

export async function listActive(_req: AuthenticatedRequest, res: Response): Promise<void> {
  res.status(200).json({ deliveryZones: await listActiveDeliveryZones() });
}

export async function quote(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = deliveryZoneQuoteQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  const result = await quoteDeliveryFee(parsed.data.state, parsed.data.city);
  res.status(200).json({ quote: result });
}

export async function listAll(_req: AuthenticatedRequest, res: Response): Promise<void> {
  res.status(200).json({ deliveryZones: await listDeliveryZones() });
}

export async function create(req: AuthenticatedRequest, res: Response): Promise<void> {
  const actorId = staffActor(req, res);
  if (!actorId) return;
  const parsed = createDeliveryZoneSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Validation failed", errors: z.flattenError(parsed.error).fieldErrors });
    return;
  }
  const deliveryZone = await createDeliveryZone(actorId, parsed.data, metadata(req));
  res.status(201).json({ message: "Delivery zone created successfully", deliveryZone });
}

export async function update(req: AuthenticatedRequest, res: Response): Promise<void> {
  const actorId = staffActor(req, res);
  if (!actorId) return;
  const params = z.object({ zoneId: z.uuid() }).safeParse(req.params);
  const body = updateDeliveryZoneSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: {
        ...(!params.success ? z.flattenError(params.error).fieldErrors : {}),
        ...(!body.success ? z.flattenError(body.error).fieldErrors : {}),
      },
    });
    return;
  }
  const deliveryZone = await updateDeliveryZone(actorId, params.data.zoneId, body.data, metadata(req));
  res.status(200).json({ message: "Delivery zone updated successfully", deliveryZone });
}
