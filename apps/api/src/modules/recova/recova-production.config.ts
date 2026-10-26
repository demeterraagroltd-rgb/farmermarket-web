import { ServiceUnavailableException } from "@nestjs/common";

/** Explicit production settings; never fall back to a staging URL or token. */
export function productionStatus() {
  const issues: string[] = [];
  let destination: string | null = null;
  const raw = process.env.RECOVA_PRODUCTION_BASE_URL?.trim();
  if (!raw) issues.push("Production API base URL is missing.");
  else {
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
        || (url.port && url.port !== "443")
        || !(url.hostname === "recova.ng" || url.hostname.endsWith(".recova.ng"))
        || /(^|[.-])(staging|sandbox|test)([.-]|$)/i.test(url.hostname)) throw new Error();
      destination = url.toString().replace(/\/+$/, "");
    } catch {
      issues.push("Use the confirmed HTTPS production API URL on recova.ng, without credentials, query parameters or fragments. Other provider domains need explicit integration review.");
    }
  }
  const token = process.env.RECOVA_PRODUCTION_API_TOKEN?.trim();
  const tokenConfigured = !!token && !/\s/.test(token);
  if (!tokenConfigured) issues.push("A separate bare production bearer token is missing or invalid.");
  const enabled = process.env.RECOVA_PRODUCTION_ENABLED === "true";
  const institutionCode = process.env.RECOVA_PRODUCTION_INSTITUTION_CODE?.trim();
  if (!institutionCode || !/^[1-9]\d{0,9}$/.test(institutionCode)) issues.push("Production institution code is missing or invalid.");
  if (!enabled) issues.push("Production lookups are disabled (RECOVA_PRODUCTION_ENABLED).");
  return {
    environment: "production" as const, enabled, destination, tokenConfigured,
    institutionCode: institutionCode && /^[1-9]\d{0,9}$/.test(institutionCode) ? institutionCode : null,
    configurationReady: issues.length === 0, connectionVerified: false,
    readOnly: true, liveDebitsEnabled: false, issues,
  };
}

export function productionConnection() {
  const status = productionStatus();
  if (!status.configurationReady || !status.destination) throw new ServiceUnavailableException(status.issues.join(" "));
  return { baseUrl: status.destination, token: process.env.RECOVA_PRODUCTION_API_TOKEN!.trim() };
}
