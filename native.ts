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