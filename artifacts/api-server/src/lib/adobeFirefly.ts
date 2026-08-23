/**
 * Adobe Firefly Services client — Remove Background V2 (the cut-out hero for
 * strip and skyscraper formats). Credentials come from ADOBE_CLIENT_ID /
 * ADOBE_CLIENT_SECRET (OAuth server-to-server); the access token is
 * exchanged on demand and cached until shortly before it expires.
 *
 * The API only accepts images by URL, so callers pass a publicly reachable
 * URL (the app's storage route on the deployed host). Results are polled and
 * downloaded into a Buffer; nothing is stored at Adobe.
 */

const IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";
const IMS_SCOPES = "openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis";
const REMOVE_BG_URL = "https://image.adobe.io/v2/remove-background";
const STATUS_URL = "https://image.adobe.io/v2/status/";

let cachedToken: { token: string; expiresAt: number } | null = null;

export function isAdobeConfigured(): boolean {
  return !!(process.env.ADOBE_CLIENT_ID && process.env.ADOBE_CLIENT_SECRET);
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.ADOBE_CLIENT_ID ?? "",
    client_secret: process.env.ADOBE_CLIENT_SECRET ?? "",
    scope: IMS_SCOPES,
  });
  const res = await fetch(IMS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Adobe IMS token failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  const ttlMs = Math.max(60, (json.expires_in ?? 86400) - 300) * 1000;
  cachedToken = { token: json.access_token, expiresAt: Date.now() + ttlMs };
  return json.access_token;
}

/** Find the first https URL in a status payload (Adobe's succeeded shape
 * nests the output under result/outputs; this stays robust to variants). */
function findOutputUrl(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && /^https:\/\//.test(v) && /(url|href)/i.test(k) && !/status|cancel|self/i.test(k)) {
      return v;
    }
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    const found = findOutputUrl(v, depth + 1);
    if (found) return found;
  }
  return null;
}

export interface RemoveBackgroundResult {
  png: Buffer;
}

/** Cut the subject out of an image (transparent PNG). */
export async function removeBackground(imageUrl: string): Promise<RemoveBackgroundResult> {
  const token = await getAccessToken();
  const apiKey = process.env.ADOBE_CLIENT_ID ?? "";
  const headers = {
    Authorization: `Bearer ${token}`,
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
  const start = await fetch(REMOVE_BG_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      image: { source: { url: imageUrl } },
      mode: "cutout",
      trim: true,
      output: { mediaType: "image/png" },
    }),
  });
  if (!start.ok) {
    throw new Error(`Adobe remove-background failed: ${start.status} ${(await start.text()).slice(0, 300)}`);
  }
  const job = (await start.json()) as { jobId?: string; statusUrl?: string };
  const statusUrl = job.statusUrl ?? (job.jobId ? `${STATUS_URL}${encodeURIComponent(job.jobId)}` : null);
  if (!statusUrl) throw new Error("Adobe remove-background: no job id returned");

  const deadline = Date.now() + 90_000;
  let lastStatus: unknown = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(statusUrl, { headers: { Authorization: headers.Authorization, "x-api-key": apiKey } });
    if (!res.ok) throw new Error(`Adobe status failed: ${res.status}`);
    lastStatus = await res.json();
    const status = String((lastStatus as { status?: string }).status ?? "").toLowerCase();
    if (status === "succeeded") {
      const outputUrl = findOutputUrl(lastStatus);
      if (!outputUrl) throw new Error(`Adobe job succeeded but no output URL found: ${JSON.stringify(lastStatus).slice(0, 300)}`);
      const img = await fetch(outputUrl);
      if (!img.ok) throw new Error(`Adobe output download failed: ${img.status}`);
      return { png: Buffer.from(await img.arrayBuffer()) };
    }
    if (status === "failed" || status === "cancelled") {
      throw new Error(`Adobe remove-background job ${status}: ${JSON.stringify(lastStatus).slice(0, 300)}`);
    }
  }
  throw new Error("Adobe remove-background timed out");
}
