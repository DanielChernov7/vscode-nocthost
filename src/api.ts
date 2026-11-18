// Thin client for the NoctHost REST API (https://nocthost.com/openapi.json).
// No vscode imports here, so it can be unit-tested with node:test.

export type ServerStatus =
  | "PROVISIONING"
  | "ACTIVE"
  | "STOPPED"
  | "SUSPENDED"
  | "ARCHIVED"
  | "DESTROYING"
  | "DESTROYED"
  | "ERROR";

export interface Server {
  id: string;
  label: string;
  status: ServerStatus;
  provider: string;
  region: string;
  plan: string;
  image?: string | null;
  ipv4: string | null;
  hourlyPrice: string;
  accessType?: "ssh" | "rdp";
  billingCycle?: string;
  monthlyPrice?: string;
}

export interface Billing {
  balance: string;
  hourlySpend: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type FetchFn = typeof fetch;

export class NoctHostClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(this.baseUrl.replace(/\/+$/, "") + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        "User-Agent": "nocthost-vscode",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: unknown = undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      throw new ApiError(errorMessage(res.status, data), res.status);
    }
    return data as T;
  }

  async listServers(): Promise<Server[]> {
    const r = await this.request<{ servers?: Server[] }>("GET", "/servers");
    return (r?.servers ?? []).filter((s) => s.status !== "DESTROYED");
  }

  async billing(): Promise<Billing> {
    return this.request<Billing>("GET", "/billing");
  }

  async reboot(id: string): Promise<void> {
    await this.request("POST", `/servers/${encodeURIComponent(id)}/reboot`);
  }

  async stop(id: string): Promise<void> {
    await this.request("POST", `/servers/${encodeURIComponent(id)}/stop`);
  }

  async start(id: string): Promise<void> {
    await this.request("POST", `/servers/${encodeURIComponent(id)}/start`);
  }

  async destroy(id: string): Promise<void> {
    await this.request("DELETE", `/servers/${encodeURIComponent(id)}`);
  }
}

export function errorMessage(status: number, data: unknown): string {
  const d = data as { error?: unknown; message?: unknown } | undefined;
  const raw = typeof d?.message === "string" ? d.message : typeof d?.error === "string" ? d.error : "";
  if (status === 401) return "The API key was rejected. Set a new key from Profile, API keys in the dashboard.";
  if (status === 429) return "Too many requests. Try again in a minute.";
  return raw || `Request failed (HTTP ${status}).`;
}

/** Context value for tree items: drives which menu entries are shown. */
export function contextValueFor(s: Server): string {
  const state =
    s.status === "ACTIVE" ? "active" : s.status === "STOPPED" ? "stopped" : s.status.toLowerCase();
  const access = s.accessType === "rdp" ? "rdp" : "ssh";
  return `server-${state}-${access}`;
}

export function priceLabel(s: Server): string {
  if (s.billingCycle && s.monthlyPrice && Number(s.monthlyPrice) > 0) {
    return `$${Number(s.monthlyPrice).toFixed(2)}/mo`;
  }
  const h = Number(s.hourlyPrice);
  if (!Number.isFinite(h) || h <= 0) return "";
  return `$${h < 0.1 ? h.toFixed(3) : h.toFixed(2)}/h`;
}

export function sshCommand(user: string, ip: string): string {
  const safeUser = /^[a-z_][a-z0-9_-]{0,31}$/i.test(user) ? user : "root";
  if (!/^[0-9a-f:.]+$/i.test(ip)) throw new Error("Invalid IP address");
  return `ssh ${safeUser}@${ip}`;
}
