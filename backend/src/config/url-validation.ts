export function isHttpOrHttpsUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidStaffInvitationAcceptanceUrl(
  value: string,
  nodeEnv: string,
): boolean {
  try {
    const url = new URL(value);
    return isHttpOrHttpsUrl(value) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (nodeEnv !== "production" || url.protocol === "https:");
  } catch {
    return false;
  }
}

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
