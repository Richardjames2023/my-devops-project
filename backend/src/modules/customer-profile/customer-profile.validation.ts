import { z } from "zod";

export const updateCustomerProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: z.union([z.string().trim().min(7).max(30), z.null()]).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one profile field must be provided",
});

export const requestAccountDeletionSchema = z.object({
  password: z.string().min(1).max(128),
});

export const cancelAccountDeletionSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
});
