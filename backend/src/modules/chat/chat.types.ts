import type { Request } from "express";

export type ChatOwner =
  | { type: "CUSTOMER"; id: string }
  | { type: "GUEST"; id: string };

export interface ChatOwnerRequest extends Request {
  chatOwner?: ChatOwner;
}
