export function normalizeDeliveryState(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ").toUpperCase();
  if (["ABUJA", "ABUJA FCT", "FCT ABUJA", "FEDERAL CAPITAL TERRITORY"].includes(normalized)) {
    return "FCT";
  }
  return normalized;
}

export function normalizeDeliveryCity(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}
