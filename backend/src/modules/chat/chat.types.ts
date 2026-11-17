export type ChatOwner =
  | { type: "CUSTOMER"; id: string }
  | { type: "GUEST"; id: string };

export interface ChatOwnerRequest {
  chatOwner?: ChatOwner;
}
