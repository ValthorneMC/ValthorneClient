export interface Env {
  BUCKET: R2Bucket;
  BUCKET_NAME: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  SESSION_SECRET: string;
}

const SESSION_TTL_SECS = 3600;
const URL_TTL_SECS = 900;
const MAX_HASHES_PER_SIGN = 200;
const SHA256_RE = /^[0-9a-f]{64}$/;
const enc = new TextEncoder();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      if (request.method === "GET" && pathname === "/v1/manifest") return await manifest(env);
      if (request.method === "POST" && pathname === "/v1/session") return await session(request, env);
      if (request.method === "POST" && pathname === "/v1/sign") return await sign(request, env);
      return json({ error: "not_found" }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: "internal" }, 500);
    }
  },
};

// Public on purpose: the launcher needs it before login, and it only lists names and hashes.
async function manifest(env: Env): Promise<Response> {
  const object = await env.BUCKET.get("manifests/latest.json");
  if (!object) return json({ error: "no_manifest" }, 404);
  return new Response(object.body, {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function session(request: Request, env: Env): Promise<Response> {
  const token = bearer(request);
  const uuid = token ? await minecraftUuid(token) : null;
  if (!uuid) return json({ error: "unauthorized" }, 401);
  return json({ session: await makeSession(uuid, env.SESSION_SECRET), expires_in: SESSION_TTL_SECS });
}

async function sign(request: Request, env: Env): Promise<Response> {
  const session = request.headers.get("x-session");
  if (!session || !(await verifySession(session, env.SESSION_SECRET))) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = (await request.json().catch(() => null)) as { hashes?: unknown } | null;
  const hashes = body?.hashes;
  if (!Array.isArray(hashes) || hashes.length === 0 || hashes.length > MAX_HASHES_PER_SIGN) {
    return json({ error: "bad_request" }, 400);
  }
  if (!hashes.every((h) => typeof h === "string" && SHA256_RE.test(h))) {
    return json({ error: "bad_request" }, 400);
  }

  const presign = await makePresigner({
    host: `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: env.BUCKET_NAME,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    region: "auto",
    amzDate: new Date().toISOString().replace(/[-:]|.d{3}/g, ""),
    expires: URL_TTL_SECS,
  });
  const urls: Record<string, string> = {};
  for (const hash of hashes as string[]) {
    urls[hash] = await presign(`blobs/${hash.slice(0, 2)}/${hash}`);
  }
  return json({ urls, expires_in: URL_TTL_SECS });
}

async function minecraftUuid(token: string): Promise<string | null> {
  const res = await fetch("https://api.minecraftservices.com/minecraft/profile", {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const profile = (await res.json()) as { id?: string };
  return typeof profile.id === "string" ? profile.id : null;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

async function makeSession(uuid: string, secret: string): Promise<string> {
  const payload = `${uuid}.${Math.floor(Date.now() / 1000) + SESSION_TTL_SECS}`;
  return `${payload}.${hex(await hmac(enc.encode(secret), payload))}`;
}

async function verifySession(session: string, secret: string): Promise<boolean> {
  const parts = session.split(".");
  if (parts.length !== 3) return false;
  const [uuid, exp, sig] = parts;
  if (Number(exp) < Date.now() / 1000) return false;
  const expected = hex(await hmac(enc.encode(secret), `${uuid}.${exp}`));
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export interface PresignParams {
  host: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  amzDate: string; // 20130524T000000Z
  expires: number;
}

// SigV4 presigned GET; the signing key depends only on the day, so it is derived once per request.
export async function makePresigner(p: PresignParams) {
  const day = p.amzDate.slice(0, 8);
  const scope = `${day}/${p.region}/s3/aws4_request`;

  let key = await hmac(enc.encode(`AWS4${p.secretAccessKey}`), day);
  for (const part of [p.region, "s3", "aws4_request"]) key = await hmac(key, part);

  return async (objectKey: string): Promise<string> => {
    const path = p.bucket ? `/${p.bucket}/${objectKey}` : `/${objectKey}`;
    const query = Object.entries({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${p.accessKeyId}/${scope}`,
      "X-Amz-Date": p.amzDate,
      "X-Amz-Expires": String(p.expires),
      "X-Amz-SignedHeaders": "host",
    })
      .sort(([x], [y]) => (x < y ? -1 : 1))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const canonical = `GET
${path}
${query}
host:${p.host}

host
UNSIGNED-PAYLOAD`;
    const toSign = `AWS4-HMAC-SHA256
${p.amzDate}
${scope}
${await sha256Hex(canonical)}`;
    const signature = hex(await hmac(key, toSign));
    return `https://${p.host}${path}?${query}&X-Amz-Signature=${signature}`;
  };
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(data)));
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
