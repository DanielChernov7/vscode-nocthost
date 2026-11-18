import { test } from "node:test";
import assert from "node:assert/strict";
import { NoctHostClient, ApiError, contextValueFor, priceLabel, sshCommand, Server } from "../api";

const base: Server = {
  id: "s1",
  label: "bot",
  status: "ACTIVE",
  provider: "hetzner",
  region: "fsn",
  plan: "vc2-1c-1gb",
  ipv4: "203.0.113.10",
  hourlyPrice: "0.013699",
  accessType: "ssh",
};

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}) {
  return (async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

test("listServers sends the bearer key and drops destroyed servers", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const c = new NoctHostClient("https://api.example/", "nh_test", fakeFetch(200, { servers: [base, { ...base, id: "s2", status: "DESTROYED" }] }, seen));
  const list = await c.listServers();
  assert.equal(list.length, 1);
  assert.equal(seen.url, "https://api.example/servers");
  assert.equal((seen.init!.headers as Record<string, string>).Authorization, "Bearer nh_test");
});

test("401 becomes a readable ApiError", async () => {
  const c = new NoctHostClient("https://api.example", "bad", fakeFetch(401, { error: "Unauthorized" }));
  await assert.rejects(c.billing(), (e: unknown) => e instanceof ApiError && e.status === 401 && /API key/.test(e.message));
});

test("destroy uses DELETE on the server id", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const c = new NoctHostClient("https://api.example", "k", fakeFetch(202, { ok: true }, seen));
  await c.destroy("a/b");
  assert.equal(seen.init!.method, "DELETE");
  assert.equal(seen.url, "https://api.example/servers/a%2Fb");
});

test("context value drives the menus", () => {
  assert.equal(contextValueFor(base), "server-active-ssh");
  assert.equal(contextValueFor({ ...base, status: "STOPPED", accessType: "rdp" }), "server-stopped-rdp");
});

test("price label: hourly and monthly", () => {
  assert.equal(priceLabel(base), "$0.014/h");
  assert.equal(priceLabel({ ...base, billingCycle: "monthly", monthlyPrice: "105" }), "$105.00/mo");
});

test("ssh command rejects anything that is not an IP", () => {
  assert.equal(sshCommand("root", "203.0.113.10"), "ssh root@203.0.113.10");
  assert.equal(sshCommand("bad user;rm", "203.0.113.10"), "ssh root@203.0.113.10");
  assert.throws(() => sshCommand("root", "1.2.3.4; rm -rf /"));
});
