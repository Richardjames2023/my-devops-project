export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function isSecureProductionEmailUrl(
  nodeEnv: string,
  emailDeliveryEnabled: boolean,
  appBaseUrl: string,
): boolean {
  return nodeEnv !== "production" || !emailDeliveryEnabled || isHttpsUrl(appBaseUrl);
}
