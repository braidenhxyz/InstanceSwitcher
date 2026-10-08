import { ConnectSrc, CspPolicies } from "@main/csp";
import { app, IpcMainInvokeEvent } from "electron";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const FILE = join(app.getPath("userData"), "InstanceSwitcher-csp.json");

const VALID = /^wss?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

const known = new Set<string>();

function apply(origins: string[]): boolean {
    let added = false;
    for (const origin of origins) {
        if (typeof origin !== "string" || !VALID.test(origin)) continue;
        if (!known.has(origin)) added = true;
        known.add(origin);
        (CspPolicies as Record<string, string[]>)[origin] = ConnectSrc;
    }
    return added;
}

try {
    if (existsSync(FILE)) apply(JSON.parse(readFileSync(FILE, "utf8")));
} catch (e) {
    console.error("[InstanceSwitcher] failed to load saved CSP entries", e);
}

export async function fetchScript(_: IpcMainInvokeEvent, url: string) {
    try {
        const u = new URL(url);
        if (u.protocol !== "https:") return { ok: false, error: "only https addresses are allowed" };
        const res = await fetch(u.href, { cache: "no-store", redirect: "follow" });
        if (!res.ok) return { ok: false, error: "server answered " + res.status };
        const text = await res.text();
        if (text.length > 5_000_000) return { ok: false, error: "script is too large" };
        return { ok: true, text };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

export function allowGateways(_: IpcMainInvokeEvent, origins: string[]) {
    const added = apply(origins);
    if (added) {
        try {
            writeFileSync(FILE, JSON.stringify([...known]));
        } catch (e) {
            console.error("[InstanceSwitcher] failed to save CSP entries", e);
        }
    }
    return { added, all: [...known] };
}
