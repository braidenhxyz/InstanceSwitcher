import { addProfileBadge, removeProfileBadge } from "@api/Badges";
import { addMemberListDecorator, removeMemberListDecorator } from "@api/MemberListDecorators";
import { addMessageDecoration, removeMessageDecoration } from "@api/MessageDecorations";
import { definePluginSettings } from "@api/Settings";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { findStoreLazy, wreq } from "@webpack";
import { Button, ChannelStore, FluxDispatcher, GuildStore, MessageStore, React, RestAPI, SelectedChannelStore, TextInput, Toasts, UserStore } from "@webpack/common";

const ReadStateStore = findStoreLazy("ReadStateStore");

type Env = Record<string, string>;
type Store = Record<string, string>;

interface Instance {
    id: string;
    name: string;
    env: Env | null;
    builtin?: boolean;
    token?: string | null;
    store?: Store;
    icon?: string;
    foss?: boolean;
}

interface State {
    instances: Instance[];
    activeId: string;
    pending?: { from: string; wipe?: boolean };
}

interface Overrides {
    api?: string;
    gateway?: string;
    cdn?: string;
}

const FIELDS = [
    { key: "API_ENDPOINT", label: "API", hint: "//my.instance/api" },
    { key: "GATEWAY_ENDPOINT", label: "Gateway", hint: "wss://my.instance/gateway" },
    { key: "CDN_HOST", label: "CDN host", hint: "cdn.my.instance" },
    { key: "MEDIA_PROXY_ENDPOINT", label: "Media proxy", hint: "https://media.my.instance" },
    { key: "INVITE_HOST", label: "Invite host", hint: "my.instance/invite" },
    { key: "GIFT_CODE_HOST", label: "Gift host", hint: "my.instance/gift" },
    { key: "GUILD_TEMPLATE_HOST", label: "Template host", hint: "my.instance/template" },
    { key: "WEBAPP_ENDPOINT", label: "Web app (optional)", hint: "//my.instance" },
    { key: "ASSET_ENDPOINT", label: "Static assets (optional)", hint: "https://my.instance" },
    { key: "REMOTE_AUTH_ENDPOINT", label: "QR login gateway (optional)", hint: "wss://my.instance/remote-auth" }
] as const;

const CORE_FIELDS = FIELDS.slice(0, 4);
const EXTRA_FIELDS = FIELDS.slice(4);

const PRESETS: Record<string, string> = {
    PTB: "ptb.discord.com",
    Canary: "canary.discord.com"
};

const DISCORD: Instance = { id: "discord", name: "Discord", env: null, builtin: true };

const KEY = "InstanceSwitcher:state";
const ACCOUNT_KEY = /token|account|user|email|login|auth|session|multi/i;
const OWN_KEY = /^(vencord|instanceswitcher)/i;

const LS: Storage | null = (() => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
})();

const SS: Storage | null = (() => {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
})();

function load(): State {
    try {
        const s = JSON.parse(LS?.getItem(KEY) ?? "null");
        if (s && Array.isArray(s.instances) && s.instances.length) {
            if (!s.instances.some((i: Instance) => i.builtin)) s.instances.unshift(DISCORD);
            if (!s.instances.some((i: Instance) => i.id === s.activeId)) s.activeId = "discord";
            return s;
        }
    } catch {
        return { instances: [DISCORD], activeId: "discord" };
    }
    return { instances: [DISCORD], activeId: "discord" };
}

let state: State = load();

function commit(next: State) {
    state = next;
    LS?.setItem(KEY, JSON.stringify(next));
}

const active = () => state.instances.find(i => i.id === state.activeId) ?? state.instances[0];

function snapshot(ls: Storage): Store {
    const out: Store = {};
    for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && ACCOUNT_KEY.test(k) && !OWN_KEY.test(k)) {
            const v = ls.getItem(k);
            if (v !== null) out[k] = v;
        }
    }
    return out;
}

function restore(ls: Storage, data: Store) {
    for (const k of Object.keys(snapshot(ls))) ls.removeItem(k);
    for (const [k, v] of Object.entries(data)) ls.setItem(k, v);
}

const legacyStore = (inst?: Instance): Store => (inst?.token ? { token: JSON.stringify(inst.token) } : {});

const EXPORT_KEYS = new Set<string>(FIELDS.map(f => f.key));

function exportInstances(): string {
    const items = state.instances
        .filter(i => !i.builtin)
        .map(i => ({ name: i.name, env: i.env, icon: i.icon, foss: i.foss === true ? true : undefined }));
    return JSON.stringify({ v: 1, instances: items });
}

function importInstances(raw: string): number {
    const data = JSON.parse(raw);
    const items: any[] = Array.isArray(data?.instances) ? data.instances : [];
    const added: Instance[] = [];

    for (const item of items) {
        if (!item || typeof item.name !== "string" || !item.env || typeof item.env !== "object") continue;

        const env: Env = {};
        for (const [k, v] of Object.entries(item.env)) {
            if (EXPORT_KEYS.has(k) && typeof v === "string" && v.length <= 300) env[k] = v;
        }
        if (!env.API_ENDPOINT || !env.GATEWAY_ENDPOINT) continue;

        const duplicate = [...state.instances, ...added].some(
            i => i.env?.API_ENDPOINT === env.API_ENDPOINT && i.env?.GATEWAY_ENDPOINT === env.GATEWAY_ENDPOINT
        );
        if (duplicate) continue;

        const icon = typeof item.icon === "string" && /^https:\/\//.test(item.icon) ? item.icon.slice(0, 300) : undefined;
        added.push({ id: crypto.randomUUID(), name: item.name.slice(0, 60), env, icon, foss: item.foss === true ? true : undefined });
    }

    if (added.length) commit({ ...state, instances: [...state.instances, ...added] });
    return added.length;
}

function moveInstance(id: string, delta: number) {
    const list = [...state.instances];
    const i = list.findIndex(x => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    commit({ ...state, instances: list });
}

function logoutInstance(id: string) {
    if (state.pending) return;
    if (id === state.activeId) {
        commit({ ...state, pending: { from: id, wipe: true } });
        toast("Logging out…");
        reload();
        return;
    }
    commit({
        ...state,
        instances: state.instances.map(i => (i.id === id ? { ...i, store: undefined, token: null } : i))
    });
    toast("Logged out of that instance");
}

function finishSwap() {
    const p = state.pending;
    if (!p || !LS) return;
    try {
        const taken = snapshot(LS);
        const instances = state.instances.map(i => (i.id === p.from ? { ...i, store: p.wipe ? undefined : taken, token: null } : i));
        const target = instances.find(i => i.id === state.activeId);
        restore(LS, target?.store ?? legacyStore(target));
        commit({ instances, activeId: state.activeId });
    } catch (e) {
        console.error("[InstanceSwitcher] account swap failed", e);
        commit({ instances: state.instances, activeId: state.activeId });
    }
}

const log = (...a: any[]) => console.log("[InstanceSwitcher]", ...a);

const toast = (message: string, failure = false) => {
    try {
        Toasts.show({ message, id: Toasts.genId(), type: failure ? Toasts.Type.FAILURE : Toasts.Type.MESSAGE });
    } catch {
        return;
    }
};

const fail = (msg: string, err?: unknown) => {
    console.error("[InstanceSwitcher]", msg, err);
    toast(`${msg}${err ? `: ${String(err)}` : ""}`, true);
};

const withScheme = (v: string, scheme: string) => (/^[a-z]+:\/\//i.test(v) ? v : `${scheme}//${v}`);
const trimSlash = (s: string) => s.replace(/\/+$/, "");

function templateFor(input: string) {
    try {
        const u = new URL(withScheme(input.trim(), "https:"));
        return {
            host: u.host,
            api: `${u.origin}/api`,
            gateway: `wss://${u.host}/gateway`,
            cdn: u.origin
        };
    } catch {
        return null;
    }
}

function deriveEnv(input: string, o: Overrides = {}): { env: Env; host: string } | null {
    const t = templateFor(input);
    if (!t) return null;
    try {
        const api = new URL(withScheme(o.api?.trim() || t.api, "https:"));
        const gateway = trimSlash(withScheme(o.gateway?.trim() || t.gateway, "wss:"));
        const cdn = new URL(withScheme(o.cdn?.trim() || t.cdn, "https:"));
        return {
            host: t.host,
            env: {
                API_ENDPOINT: `//${api.host}${trimSlash(api.pathname)}`,
                GATEWAY_ENDPOINT: gateway,
                CDN_HOST: `${cdn.host}${trimSlash(cdn.pathname)}`,
                MEDIA_PROXY_ENDPOINT: trimSlash(`${cdn.origin}${cdn.pathname}`),
                INVITE_HOST: `${t.host}/invite`,
                GIFT_CODE_HOST: `${t.host}/gift`,
                GUILD_TEMPLATE_HOST: `${t.host}/template`
            }
        };
    } catch {
        return null;
    }
}

function presetEnv(host: string): Env {
    return {
        API_ENDPOINT: `//${host}/api`,
        WEBAPP_ENDPOINT: `//${host}`,
        ASSET_ENDPOINT: `https://${host}`
    };
}

function describe(inst: Instance) {
    const api = inst.env?.API_ENDPOINT;
    if (!api) return "https://discord.com";
    return api.replace(/^\/\//, "https://").replace(/\/api$/, "");
}

const hostOf = (inst: Instance) => describe(inst).replace(/^https?:\/\//, "");

async function ping(inst: Instance): Promise<boolean> {
    const api = inst.env?.API_ENDPOINT ?? "//discord.com/api";
    const base = api.startsWith("//") ? `https:${api}` : api;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    try {
        const r = await fetch(`${base}/v9/gateway`, { signal: ctl.signal });
        return r.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(t);
    }
}

function applyEnv(env: Env | null) {
    if (!env) return;

    const w = window as any;
    if (w.GLOBAL_ENV && typeof w.GLOBAL_ENV === "object") {
        Object.assign(w.GLOBAL_ENV, env);
        return;
    }

    let value: any;
    Object.defineProperty(window, "GLOBAL_ENV", {
        configurable: true,
        enumerable: true,
        get: () => value,
        set: v => {
            value = v && typeof v === "object" ? Object.assign(v, env) : v;
        }
    });
}

type CspApi = {
    isDomainAllowed(url: string, directives: string[]): Promise<boolean> | boolean;
    requestAddOverride(url: string, directives: string[], reason: string): Promise<string>;
};

type NativeApi = {
    allowGateways(origins: string[]): Promise<{ added: boolean; all: string[] }>;
    fetchScript(url: string): Promise<{ ok: boolean; text?: string; error?: string }>;
};

const cspApi = (): CspApi | undefined => (window as any).VencordNative?.csp;
const nativeApi = (): NativeApi | undefined => (window as any).VencordNative?.pluginHelpers?.InstanceSwitcher;

function originOf(v: string | undefined, scheme = "https:"): string | null {
    if (!v) return null;
    try {
        const full = v.startsWith("//") ? scheme + v : /^[a-z]+:\/\//i.test(v) ? v : `${scheme}//${v}`;
        return new URL(full).origin;
    } catch {
        return null;
    }
}

function wssOrigins(env: Env | null | undefined): string[] {
    if (!env) return [];
    return [env.GATEWAY_ENDPOINT, env.REMOTE_AUTH_ENDPOINT]
        .map(v => originOf(v, "wss:"))
        .filter((o): o is string => !!o && o.startsWith("wss:"));
}

function cspNeeds(env: Env): Map<string, string[]> {
    const need = new Map<string, Set<string>>();
    const want = (origin: string | null, ...dirs: string[]) => {
        if (!origin) return;
        const s = need.get(origin) ?? new Set<string>();
        dirs.forEach(d => s.add(d));
        need.set(origin, s);
    };

    want(originOf(env.API_ENDPOINT), "connect-src", "img-src");
    want(originOf(env.CDN_HOST), "connect-src", "img-src");
    want(originOf(env.MEDIA_PROXY_ENDPOINT), "connect-src", "img-src");
    want(originOf(env.ASSET_ENDPOINT), "connect-src", "img-src");

    return new Map([...need].map(([o, d]) => [o, [...d]]));
}

async function ensureCsp(inst: Instance): Promise<boolean> {
    if (!inst.env) return true;

    const api = cspApi();
    if (!api) {
        fail("This Vencord build has no CSP override API (VencordNative.csp)");
        return false;
    }

    for (const [origin, dirs] of cspNeeds(inst.env)) {
        let allowed = false;
        try {
            allowed = !!(await api.isDomainAllowed(origin, dirs));
        } catch {
            allowed = false;
        }
        if (allowed) continue;

        const res = await api.requestAddOverride(origin, dirs, "InstanceSwitcher");
        log("csp override", origin, dirs, "->", res);
        if (res !== "ok") {
            fail(`CSP override for ${origin} was not approved (${res})`);
            return false;
        }
    }

    const gws = wssOrigins(inst.env);
    if (gws.length) {
        try {
            await nativeApi()!.allowGateways(gws);
            log("websocket origins allowed in CSP", gws);
        } catch (e) {
            fail("Couldn't allow the gateway in the CSP (was native.ts built?)", e);
            return false;
        }
    }
    return true;
}

function reload() {
    location.reload();
    setTimeout(() => {
        location.href = location.href;
    }, 1500);
}

async function switchTo(id: string) {
    try {
        if (state.pending) return;
        const cur = active();
        const target = state.instances.find(i => i.id === id);
        log("switch", cur.id, "->", id);
        if (!target || target.id === cur.id) return;
        if (!LS) throw new Error("localStorage is not available");

        if (target.env && !(await ensureCsp(target))) return;

        commit({ ...state, activeId: id, pending: { from: cur.id } });
        toast(`Switching to ${target.name}…`);
        reload();
    } catch (e) {
        fail("Switch failed", e);
    }
}

function emergencyReset() {
    try {
        switchTo("discord");
    } finally {
        if (state.activeId !== "discord") {
            commit({ ...state, activeId: "discord", pending: state.pending ?? { from: state.activeId } });
        }
        setTimeout(reload, 300);
    }
}

const C = {
    text: "var(--text-default, var(--text-normal, #dbdee1))",
    header: "var(--header-primary, #f2f3f5)",
    muted: "var(--text-muted, #949ba4)",
    row: "var(--background-base-lower, var(--background-secondary, #1e1f22))",
    brand: "var(--brand-500, #5865f2)",
    border: "var(--border-subtle, rgba(255,255,255,0.06))",
    green: "#23a55a",
    red: "#f23f43"
};

const sectionLabel: React.CSSProperties = {
    marginTop: 14,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: C.muted
};

function Disclosure({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void; }) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onToggle}
            onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onToggle();
                }
            }}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "fit-content",
                cursor: "pointer",
                userSelect: "none",
                fontSize: 12,
                fontWeight: 600,
                color: C.muted
            }}
        >
            <span style={{ display: "inline-block", transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "none" }}>
                ▸
            </span>
            {label}
        </div>
    );
}

const arrowStyle: React.CSSProperties = {
    cursor: "pointer",
    fontSize: 8,
    lineHeight: "11px",
    padding: "0 4px",
    color: C.muted,
    userSelect: "none"
};

function InstanceIcon({ inst }: { inst: Instance; }) {
    const src = inst.icon || (inst.env ? `${describe(inst)}/favicon.ico` : "");
    const [failed, setFailed] = React.useState(false);

    if (!src || failed) {
        return (
            <span
                style={{
                    flexShrink: 0,
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#fff",
                    background: C.brand
                }}
            >
                {inst.name.slice(0, 1).toUpperCase()}
            </span>
        );
    }

    return (
        <img
            src={src}
            width={24}
            height={24}
            alt=""
            style={{ flexShrink: 0, borderRadius: 6, objectFit: "cover" }}
            onError={() => setFailed(true)}
        />
    );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; }) {
    return (
        <div
            role="switch"
            aria-checked={checked}
            tabIndex={0}
            onClick={() => onChange(!checked)}
            onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onChange(!checked);
                }
            }}
            style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}
        >
            <span
                style={{
                    position: "relative",
                    flexShrink: 0,
                    width: 36,
                    height: 20,
                    borderRadius: 10,
                    background: checked ? C.green : "var(--background-modifier-accent, #4e5058)",
                    transition: "background 0.15s"
                }}
            >
                <span
                    style={{
                        position: "absolute",
                        top: 2,
                        left: checked ? 18 : 2,
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: "#fff",
                        transition: "left 0.15s"
                    }}
                />
            </span>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.header }}>{label}</span>
                {hint && <span style={{ fontSize: 12, color: C.muted }}>{hint}</span>}
            </span>
        </div>
    );
}

function Switcher({ onClose }: { onClose: () => void; }) {
    const [, bump] = React.useState(0);
    const refresh = () => bump(n => n + 1);
    const [online, setOnline] = React.useState<Record<string, boolean>>({});
    const [draft, setDraft] = React.useState<Instance | null>(null);
    const [url, setUrl] = React.useState("");
    const [name, setName] = React.useState("");
    const [ov, setOv] = React.useState<Overrides>({});
    const [advanced, setAdvanced] = React.useState(false);
    const [moreEdit, setMoreEdit] = React.useState(false);
    const [confirmLogout, setConfirmLogout] = React.useState<string | null>(null);
    const [ioOpen, setIoOpen] = React.useState(false);
    const [importText, setImportText] = React.useState("");
    const [addFoss, setAddFoss] = React.useState(false);

    const check = (inst: Instance) => {
        ping(inst).then(ok => setOnline(o => ({ ...o, [inst.id]: ok })));
    };

    React.useEffect(() => {
        state.instances.forEach(check);
    }, []);

    const cur = active();

    function add(env: Env, label: string, foss = false) {
        try {
            log("add", label, env);
            const inst: Instance = { id: crypto.randomUUID(), name: label, env, foss: foss || undefined };
            commit({ ...state, instances: [...state.instances, inst] });
            check(inst);
            refresh();
        } catch (e) {
            fail("Add failed", e);
        }
    }

    function addFromUrl() {
        const d = deriveEnv(url, ov);
        if (!d) return toast("That doesn't look like a valid URL", true);
        add(d.env, name.trim() || d.host, addFoss);
        setUrl("");
        setName("");
        setOv({});
        setAddFoss(false);
    }

    async function saveDraft() {
        if (!draft) return;
        const env: Env = {};
        for (const [k, v] of Object.entries(draft.env ?? {})) if (v.trim()) env[k] = v.trim();
        if (!(await ensureCsp({ ...draft, env }))) return;
        commit({ ...state, instances: state.instances.map(i => (i.id === draft.id ? { ...draft, env, icon: draft.icon?.trim() || undefined } : i)) });
        const wasActive = draft.id === cur.id;
        setDraft(null);
        if (wasActive) reload();
        else refresh();
    }

    function copyExport() {
        navigator.clipboard.writeText(exportInstances()).then(
            () => toast("Instance list copied. Logins are not included."),
            e => fail("Couldn't copy", e)
        );
    }

    function runImport() {
        try {
            const n = importInstances(importText);
            toast(n ? `Imported ${n} instance${n === 1 ? "" : "s"}` : "Nothing new to import", !n);
            if (n) {
                setImportText("");
                refresh();
                state.instances.forEach(check);
            }
        } catch {
            toast("That isn't a valid export", true);
        }
    }

    const tpl = templateFor(url);

    return (
        <div data-instance-switcher-ui="1" style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 18, color: C.text }}>
            {state.instances.map(inst => {
                const isCur = inst.id === cur.id;
                const status = online[inst.id];
                return (
                    <div
                        key={inst.id}
                        style={{
                            padding: "12px 14px",
                            borderRadius: 10,
                            background: isCur ? `color-mix(in srgb, ${C.brand} 12%, ${C.row})` : C.row,
                            border: `1px solid ${isCur ? C.brand : C.border}`
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
                                <span
                                    role="button"
                                    title="Move up"
                                    style={arrowStyle}
                                    onClick={() => {
                                        moveInstance(inst.id, -1);
                                        refresh();
                                    }}
                                >
                                    ▲
                                </span>
                                <span
                                    role="button"
                                    title="Move down"
                                    style={arrowStyle}
                                    onClick={() => {
                                        moveInstance(inst.id, 1);
                                        refresh();
                                    }}
                                >
                                    ▼
                                </span>
                            </div>
                            <span
                                title={status === undefined ? "Checking…" : status ? "Reachable" : "Unreachable"}
                                style={{
                                    flexShrink: 0,
                                    width: 9,
                                    height: 9,
                                    borderRadius: "50%",
                                    background: status === undefined ? C.muted : status ? C.green : C.red,
                                    boxShadow: status ? `0 0 6px ${C.green}` : "none"
                                }}
                            />
                            <InstanceIcon key={`${inst.id}:${inst.icon ?? ""}`} inst={inst} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: C.header }}>
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {inst.name}
                                    </span>
                                    {isCur && (
                                        <span
                                            style={{
                                                fontSize: 10,
                                                fontWeight: 700,
                                                padding: "2px 7px",
                                                borderRadius: 999,
                                                background: C.brand,
                                                color: "#fff"
                                            }}
                                        >
                                            Connected
                                        </span>
                                    )}
                                    {inst.foss && (
                                        <span
                                            title="FossCORD/MeowCORD server: end-to-end encrypted DMs"
                                            style={{
                                                fontSize: 10,
                                                fontWeight: 700,
                                                padding: "2px 7px",
                                                borderRadius: 999,
                                                background: C.green,
                                                color: "#fff"
                                            }}
                                        >
                                            E2EE
                                        </span>
                                    )}
                                </div>
                                <div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {describe(inst)}
                                </div>
                            </div>

                            {!isCur && (
                                <Button size={Button.Sizes.SMALL} onClick={() => switchTo(inst.id)}>
                                    Connect
                                </Button>
                            )}
                            {!inst.builtin && (
                                <Button
                                    size={Button.Sizes.SMALL}
                                    color={Button.Colors.PRIMARY}
                                    onClick={() => setDraft(draft?.id === inst.id ? null : { ...inst, env: { ...(inst.env ?? {}) } })}
                                >
                                    Edit
                                </Button>
                            )}
                            {isCur && inst.foss && (
                                <Button
                                    size={Button.Sizes.SMALL}
                                    color={Button.Colors.PRIMARY}
                                    onClick={() => {
                                        const open = (window as any).__fosscordE2ee?.openSettings;
                                        if (typeof open !== "function") return toast("Encryption is still starting up", true);
                                        onClose();
                                        setTimeout(() => open(), 150);
                                    }}
                                >
                                    Encryption
                                </Button>
                            )}
                            {(isCur || inst.token || (inst.store && Object.keys(inst.store).length > 0)) && (
                                <Button
                                    size={Button.Sizes.SMALL}
                                    color={Button.Colors.PRIMARY}
                                    onClick={() => {
                                        if (confirmLogout === inst.id) {
                                            setConfirmLogout(null);
                                            logoutInstance(inst.id);
                                            refresh();
                                        } else {
                                            setConfirmLogout(inst.id);
                                            setTimeout(() => setConfirmLogout(c => (c === inst.id ? null : c)), 4000);
                                        }
                                    }}
                                >
                                    {confirmLogout === inst.id ? "Confirm?" : "Log out"}
                                </Button>
                            )}
                            {!inst.builtin && !isCur && (
                                <Button
                                    size={Button.Sizes.SMALL}
                                    color={Button.Colors.RED}
                                    onClick={() => {
                                        commit({ ...state, instances: state.instances.filter(i => i.id !== inst.id) });
                                        refresh();
                                    }}
                                >
                                    Remove
                                </Button>
                            )}
                        </div>

                        {draft?.id === inst.id && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                                <TextInput
                                    value={draft.name}
                                    placeholder="Name"
                                    onChange={(v: string) => setDraft({ ...draft, name: v })}
                                />
                                <TextInput
                                    value={draft.icon ?? ""}
                                    placeholder="Icon URL (optional) — defaults to /favicon.ico"
                                    onChange={(v: string) => setDraft({ ...draft, icon: v })}
                                />
                                <Toggle
                                    label="FossCORD/MeowCORD server"
                                    hint="Turns on end-to-end encrypted DMs for this server"
                                    checked={draft.foss === true}
                                    onChange={v => setDraft({ ...draft, foss: v || undefined })}
                                />
                                {CORE_FIELDS.map(f => (
                                    <TextInput
                                        key={f.key}
                                        value={draft.env?.[f.key] ?? ""}
                                        placeholder={`${f.label} — ${f.hint}`}
                                        onChange={(v: string) => setDraft({ ...draft, env: { ...(draft.env ?? {}), [f.key]: v } })}
                                    />
                                ))}
                                <Disclosure label="More endpoints" open={moreEdit} onToggle={() => setMoreEdit(!moreEdit)} />
                                {moreEdit && EXTRA_FIELDS.map(f => (
                                    <TextInput
                                        key={f.key}
                                        value={draft.env?.[f.key] ?? ""}
                                        placeholder={`${f.label} — ${f.hint}`}
                                        onChange={(v: string) => setDraft({ ...draft, env: { ...(draft.env ?? {}), [f.key]: v } })}
                                    />
                                ))}
                                <div style={{ display: "flex", gap: 8 }}>
                                    <Button size={Button.Sizes.SMALL} onClick={saveDraft}>Save</Button>
                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => setDraft(null)}>
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}

            <div style={sectionLabel}>Add an instance</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ flex: 2 }}>
                    <TextInput value={url} placeholder="https://my.instance" onChange={(v: string) => setUrl(v)} />
                </div>
                <div style={{ flex: 1 }}>
                    <TextInput value={name} placeholder="Name (optional)" onChange={(v: string) => setName(v)} />
                </div>
                <Button onClick={addFromUrl}>Add</Button>
            </div>
            <Disclosure label="Advanced endpoints" open={advanced} onToggle={() => setAdvanced(!advanced)} />
            {advanced && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <TextInput
                        value={ov.api ?? ""}
                        placeholder={`API base URL — ${tpl?.api ?? "https://my.instance/api"}`}
                        onChange={(v: string) => setOv({ ...ov, api: v })}
                    />
                    <TextInput
                        value={ov.gateway ?? ""}
                        placeholder={`Gateway URL — ${tpl?.gateway ?? "wss://my.instance/gateway"}`}
                        onChange={(v: string) => setOv({ ...ov, gateway: v })}
                    />
                    <TextInput
                        value={ov.cdn ?? ""}
                        placeholder={`CDN base URL — ${tpl?.cdn ?? "https://my.instance"}`}
                        onChange={(v: string) => setOv({ ...ov, cdn: v })}
                    />
                    <div style={{ fontSize: 12, color: C.muted }}>
                        Leave these blank to use the template shown in each placeholder.
                    </div>
                </div>
            )}
            <Toggle
                label="FossCORD/MeowCORD server"
                hint="Turns on end-to-end encrypted DMs for this server"
                checked={addFoss}
                onChange={setAddFoss}
            />
            <div style={{ display: "flex", gap: 6 }}>
                {Object.entries(PRESETS).map(([label, host]) => (
                    <Button
                        key={label}
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.PRIMARY}
                        onClick={() => add(presetEnv(host), `Discord ${label}`)}
                    >
                        + Discord {label}
                    </Button>
                ))}
            </div>

            <Disclosure label="Import / export instances" open={ioOpen} onToggle={() => setIoOpen(!ioOpen)} />
            {ioOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                        <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={copyExport}>
                            Copy export
                        </Button>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <div style={{ flex: 1 }}>
                            <TextInput
                                value={importText}
                                placeholder="Paste an exported list"
                                onChange={(v: string) => setImportText(v)}
                            />
                        </div>
                        <Button size={Button.Sizes.SMALL} onClick={runImport}>Import</Button>
                    </div>
                    <div style={{ fontSize: 12, color: C.muted }}>
                        Exports contain endpoints only, never logins. Only import lists from people you trust: an imported instance receives your login if you connect to it.
                    </div>
                </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginTop: 10, fontSize: 12, color: C.muted }}>
                <span>Switching reloads the client. Each instance keeps its own accounts.</span>
                <span>Ctrl+Alt+I open · Ctrl+Alt+1-9 quick switch · Ctrl+Alt+Shift+D revert</span>
            </div>
        </div>
    );
}

function openSwitcher() {
    openModal(props => (
        <ModalRoot {...props} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: C.header }}>Instances</div>
                    <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                        Choose the backend this app connects to. Each one keeps its own login.
                    </div>
                </div>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>
            <ModalContent>
                <Switcher onClose={props.onClose} />
            </ModalContent>
        </ModalRoot>
    ));
}

const card: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: 14,
    borderRadius: 8,
    background: C.row,
    border: "1px solid " + C.border
};

function SettingsSection({ title, children }: { title: string; children: React.ReactNode; }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ ...sectionLabel, marginTop: 0 }}>{title}</div>
            <div style={card}>{children}</div>
        </div>
    );
}

function SettingsPanel() {
    const store = settings.use();
    const [advanced, setAdvanced] = React.useState(false);
    const [hashOpen, setHashOpen] = React.useState(false);

    const flag = (key: keyof typeof store, label: string, hint: string) => (
        <Toggle label={label} hint={hint} checked={!!store[key]} onChange={v => { (store as any)[key] = v; }} />
    );

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ ...card, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.header }}>Instances</span>
                    <span style={{ fontSize: 12, color: C.muted }}>Add, edit and switch servers. Shortcut: Ctrl+Alt+I</span>
                </span>
                <Button onClick={() => openSwitcher()}>Open switcher</Button>
            </div>

            <SettingsSection title="On other servers">
                {flag("spoofVerified", "Skip verification locks", "Report the account as verified so chat is not blocked")}
                {flag("rewriteText", "Show the server's name instead of discord.com", "Settings, boost and invite screens")}
                {flag("userTags", "Show OFFICIAL and AI tags", "Next to names in messages and the member list")}
                {flag("showBadge", "Show a badge with the current server", "Click it to open the switcher")}
            </SettingsSection>

            <SettingsSection title="Messages and sound">
                {flag("pollMessages", "Catch missed messages", "Checks the open channel for messages the live connection missed")}
                {store.pollMessages && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 46 }}>
                        <span style={{ fontSize: 12, color: C.muted }}>Check every</span>
                        <div style={{ width: 70 }}>
                            <TextInput
                                type="number"
                                value={String(store.pollSeconds)}
                                onChange={(v: string) => { const n = Number(v); if (n >= 3) store.pollSeconds = Math.round(n); }}
                            />
                        </div>
                        <span style={{ fontSize: 12, color: C.muted }}>seconds</span>
                    </div>
                )}
                {flag("notifySound", "Extra ping for DMs and mentions", "Sounds different from real Discord")}
            </SettingsSection>

            <SettingsSection title="Encrypted DMs">
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.header }}>Encryption script address</span>
                    <TextInput value={store.e2eeUrl} placeholder="https://" onChange={(v: string) => { store.e2eeUrl = v; }} />
                    <span style={{ fontSize: 12, color: C.muted }}>
                        Used by servers with the FossCORD/MeowCORD switch on. It runs inside your client, so only use a host you trust.
                    </span>
                </div>
                <Disclosure label="Pin the script (optional)" open={hashOpen} onToggle={() => setHashOpen(!hashOpen)} />
                {hashOpen && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <TextInput value={store.e2eeHash} placeholder="SHA-256 in hex" onChange={(v: string) => { store.e2eeHash = v.trim(); }} />
                        <span style={{ fontSize: 12, color: C.muted }}>If set, the script only runs when it matches exactly.</span>
                    </div>
                )}
            </SettingsSection>

            <Disclosure label="Advanced" open={advanced} onToggle={() => setAdvanced(!advanced)} />
            {advanced && (
                <SettingsSection title="Advanced">
                    {flag("experimental", "Experimental features", "Turn off if the client refreshes or crashes by itself")}
                    {store.experimental && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingLeft: 46 }}>
                            {flag("pollOtherChannels", "Check other channels", "Keeps unread badges accurate")}
                            {flag("syncEdits", "Catch missed edits and deletes", "")}
                            {flag("autoReconnect", "Reconnect when messages were missed", "At most once a minute")}
                            {flag("notifyPrefix", "Server name in notification titles", "")}
                        </div>
                    )}
                    {flag("spoofPhone", "Also report a phone number", "For the highest verification level")}
                    {flag("sendCookies", "Send cookies to the server", "Can stop the client loading if the server's CORS is strict")}
                    {flag("debugFlux", "Log connection details to the console", "Helps diagnose missing messages")}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.header }}>Tag mapping</span>
                        <TextInput value={store.tagMap} onChange={(v: string) => { store.tagMap = v; }} />
                        <span style={{ fontSize: 12, color: C.muted }}>bit=LABEL pairs. Add * for a verified check and |#hex for a color. Example: 28=OFFICIAL*,30=AI*,16=BOT|#4e5058</span>
                    </div>
                </SettingsSection>
            )}

            <span style={{ fontSize: 12, color: C.muted }}>Most changes need a restart of Discord.</span>
        </div>
    );
}

const settings = definePluginSettings({
    spoofVerified: {
        hidden: true,
        type: OptionType.BOOLEAN,
        description: "On non-Discord instances only: report the account as verified with an email set, so the client does not lock chat behind email verification or 'claim your account'. Client-side only.",
        default: true
    },
    spoofPhone: {
        hidden: true,
        type: OptionType.BOOLEAN,
        description: "Also report a phone number (for servers with the highest verification level). Non-Discord instances only.",
        default: false
    },
    rewriteText: {
        hidden: true,
        type: OptionType.BOOLEAN,
        description: "On non-Discord instances only: show your instance's hostname instead of discord.com, discord.gg and similar in settings, boost pages and invite screens. Chat messages and embeds are left alone.",
        default: true
    },
    showBadge: {
        hidden: true,
        type: OptionType.BOOLEAN,
        description: "Show a small badge with the instance name while connected to a non-Discord instance. Click it to open the switcher.",
        default: true
    },
    userTags: {
        hidden: true,
        type: OptionType.BOOLEAN,
        description: "On non-Discord instances only: show tags such as OFFICIAL and AI next to usernames in messages and the member list, based on the account's public flags.",
        default: true
    },
    tagMap: {
        hidden: true,
        type: OptionType.STRING,
        description: "Which public-flag bit shows which tag, as bit=LABEL pairs separated by commas. OFFICIAL and AI always get the verified check mark; add * after any other label to give it one, and |#hex after a label for a custom color. Example: 28=OFFICIAL*,30=AI*,16=BOT|#4e5058",
        default: "28=OFFICIAL*,30=AI*"
    },
    e2eeUrl: {
        hidden: true,
        type: OptionType.STRING,
        description: "Address of the FossCORD/MeowCORD end-to-end encryption script (https only). It runs inside your client with access to your login, so only use a script you trust. Takes effect after a restart.",
        default: "https://iambrdn.com/projects/switcher/e2ee.js"
    },
    e2eeHash: {
        hidden: true,
        type: OptionType.STRING,
        description: "Optional SHA-256 (hex) of the script. When set, the script only runs if it matches exactly, so a changed or tampered file is refused. Leave empty to run whatever the address serves.",
        default: ""
    },
    experimental: {
        hidden: true,
        type: OptionType.BOOLEAN,
        description: "Turns on the newer, less-tested features: reconnecting when messages were missed, checking other channels, applying missed edits and deletes, notification name prefixes, and profile-popout tags. Turn this off if the client refreshes or crashes by itself. Takes effect after a restart.",
        default: false
    },
    sendCookies: {
        hidden: true,
        type: OptionType.BOOLEAN,
        description: "On non-Discord instances only: send requests to the instance's API with credentials, so the browser stores and sends its session cookie. Needs the server to allow credentialed requests from discord.com. If the client stops loading after enabling this, switch back to Discord with Ctrl+Alt+Shift+D and turn it off. Takes effect after a restart.",
        default: false
    },
    pollOtherChannels: {
        hidden: true,
        type: OptionType.BOOLEAN,
        description: "Also check other channels you can see for messages the live connection missed, so unread badges stay accurate. Runs about every fourth check, and needs your server to report each channel's last message.",
        default: true
    },
    syncEdits: {
        hidden: true,
        type: OptionType.BOOLEAN,
        description: "While checking the open channel, also apply edits and deletions the live connection missed.",
        default: true
    },
    autoReconnect: {
        hidden: true,
        type: OptionType.BOOLEAN,
        description: "When a check finds messages the live connection missed, close the gateway connection so the client reconnects. Limited to once a minute and three times per ten minutes. Takes effect after a restart.",
        default: true
    },
    notifyPrefix: {
        hidden: true,
        type: OptionType.BOOLEAN,
        description: "On non-Discord instances only: put the instance name in front of desktop notification titles, if the client's notification path allows it. Takes effect after a restart.",
        default: true
    },
    notifySound: {
        hidden: true,
        type: OptionType.BOOLEAN,
        description: "On non-Discord instances only: play an extra two-tone ping for direct messages and mentions, so they sound different from real Discord. Plays in addition to the client's own sound.",
        default: false
    },
    pollMessages: {
        hidden: true,
        type: OptionType.BOOLEAN,
        description: "On non-Discord instances only: every few seconds, fetch the newest messages in the open channel and show any the live connection missed. A fallback for servers whose live updates stall.",
        default: true
    },
    pollSeconds: {
        hidden: true,
        type: OptionType.NUMBER,
        description: "How often to check for missed messages, in seconds (minimum 3).",
        default: 8
    },
    debugFlux: {
        hidden: true,
        type: OptionType.BOOLEAN,
        description: "Log gateway-related events (connection open and close, new messages, typing, history loads) to the console to help diagnose missing live updates. Takes effect after a restart.",
        default: false
    },
    panel: {
        type: OptionType.COMPONENT,
        component: () => <SettingsPanel />
    }
});

function spoofUser() {
    const inst = active();
    if (!inst.env || !settings.store.spoofVerified) return;

    try {
        const u: any = UserStore.getCurrentUser();
        if (!u) return;

        let changed = false;
        const set = (key: string, value: unknown) => {
            try {
                u[key] = value;
            } catch {
                Object.defineProperty(u, key, { value, configurable: true, writable: true });
            }
            changed = true;
        };

        if (u.verified !== true) set("verified", true);
        if (u.email == null) set("email", `${u.username ?? u.id}@${hostOf(inst)}`);
        if (settings.store.spoofPhone && !u.phone) set("phone", "+15555550100");

        if (changed) {
            log("patched current user", { verified: u.verified, claimed: u.email != null });
            (UserStore as any).emitChange?.();
        }
    } catch (e) {
        console.warn("[InstanceSwitcher] user shim failed", e);
    }
}

function trace(name: string, e?: any) {
    if (!settings.store.debugFlux) return;
    log("event", name, e?.channelId ?? e?.message?.channel_id ?? "");
}

const sockets = new Map<number, { url: string; frames: number; ws: WebSocket }>();
let socketSeq = 0;
let nativeWebSocket: typeof WebSocket | null = null;
let socketTimer: number | undefined;

function debugLog(...a: any[]) {
    if (settings.store.debugFlux === true) log(...a);
}

function traceSockets() {
    if (nativeWebSocket || !active().env) return;
    if (settings.store.debugFlux !== true && (settings.store.experimental !== true || settings.store.autoReconnect === false)) return;
    const Native = window.WebSocket;
    nativeWebSocket = Native;

    window.WebSocket = new Proxy(Native, {
        construct(target, args) {
            const ws = Reflect.construct(target, args) as WebSocket;
            const url = String(args[0]);
            if (!url.includes("encoding=")) return ws;

            const id = ++socketSeq;
            const entry = { url, frames: 0, ws };
            sockets.set(id, entry);
            debugLog("ws new", id, url);
            ws.addEventListener("open", () => debugLog("ws open", id));
            ws.addEventListener("message", () => {
                entry.frames++;
            });
            ws.addEventListener("error", () => debugLog("ws error", id));
            ws.addEventListener("close", e => {
                debugLog("ws close", id, e.code, e.reason || "(no reason)", "frames", entry.frames);
                sockets.delete(id);
            });
            return ws;
        }
    }) as typeof WebSocket;

    socketTimer = window.setInterval(() => {
        if (settings.store.debugFlux !== true) return;
        sockets.forEach((s, id) => log("ws status", id, "readyState", s.ws.readyState, "frames", s.frames));
    }, 30000);
}

function untraceSockets() {
    if (nativeWebSocket) window.WebSocket = nativeWebSocket;
    nativeWebSocket = null;
    if (socketTimer) window.clearInterval(socketTimer);
    socketTimer = undefined;
    sockets.clear();
}

function dumpEnv() {
    const env = (window as any).GLOBAL_ENV;
    if (!env) return;
    const lines = Object.entries(env)
        .filter(([, v]) => typeof v === "string" && /discord/i.test(v as string))
        .map(([k, v]) => `${k}=${v}`);
    console.log(`[InstanceSwitcher] GLOBAL_ENV values still pointing at Discord:\n${lines.join("\n") || "(none)"}`);
}

const SKIP = "textarea,input,code,pre,[contenteditable='true'],[class*='markup'],[class*='messageContent'],[class*='embed'],[data-instance-switcher-ui]";
const HOSTS = /(?<![\w.-])(discord\.gg|discord\.gift|discord\.new|discord\.com|discordapp\.com)(?![\w-])/gi;

let textObserver: MutationObserver | null = null;
let badge: HTMLElement | null = null;

function replaceHosts(value: string, env: Env, host: string) {
    return value.replace(HOSTS, m => {
        switch (m.toLowerCase()) {
            case "discord.gg":
                return env.INVITE_HOST || host;
            case "discord.gift":
                return env.GIFT_CODE_HOST || host;
            case "discord.new":
                return env.GUILD_TEMPLATE_HOST || host;
            default:
                return host;
        }
    });
}

function rewriteText(node: Text, env: Env, host: string) {
    const value = node.nodeValue;
    if (!value || !/discord/i.test(value)) return;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    const next = replaceHosts(value, env, host);
    if (next !== value) node.nodeValue = next;
}

function rewriteNode(root: Node, env: Env, host: string) {
    if (root.nodeType === Node.TEXT_NODE) {
        rewriteText(root as Text, env, host);
        return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const el = root as Element;
    if (el.closest(SKIP)) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) rewriteText(n as Text, env, host);
}

function startTextRewrite() {
    const inst = active();
    if (!inst.env || !settings.store.rewriteText || textObserver) return;

    const env = inst.env;
    const host = hostOf(inst);
    const queue = new Set<Node>();
    let scheduled = false;

    const flush = () => {
        scheduled = false;
        const items = [...queue];
        queue.clear();
        items.forEach(n => rewriteNode(n, env, host));
    };

    textObserver = new MutationObserver(muts => {
        for (const m of muts) {
            if (m.type === "characterData") queue.add(m.target);
            else m.addedNodes.forEach(n => queue.add(n));
        }
        if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(flush);
        }
    });

    textObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    rewriteNode(document.body, env, host);
}

function mountBadge() {
    const inst = active();
    if (!inst.env || !settings.store.showBadge || badge || !document.body) return;

    badge = document.createElement("div");
    badge.textContent = inst.name;
    badge.setAttribute("data-instance-switcher-ui", "1");
    badge.title = "Instance switcher (Ctrl+Alt+I)";
    Object.assign(badge.style, {
        position: "fixed",
        right: "12px",
        bottom: "12px",
        zIndex: "9999",
        padding: "4px 10px",
        borderRadius: "999px",
        font: "600 11px/1.4 var(--font-primary, sans-serif)",
        color: "#fff",
        background: "var(--brand-500, #5865f2)",
        opacity: "0.8",
        cursor: "pointer",
        userSelect: "none",
        webkitAppRegion: "no-drag"
    });
    badge.addEventListener("click", () => openSwitcher());
    document.body.appendChild(badge);
}

const VERIFIED_LABELS = new Set(["OFFICIAL", "AI"]);
const TAG_COLORS: Record<string, string> = { AI: "#248046" };

function parseTagMap(raw: string): { bit: number; label: string; verified: boolean; color: string }[] {
    return String(raw ?? "")
        .split(",")
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
            const [bit, ...rest] = part.split("=");
            const [labelPart, colorPart] = rest.join("=").split("|");
            const trimmed = (labelPart ?? "").trim();
            const label = trimmed.replace(/\*$/, "").trim();
            return {
                bit: Number(bit),
                label,
                verified: trimmed.endsWith("*") || VERIFIED_LABELS.has(label.toUpperCase()),
                color: (colorPart ?? "").trim()
            };
        })
        .filter(t => Number.isInteger(t.bit) && t.bit >= 0 && t.bit < 53 && t.label.length > 0);
}

function tagsFor(user: any) {
    if (!user || !active().env || !settings.store.userTags) return [];
    const full: any = (user.id && UserStore.getUser(user.id)) || user;
    const flags = Number(full.publicFlags ?? full.public_flags ?? 0);
    if (!flags) return [];
    return parseTagMap(settings.store.tagMap).filter(t => Math.floor(flags / 2 ** t.bit) % 2 === 1);
}

function Tag({ label, verified, color }: { label: string; verified: boolean; color: string; }) {
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                marginLeft: 4,
                padding: verified ? "0 4px 0 3px" : "0 4px",
                height: 15,
                borderRadius: 3,
                fontSize: 10,
                fontWeight: 600,
                lineHeight: "15px",
                color: "#fff",
                background: color || TAG_COLORS[label.toUpperCase()] || "var(--brand-500, #5865f2)",
                verticalAlign: "middle",
                userSelect: "none",
                whiteSpace: "nowrap"
            }}
        >
            {verified && (
                <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0 }}>
                    <path
                        d="M3 8.5 6.4 12 13 4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            )}
            <span>{label.toUpperCase()}</span>
        </span>
    );
}

function Tags({ user }: { user: any; }) {
    const tags = tagsFor(user);
    if (!tags.length) return null;
    return <>{tags.map(t => <Tag key={t.label} label={t.label} verified={t.verified} color={t.color} />)}</>;
}

let profileBadgeAdded = false;

const profileBadge = {
    key: "InstanceSwitcherTags",
    component: (p: any) => <Tags user={UserStore.getUser(p?.userId)} />,
    shouldShow: (p: any) => tagsFor(UserStore.getUser(p?.userId)).length > 0
};

let pollTimer: number | undefined;
let polling = false;
let pollTick = 0;
const reconnects: number[] = [];
const TEXT_CHANNEL_TYPES = new Set([0, 5]);

function snowflakeCompare(a: string, b: string) {
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
}

function reconnectGateway(reason: string) {
    if (settings.store.experimental !== true || settings.store.autoReconnect === false) return;

    const now = Date.now();
    while (reconnects.length && now - reconnects[0] > 600000) reconnects.shift();
    if (reconnects.length >= 3) return;
    if (reconnects.length && now - reconnects[reconnects.length - 1] < 60000) return;

    const live = [...sockets.values()].filter(s => s.ws.readyState === 1);
    if (!live.length) return;

    reconnects.push(now);
    log("reconnecting gateway:", reason);
    toast("Live updates stalled, reconnecting…");
    live.forEach(s => {
        try {
            s.ws.close(4000, "InstanceSwitcher gap");
        } catch {
            return;
        }
    });
}

async function fetchMessages(channelId: string, query: Record<string, unknown>): Promise<any[]> {
    const res: any = await (RestAPI as any).get({ url: `/channels/${channelId}/messages`, query, retries: 0 });
    return Array.isArray(res?.body) ? res.body : [];
}

function deliver(channelId: string, messages: any[]) {
    messages
        .sort((a, b) => snowflakeCompare(a.id, b.id))
        .forEach(message =>
            FluxDispatcher.dispatch({
                type: "MESSAGE_CREATE",
                channelId,
                message,
                optimistic: false,
                isPushNotification: false
            } as any)
        );
}

function isRecent(message: any, now: number) {
    const age = now - Date.parse(message.timestamp);
    return age >= 0 && age < 3000;
}

async function pollOpenChannel() {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) return;

    const channel: any = MessageStore.getMessages(channelId);
    if (!channel?.ready || channel.hasMoreAfter) return;

    const lastId: string | undefined = channel.last?.()?.id ?? (MessageStore as any).getLastMessage?.(channelId)?.id;
    if (!lastId) return;

    const list = (await fetchMessages(channelId, { limit: 50 })).filter(m => m?.id);
    if (!list.length) return;

    const now = Date.now();
    const ids = new Set<string>(list.map(m => m.id));
    const oldest = list.reduce((a, m) => (snowflakeCompare(m.id, a) < 0 ? m.id : a), list[0].id);
    const newest = list.reduce((a, m) => (snowflakeCompare(m.id, a) > 0 ? m.id : a), list[0].id);

    let missed = list.filter(
        m => snowflakeCompare(m.id, lastId) > 0 && !MessageStore.getMessage(channelId, m.id) && !isRecent(m, now)
    );

    if (list.length >= 50 && snowflakeCompare(oldest, lastId) > 0) {
        missed = (await fetchMessages(channelId, { after: lastId, limit: 50 }))
            .filter(m => m?.id && !MessageStore.getMessage(channelId, m.id));
    }

    if (missed.length) {
        log("poll found messages the live connection did not deliver:", missed.length);
        deliver(channelId, missed);
        reconnectGateway("missed messages in the open channel");
    }

    if (settings.store.experimental !== true || settings.store.syncEdits === false) return;

    for (const m of list) {
        const have: any = MessageStore.getMessage(channelId, m.id);
        if (!have) continue;
        const was = have.editedTimestamp ? +new Date(have.editedTimestamp) : 0;
        const is = m.edited_timestamp ? Date.parse(m.edited_timestamp) : 0;
        if (is > was) FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", message: m, guildId: m.guild_id } as any);
    }

    const stored: any[] = channel._array ?? channel.toArray?.() ?? [];
    for (const have of stored) {
        if (!have?.id || ids.has(have.id)) continue;
        if (snowflakeCompare(have.id, oldest) < 0 || snowflakeCompare(have.id, newest) > 0) continue;
        if ((have.state && have.state !== "SENT") || (have.flags & 64)) continue;
        FluxDispatcher.dispatch({
            type: "MESSAGE_DELETE",
            id: have.id,
            channelId,
            guildId: (ChannelStore.getChannel(channelId) as any)?.guild_id
        } as any);
    }
}

async function backfillGuilds() {
    const guilds: any = (GuildStore as any).getGuilds?.() ?? {};
    const selected = SelectedChannelStore.getChannelId();

    for (const guildId of Object.keys(guilds).slice(0, 10)) {
        let channels: any[] = [];
        try {
            const res: any = await (RestAPI as any).get({ url: `/guilds/${guildId}/channels`, retries: 0 });
            channels = Array.isArray(res?.body) ? res.body : [];
        } catch {
            continue;
        }

        for (const ch of channels) {
            if (!TEXT_CHANNEL_TYPES.has(ch.type) || !ch.last_message_id || ch.id === selected) continue;

            const known: string | undefined =
                ReadStateStore?.lastMessageId?.(ch.id) ?? (ChannelStore.getChannel(ch.id) as any)?.lastMessageId;
            if (!known || snowflakeCompare(ch.last_message_id, known) <= 0) continue;

            try {
                const missed = (await fetchMessages(ch.id, { after: known, limit: 20 }))
                    .filter(m => m?.id && !MessageStore.getMessage(ch.id, m.id));
                if (!missed.length) continue;
                log("backfill found messages in another channel:", missed.length);
                deliver(ch.id, missed);
                reconnectGateway("missed messages in another channel");
            } catch {
                continue;
            }
        }
    }
}

async function pollMessages() {
    if (polling || document.hidden || !active().env || !settings.store.pollMessages) return;
    polling = true;
    try {
        await pollOpenChannel();
        if (settings.store.experimental === true && settings.store.pollOtherChannels !== false && pollTick++ % 4 === 0) await backfillGuilds();
    } catch (e) {
        console.warn("[InstanceSwitcher] poll failed", e);
    } finally {
        polling = false;
    }
}

let nativeNotification: typeof Notification | null = null;
let nativeShow: ((...a: any[]) => any) | null = null;

function prefixNotifications() {
    if (nativeNotification || !active().env || settings.store.experimental !== true || settings.store.notifyPrefix === false) return;
    const name = active().name;
    const Native = window.Notification;

    if (Native) {
        nativeNotification = Native;
        const Wrapped: any = function (title: string, options?: NotificationOptions) {
            return new Native(`[${name}] ${title}`, options);
        };
        Wrapped.prototype = Native.prototype;
        Wrapped.requestPermission = Native.requestPermission.bind(Native);
        Object.defineProperty(Wrapped, "permission", { get: () => Native.permission });
        window.Notification = Wrapped;
    }

    try {
        const n: any = (window as any).DiscordNative?.notifications;
        if (n && typeof n.showNotification === "function") {
            const original = n.showNotification;
            n.showNotification = (icon: unknown, title: unknown, ...rest: unknown[]) =>
                original.call(n, icon, typeof title === "string" ? `[${name}] ${title}` : title, ...rest);
            if (n.showNotification !== original) nativeShow = original;
        }
    } catch {
        nativeShow = null;
    }
}

function unprefixNotifications() {
    if (nativeNotification) window.Notification = nativeNotification;
    nativeNotification = null;
    try {
        if (nativeShow) (window as any).DiscordNative.notifications.showNotification = nativeShow;
    } catch {
        nativeShow = null;
    }
    nativeShow = null;
}

function playPing() {
    try {
        const ctx = new AudioContext();
        const t0 = ctx.currentTime;
        [880, 1320].forEach((freq, i) => {
            const start = t0 + i * 0.12;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + 0.2);
        });
        setTimeout(() => ctx.close(), 700);
    } catch {
        return;
    }
}

function maybePing(e: any) {
    if (!active().env || !settings.store.notifySound) return;
    const message = e?.message;
    const me = UserStore.getCurrentUser()?.id;
    if (!message || !me || message.author?.id === me) return;
    const mentioned = Array.isArray(message.mentions) && message.mentions.some((u: any) => u?.id === me);
    if (!message.guild_id || mentioned) playPing();
}

function onFocus() {
    pollMessages();
}

function scheduleNextPoll() {
    const seconds = Math.max(3, Number(settings.store.pollSeconds) || 8);
    pollTimer = window.setTimeout(async () => {
        await pollMessages();
        scheduleNextPoll();
    }, seconds * 1000);
}

function startPolling() {
    if (pollTimer || !active().env) return;
    scheduleNextPoll();
    window.addEventListener("focus", onFocus);
}

function stopPolling() {
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = undefined;
    window.removeEventListener("focus", onFocus);
}

let nativeXhrOpen: XMLHttpRequest["open"] | null = null;
let nativeFetch: typeof fetch | null = null;

function enableCredentials() {
    if (nativeXhrOpen || !active().env || settings.store.sendCookies !== true) return;
    const host = hostOf(active());

    const sameInstance = (url: string) => {
        try {
            return new URL(url, location.href).host === host;
        } catch {
            return false;
        }
    };

    const proto = XMLHttpRequest.prototype;
    const originalOpen = proto.open;
    nativeXhrOpen = originalOpen;
    proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
        const result = (originalOpen as any).call(this, method, url, ...rest);
        if (sameInstance(String(url))) this.withCredentials = true;
        return result;
    } as any;

    const originalFetch = window.fetch;
    nativeFetch = originalFetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
        return originalFetch.call(window, input, sameInstance(url) ? { ...init, credentials: "include" } : init);
    } as typeof fetch;
}

function disableCredentials() {
    if (nativeXhrOpen) XMLHttpRequest.prototype.open = nativeXhrOpen;
    if (nativeFetch) window.fetch = nativeFetch;
    nativeXhrOpen = null;
    nativeFetch = null;
}

let e2eeStarted = false;
let e2eeTimer: number | undefined;

function withStorageShim<T>(run: () => Promise<T>): Promise<T> {
    const undo: (() => void)[] = [];
    const shim = (name: "localStorage" | "sessionStorage", value: Storage | null) => {
        if (!value) return;
        let present = false;
        try {
            present = !!(window as any)[name];
        } catch {
            present = false;
        }
        if (present) return;
        Object.defineProperty(window, name, { configurable: true, get: () => value });
        undo.push(() => {
            delete (window as any)[name];
        });
    };
    shim("localStorage", LS);
    shim("sessionStorage", SS);
    return run().finally(() => undo.forEach(fn => fn()));
}

function updateDecryptedMessage(channelId: string, id: string, patch: { content: string; stickerItems?: unknown[]; }) {
    const have: any = MessageStore.getMessage(channelId, id);
    if (!have) return;
    FluxDispatcher.dispatch({
        type: "MESSAGE_UPDATE",
        message: {
            id,
            channel_id: channelId,
            guild_id: have.guild_id,
            content: patch.content,
            sticker_items: patch.stickerItems ?? []
        },
        e2eeLocal: true
    } as any);
}

async function loadE2ee(req: any) {
    const holder: any = ((window as any).__fosscordE2ee ??= { reqs: [] });
    holder.reqs = [req];
    holder.updateMessage ??= updateDecryptedMessage;
    const url = (settings.store.e2eeUrl || "").trim();
    if (!/^https:\/\/[^\s/]+\/\S*$/i.test(url)) throw new Error("The encryption script address must be an https address");
    const native = nativeApi();
    if (!native?.fetchScript) throw new Error("native helper missing, rebuild the plugin with native.ts");
    const res = await native.fetchScript(url);
    if (!res.ok || typeof res.text !== "string") throw new Error(res.error || "download failed");
    const want = (settings.store.e2eeHash || "").trim().toLowerCase();
    if (want) {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(res.text));
        const got = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
        if (got !== want) throw new Error("the script does not match the pinned hash, refusing to run it");
    }
    await withStorageShim(async () => {
        (0, eval)(res.text + "\n//# sourceURL=" + url);
    });
    log("end-to-end encryption module loaded from", url);
}

function startE2ee() {
    const inst = active();
    if (e2eeStarted || !inst.env || !inst.foss) return;
    e2eeStarted = true;
    log("FossCORD/MeowCORD server: starting end-to-end encryption support");

    const attempt = () => {
        const req: any = wreq;
        if (!req?.c || Object.keys(req.c).length < 300) {
            e2eeTimer = window.setTimeout(attempt, 500);
            return;
        }
        loadE2ee(req).catch(e => fail("Couldn't start end-to-end encryption", e));
    };
    attempt();
}

function stopE2ee() {
    if (e2eeTimer) window.clearTimeout(e2eeTimer);
    e2eeTimer = undefined;
}

function onReady(fn: () => void) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
    else fn();
}

function onKey(e: KeyboardEvent) {
    if (!(e.ctrlKey && e.altKey)) return;

    if (e.code === "KeyI" && !e.shiftKey) {
        e.preventDefault();
        openSwitcher();
        return;
    }

    if (e.code === "KeyD" && e.shiftKey) {
        e.preventDefault();
        emergencyReset();
        return;
    }

    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit && !e.shiftKey) {
        const target = state.instances[Number(digit[1]) - 1];
        if (target) {
            e.preventDefault();
            switchTo(target.id);
        }
    }
}

function onCspViolation(e: SecurityPolicyViolationEvent) {
    let what = e.blockedURI;
    try {
        const u = new URL(e.blockedURI);
        what = `scheme=${u.protocol.replace(":", "")} host=${u.host}`;
    } catch {
        what = e.blockedURI;
    }
    console.warn("[InstanceSwitcher] CSP blocked:", e.violatedDirective, what);
}

export default definePlugin({
    name: "InstanceSwitcher",
    description: "One-click switch the Discord client between Discord and your own Discord-clone instances, with a separate set of accounts for each.",
    authors: [{ name: "Braiden", id: 0n }],
    settings,

    startAt: StartAt.Init,

    flux: {
        CONNECTION_OPEN: (e: any) => {
            trace("CONNECTION_OPEN", e);
            spoofUser();
        },
        CURRENT_USER_UPDATE: () => spoofUser(),
        USER_UPDATE: () => spoofUser(),
        CONNECTION_CLOSED: (e: any) => trace("CONNECTION_CLOSED", e),
        CONNECTION_RESUMED: (e: any) => trace("CONNECTION_RESUMED", e),
        MESSAGE_CREATE: (e: any) => {
            trace("MESSAGE_CREATE", e);
            maybePing(e);
        },
        TYPING_START: (e: any) => trace("TYPING_START", e),
        LOAD_MESSAGES_SUCCESS: (e: any) => trace("LOAD_MESSAGES_SUCCESS", e),
        LOAD_MESSAGES_FAILURE: (e: any) => trace("LOAD_MESSAGES_FAILURE", e)
    } as any,

    start() {
        finishSwap();
        log("active instance:", active().name);
        applyEnv(active().env);
        traceSockets();

        addMessageDecoration("InstanceSwitcher", props => <Tags user={props.message?.author} />);
        addMemberListDecorator("InstanceSwitcher", props => <Tags user={props.user} />);
        startPolling();
        prefixNotifications();
        enableCredentials();
        if (settings.store.experimental === true) {
            addProfileBadge(profileBadge as any);
            profileBadgeAdded = true;
        }

        window.addEventListener("keydown", onKey, true);
        document.addEventListener("securitypolicyviolation", onCspViolation);

        onReady(() => {
            startTextRewrite();
            mountBadge();
            startE2ee();
        });

        if (active().env) setTimeout(dumpEnv, 4000);

        const gws = wssOrigins(active().env);
        if (gws.length) {
            nativeApi()?.allowGateways(gws)
                .then(r => {
                    if (r.added) {
                        log("websocket origins newly allowed, reloading once", gws);
                        setTimeout(reload, 300);
                    }
                })
                .catch(e => console.error("[InstanceSwitcher] allowGateways failed", e));
        }
    },

    stop() {
        window.removeEventListener("keydown", onKey, true);
        document.removeEventListener("securitypolicyviolation", onCspViolation);
        textObserver?.disconnect();
        textObserver = null;
        badge?.remove();
        badge = null;
        untraceSockets();
        removeMessageDecoration("InstanceSwitcher");
        removeMemberListDecorator("InstanceSwitcher");
        stopPolling();
        stopE2ee();
        unprefixNotifications();
        disableCredentials();
        if (profileBadgeAdded) {
            removeProfileBadge(profileBadge as any);
            profileBadgeAdded = false;
        }
    }
});
