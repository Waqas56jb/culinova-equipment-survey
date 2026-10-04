import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { api, ApiError, clearSession, failedSaveMessage, getToken, setOnUnauthorized, setSession } from "./api";
import { catalogFromApi, catalogFromMaster, otherTypeForCategory } from "./catalog";
import { PHOTO_TYPES, NETWORK_SAVE_MSG, hasSurveyAccess } from "./constants";
import { fileToJpegDataUrl } from "./photos";

const FALLBACK = catalogFromMaster();

const CONDITIONS = [
  ["good", "Good", "c-good"],
  ["ns", "Need service", "c-ns"],
  ["oos", "Out of service", "c-oos"],
  ["mixed", "Mixed", "c-mixed"],
];

function Spinner({ ghost }) {
  return <span className={`spin${ghost ? " ghost" : ""}`} aria-hidden="true" />;
}

function ActionBtn({ busy, idle, busyLabel, className = "btn big", ...rest }) {
  const on = !!busy;
  return (
    <button
      className={className}
      type={rest.type || "button"}
      disabled={on || rest.disabled}
      aria-busy={on || undefined}
      {...rest}
    >
      {on ? <Spinner ghost={/\bghost\b/.test(className)} /> : null}
      {on ? (busyLabel || idle) : idle}
    </button>
  );
}

function needsProblem(d) {
  return d.cond === "ns" || d.cond === "oos" || (d.cond === "mixed" && d.ns + d.oos > 0);
}

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function clientLabel(c) {
  return String(c?.label || c?.name || c?.code || "Client").trim();
}

function isVerifySeedClient(c) {
  return /^S3B1\s+Customer/i.test(clientLabel(c));
}

function sortClients(list) {
  return (list || []).slice().sort((a, b) => {
    const seedA = isVerifySeedClient(a) ? 1 : 0;
    const seedB = isVerifySeedClient(b) ? 1 : 0;
    if (seedA !== seedB) return seedA - seedB;
    return clientLabel(a).localeCompare(clientLabel(b), "en");
  });
}

function toLocalInput(iso) {
  if (!iso) return nowLocal();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return nowLocal();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function split(it) {
  if (it.cond === "good") return [it.qty, 0, 0];
  if (it.cond === "ns") return [0, it.qty, 0];
  if (it.cond === "oos") return [0, 0, it.qty];
  return [it.good, it.ns, it.oos];
}

function localTotals(items) {
  const t = { total: 0, good: 0, ns: 0, oos: 0, problems: 0 };
  items.forEach((it) => {
    const [g, s, o] = split(it);
    t.total += it.qty;
    t.good += g;
    t.ns += s;
    t.oos += o;
    if (s + o > 0) t.problems++;
  });
  return t;
}

function Plate({ t }) {
  return (
    <div className="plate" aria-live="polite">
      <div>
        <b>{t.total}</b>
        <span>Total</span>
      </div>
      <div className="g">
        <b>{t.good}</b>
        <span>Good</span>
      </div>
      <div className="s">
        <b>{t.ns}</b>
        <span>Need service</span>
      </div>
      <div className="o">
        <b>{t.oos}</b>
        <span>OOS</span>
      </div>
    </div>
  );
}

function fmtDate(s) {
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function specText(it, defs) {
  return Object.entries(it.specs || {})
    .filter(([k, v]) => v !== "" && v != null && !k.endsWith("__other") && k !== "Custom Equipment Name")
    .map(([k, v]) => {
      const lab = defs[k]?.l || k;
      return `${lab}: ${v === "Other" && it.specs[k + "__other"] ? it.specs[k + "__other"] : v}`;
    })
    .join(", ");
}

function Stepper({ value, onChange, label, min = 0, disabled }) {
  return (
    <div className="step">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={disabled}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Math.max(min, Math.floor(+e.target.value || 0)))}
      />
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={disabled}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

function AttrField({ attrKey, value, otherValue, onSpec, defs, disabled }) {
  const d = defs[attrKey];
  if (!d) return null;
  const id = "a-" + attrKey.replace(/[^a-z0-9]/gi, "_");
  return (
    <div className="field">
      <div className="f-label" id={`${id}-l`}>
        {d.l}
      </div>
      {d.t === "s" && (d.o || []).length <= 6 ? (
        <div className="chips" role="group" aria-labelledby={`${id}-l`}>
          {(d.o || []).map((o) => (
            <button
              key={o}
              type="button"
              className="chip"
              disabled={disabled}
              aria-pressed={value === o}
              onClick={() => onSpec(attrKey, value === o ? "" : o)}
            >
              {o}
            </button>
          ))}
        </div>
      ) : d.t === "s" ? (
        <select
          className="in"
          aria-labelledby={`${id}-l`}
          value={value}
          disabled={disabled}
          onChange={(e) => onSpec(attrKey, e.target.value)}
        >
          <option value="">Select</option>
          {(d.o || []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="in"
          aria-labelledby={`${id}-l`}
          type={d.t === "n" ? "number" : "text"}
          inputMode={d.t === "n" ? "decimal" : undefined}
          min={d.t === "n" ? 0 : undefined}
          value={value}
          disabled={disabled}
          placeholder="Leave empty if unknown"
          onChange={(e) => onSpec(attrKey, e.target.value)}
        />
      )}
      {d.t === "s" && value === "Other" ? (
        <input
          className="in"
          style={{ marginTop: 8 }}
          type="text"
          value={otherValue}
          disabled={disabled}
          placeholder="Type the value"
          aria-label={`${d.l}, other value`}
          onChange={(e) => onSpec(attrKey + "__other", e.target.value)}
        />
      ) : null}
    </div>
  );
}

function EquipmentFormBody({
  draft,
  delArmed,
  defs,
  readonly,
  photoBusy,
  onUpdate,
  onSpec,
  onDeletePhoto,
  onPhotoType,
  onRetryPhoto,
  onDelete,
}) {
  const showProblem = needsProblem(draft);
  return (
    <>
      {draft.custom ? (
        <div className="card" key="custom-name">
          <div className="field" style={{ margin: 0 }}>
            <label className="f" htmlFor="cname">
              Equipment name
            </label>
            <input
              className="in"
              id="cname"
              type="text"
              value={draft.name}
              disabled={readonly}
              placeholder="e.g. Sugar cane juicer"
              onChange={(e) => onUpdate({ name: e.target.value })}
            />
          </div>
        </div>
      ) : null}

      {draft.attrs.length ? (
        <div className="card" key="specs">
          <h2>Specifications</h2>
          {draft.attrs.map((k) => (
            <AttrField
              key={k}
              attrKey={k}
              defs={defs}
              disabled={readonly}
              value={draft.specs[k] ?? ""}
              otherValue={draft.specs[k + "__other"] ?? ""}
              onSpec={onSpec}
            />
          ))}
          <p className="hint" style={{ marginTop: -6 }}>
            Not sure? Choose Unknown or leave it empty. Do not guess.
          </p>
        </div>
      ) : null}

      <div className="card" key="qty">
        <h2>Quantity</h2>
        <Stepper
          value={draft.qty}
          label="Quantity"
          min={1}
          disabled={readonly}
          onChange={(qty) => onUpdate({ qty })}
        />
      </div>

      <div className="card" key="condition">
        <h2>Condition</h2>
        <div className="cond">
          {CONDITIONS.map(([k, l, c]) => (
            <button
              key={k}
              type="button"
              className={c}
              disabled={readonly}
              aria-pressed={draft.cond === k}
              onClick={() => {
                const next = { cond: k };
                if (k === "mixed" && draft.good + draft.ns + draft.oos === 0) {
                  next.good = draft.qty;
                }
                onUpdate(next);
              }}
            >
              <i />
              {l}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 16 }} hidden={draft.cond !== "mixed"}>
          <div className="mixrow">
            <span>Good</span>
            <Stepper
              value={draft.good}
              label="Good quantity"
              disabled={readonly}
              onChange={(good) => onUpdate({ good })}
            />
          </div>
          <div className="mixrow">
            <span>Need service</span>
            <Stepper
              value={draft.ns}
              label="Need service quantity"
              disabled={readonly}
              onChange={(ns) => onUpdate({ ns })}
            />
          </div>
          <div className="mixrow">
            <span>Out of service</span>
            <Stepper
              value={draft.oos}
              label="Out of service quantity"
              disabled={readonly}
              onChange={(oos) => onUpdate({ oos })}
            />
          </div>
          <div
            className={`check${
              draft.good + draft.ns + draft.oos === draft.qty ? " ok" : ""
            }`}
          >
            {draft.good + draft.ns + draft.oos === draft.qty
              ? `All ${draft.qty} assigned`
              : `${draft.good + draft.ns + draft.oos} of ${draft.qty} assigned. The three numbers must add up to ${draft.qty}.`}
          </div>
        </div>
      </div>

      <div className="card" key="problem" hidden={!showProblem}>
        <label className="f" htmlFor="prob">
          Problem / observation
        </label>
        <textarea
          className="in"
          id="prob"
          disabled={readonly}
          placeholder="Short note, e.g. compressor not starting"
          value={draft.problem}
          onChange={(e) => onUpdate({ problem: e.target.value })}
        />
        <p className="hint">
          Take a photo of the nameplate so the office can read brand, model and serial.
        </p>
      </div>

      <div className="card" key="photos">
        <h2>
          Photos{draft.photos.length ? ` (${draft.photos.length})` : ""}
        </h2>
        {!readonly ? (
          <div className="photo-actions">
            <label className={`btn ghost${photoBusy ? " is-busy" : ""}`} htmlFor="cam">
              {photoBusy ? <Spinner ghost /> : null}
              Take photo
            </label>
            <label className={`btn ghost${photoBusy ? " is-busy" : ""}`} htmlFor="gal">
              {photoBusy ? <Spinner ghost /> : null}
              From gallery
            </label>
          </div>
        ) : null}
        {draft.photos.length ? (
          <div className="thumbs">
            {draft.photos.map((p, i) => (
              <div className="thumb" key={photoKey(p) || i} data-photo-id={p.id || p.localId || ""}>
                <img src={p.url} alt={`Photo ${i + 1}`} />
                {!readonly ? (
                  <button
                    type="button"
                    className="x"
                    aria-label={`Delete photo ${i + 1}`}
                    data-photo-key={photoKey(p)}
                    onClick={() => onDeletePhoto(photoKey(p))}
                  >
                    ×
                  </button>
                ) : null}
                <select
                  aria-label={`Photo ${i + 1} type`}
                  value={p.type}
                  disabled={readonly}
                  onChange={(e) => onPhotoType(photoKey(p), e.target.value)}
                >
                  <option value="">No tag</option>
                  {PHOTO_TYPES.map((pt) => (
                    <option key={pt}>{pt}</option>
                  ))}
                </select>
                {p.status === "uploading" ? (
                  <div className="thumb-busy"><Spinner /> Uploading…</div>
                ) : null}
                {p.status === "saved" ? <p className="hint">Saved</p> : null}
                {p.status === "failed" ? (
                  <p className="hint">
                    Failed.{" "}
                    <button type="button" className="linkish" onClick={() => onRetryPhoto(photoKey(p))}>
                      Retry
                    </button>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">Add as many as you need. You can add more later.</p>
        )}
      </div>

      {draft.uid && !readonly ? (
        <button
          className="btn danger"
          type="button"
          style={{ marginBottom: 14 }}
          onClick={onDelete}
        >
          {delArmed ? "Tap again to delete" : "Delete this equipment"}
        </button>
      ) : null}
    </>
  );
}

function UserBar({ user, onLogout }) {
  if (!user) return null;
  return (
    <div className="who">
      <span>{user.name}</span>
      <button type="button" onClick={onLogout}>
        Logout
      </button>
    </div>
  );
}

function photoKey(p) {
  return p?.id || p?.localId || p?.url || "";
}

function lineToItem(line, catalog) {
  const attrs = line.attrs && typeof line.attrs === "object" && !Array.isArray(line.attrs) ? line.attrs : {};
  const type = catalog.eq.find((e) => e.id === line.type_code);
  const customName = attrs["Custom Equipment Name"];
  return {
    uid: line.id,
    eqId: line.type_code,
    name: customName || line.type_name,
    custom: !!(customName || /^other /i.test(line.type_name || "")),
    cat: line.category,
    attrs: type?.attrs || [],
    specs: attrs,
    qty: Number(line.qty) || 1,
    cond: line.condition || line.cond,
    good: Number(line.qty_good) || 0,
    ns: Number(line.qty_ns) || 0,
    oos: Number(line.qty_oos) || 0,
    problem: line.notes || "",
    photos: (line.photos || []).map((p) => ({
      id: p.id,
      url: p.url,
      path: p.path,
      type: p.kind || "",
      name: p.name,
      status: "saved",
    })),
  };
}

function visitFromApi(v, catalog, prev) {
  const site = v.site || {};
  const customer = site.customer || {};
  return {
    id: v.id,
    status: v.status,
    client: customer.name || prev?.client || "",
    clientId: site.customer_id || customer.id || prev?.clientId,
    site: site.name || prev?.site || "",
    siteId: v.site_id || site.id || prev?.siteId,
    tech: v.technician_name,
    technician_id: v.technician_id,
    date: toLocalInput(v.visited_at),
    items: (v.lines || []).map((l) => lineToItem(l, catalog)),
    totals: v.totals || null,
    readonly: v.status === "Submitted",
  };
}

function linePayload(draft) {
  const attrs = { ...(draft.specs || {}) };
  if (draft.custom && draft.name.trim()) attrs["Custom Equipment Name"] = draft.name.trim();
  return {
    type_code: draft.eqId,
    condition: draft.cond,
    qty: draft.qty,
    qty_good: draft.cond === "mixed" ? draft.good : 0,
    qty_ns: draft.cond === "mixed" ? draft.ns : 0,
    qty_oos: draft.cond === "mixed" ? draft.oos : 0,
    notes: needsProblem(draft) ? draft.problem : "",
    attrs,
  };
}

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("boot");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [catalog, setCatalog] = useState(FALLBACK);
  const [clients, setClients] = useState([]);
  const [sites, setSites] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [draftsStatus, setDraftsStatus] = useState("idle");
  const [client, setClient] = useState("");
  const [site, setSite] = useState("");
  const [newSiteName, setNewSiteName] = useState("");
  const [addingSite, setAddingSite] = useState(false);
  const [date, setDate] = useState(nowLocal);
  const [visit, setVisit] = useState(null);
  const [pickCat, setPickCat] = useState(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(null);
  const [formErr, setFormErr] = useState("");
  const [startErr, setStartErr] = useState("");
  const [finishErr, setFinishErr] = useState("");
  const [delArmed, setDelArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const camRef = useRef(null);
  const galRef = useRef(null);
  const formScrollRef = useRef(0);
  const catalogLoaded = useRef(false);
  const deletedPhotoIds = useRef(new Set());

  const CATS = catalog.cats;
  const DEFS = catalog.defs;
  const EQ = catalog.eq;
  const allowed = user && hasSurveyAccess(user.role);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setVisit(null);
    setDrafts([]);
    setDraftsStatus("idle");
    setView("login");
  }, []);

  useEffect(() => {
    setOnUnauthorized(logout);
    return () => setOnUnauthorized(null);
  }, [logout]);

  const bootSession = useCallback(async () => {
    const token = getToken();
    if (!token) {
      clearSession();
      setUser(null);
      setView("login");
      return;
    }
    setView("boot");
    try {
      const me = await api("GET", "/auth/me");
      const fromApi = {
        id: me.id,
        name: me.name,
        email: me.email,
        role: me.role,
        access_level: me.access_level,
        designation: me.designation,
      };
      setSession(getToken() || token, fromApi);
      setUser(fromApi);
      setView(hasSurveyAccess(fromApi.role) ? "start" : "denied");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        setView("login");
        return;
      }
      setView("offline");
    }
  }, []);

  useEffect(() => {
    bootSession();
  }, [bootSession]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  useLayoutEffect(() => {
    if (view === "form") {
      window.scrollTo(0, formScrollRef.current);
    }
  }, [draft, view, delArmed]);

  useEffect(() => {
    if (!getToken() || !user) return;
    if (view !== "start") return;
    if (!hasSurveyAccess(user.role)) {
      setView("denied");
      return;
    }
    setDraftsStatus("loading");
    let cancelled = false;
    (async () => {
      if (!catalogLoaded.current) {
        try {
          const cat = await api("GET", "/survey/catalog");
          if (!cancelled && cat?.types?.length) {
            setCatalog(catalogFromApi(cat));
            catalogLoaded.current = true;
          }
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) return;
          catalogLoaded.current = true;
        }
      }
      try {
        const list = sortClients(await api("GET", "/lookups/customers"));
        if (!cancelled) {
          setClients(list);
          setClient((prev) => (list.some((c) => c.id === prev) ? prev : (list[0]?.id || "")));
        }
      } catch (e) {
        if (!cancelled && !(e instanceof ApiError && e.status === 401)) {
          setStartErr(e.message || "Could not load clients");
        }
      }
      try {
        const d = await api("GET", "/survey/visits?status=Draft");
        if (!cancelled) {
          setDrafts(Array.isArray(d) ? d : []);
          setDraftsStatus("ready");
        }
      } catch (e) {
        if (!cancelled && !(e instanceof ApiError && e.status === 401)) {
          setDrafts([]);
          setDraftsStatus("ready");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user, view]);

  useEffect(() => {
    if (!client || !getToken() || !allowed) {
      setSites([]);
      setSite("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const raw = await api("GET", `/lookups/sites?customer_id=${encodeURIComponent(client)}`);
        if (cancelled) return;
        const list = Array.isArray(raw) ? raw : [];
        setSites(list);
        setSite((prev) => (list.some((s) => s.id === prev) ? prev : (list[0]?.id || "")));
        if (!list.length) setAddingSite(true);
      } catch (e) {
        if (!cancelled) setStartErr(e.message || "Could not load sites");
      }
    })();
    return () => { cancelled = true; };
  }, [client, allowed]);

  const t = useMemo(() => {
    if (!visit) return null;
    if (visit.totals) {
      return {
        total: visit.totals.total,
        good: visit.totals.good,
        ns: visit.totals.ns,
        oos: visit.totals.oos,
        problems: visit.totals.problems,
      };
    }
    return localTotals(visit.items || []);
  }, [visit]);

  function show(v) {
    setView(v);
  }

  async function login(e) {
    e?.preventDefault?.();
    setAuthErr("");
    setBusy(true);
    try {
      const res = await api("POST", "/auth/login", { body: { email, password }, token: null });
      const fromApi = {
        id: res.user.id,
        name: res.user.name,
        email: res.user.email,
        role: res.user.role,
        access_level: res.user.access_level,
        designation: res.user.designation,
      };
      setSession(res.token, fromApi);
      setUser(fromApi);
      catalogLoaded.current = false;
      if (!hasSurveyAccess(fromApi.role)) show("denied");
      else show("start");
    } catch (err) {
      setAuthErr(err.message || "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  async function refreshVisit(id, prev) {
    const full = await api("GET", `/survey/visits/${id}`);
    const next = visitFromApi(full, catalog, prev);
    setVisit(next);
    return next;
  }

  async function startVisit() {
    setStartErr("");
    if (!site) {
      setStartErr("Add a site for this client first.");
      return;
    }
    const siteRow = sites.find((s) => s.id === site);
    const clientRow = clients.find((c) => c.id === client);
    setBusy(true);
    try {
      const created = await api("POST", "/survey/visits", {
        body: {
          site_id: site,
          technician_id: user.id,
          technician_name: user.name,
          visited_at: new Date(date).toISOString(),
        },
      });
      const next = visitFromApi(created, catalog, {
        client: clientRow?.name,
        clientId: client,
        site: siteRow?.name,
        siteId: site,
      });
      setVisit(next);
      show("visit");
    } catch (err) {
      setStartErr(failedSaveMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function continueVisit(id) {
    setStartErr("");
    setBusy(true);
    try {
      await refreshVisit(id);
      show("visit");
    } catch (err) {
      setStartErr(failedSaveMessage(err, "Could not open visit"));
    } finally {
      setBusy(false);
    }
  }

  async function addSite() {
    const name = newSiteName.trim();
    if (!client || !name) return;
    setStartErr("");
    setBusy(true);
    try {
      const row = await api("POST", "/survey/sites", { body: { customer_id: client, name } });
      setSites((prev) => [...prev, row]);
      setSite(row.id);
      setNewSiteName("");
      setAddingSite(false);
    } catch (err) {
      setStartErr(failedSaveMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function openForm(it) {
    const next = JSON.parse(JSON.stringify(it));
    next.photos = it.photos.slice();
    if (!next.attrs) next.attrs = (EQ.find((x) => x.id === next.eqId) || { attrs: [] }).attrs;
    formScrollRef.current = 0;
    setDraft(next);
    setDelArmed(false);
    setFormErr("");
    show("form");
  }

  function updateDraft(patch) {
    formScrollRef.current = window.scrollY;
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function setSpec(key, val) {
    formScrollRef.current = window.scrollY;
    setDraft((prev) => ({ ...prev, specs: { ...prev.specs, [key]: val } }));
  }

  function patchPhoto(localId, patch) {
    setDraft((prev) => ({
      ...prev,
      photos: prev.photos.map((p) => ((p.localId || p.id) === localId ? { ...p, ...patch } : p)),
    }));
  }

  async function uploadPhoto(lineId, photo) {
    const kind = PHOTO_TYPES.includes(photo.type) ? photo.type : "Other";
    const saved = await api("POST", `/survey/visits/${visit.id}/lines/${lineId}/photos`, {
      body: { kind, name: photo.name || "photo.jpg", dataUrl: photo.dataUrl || photo.url },
    });
    return {
      id: saved.id,
      url: saved.url,
      path: saved.path,
      type: saved.kind || kind,
      name: saved.name,
      status: "saved",
    };
  }

  async function addPhotos(files) {
    formScrollRef.current = window.scrollY;
    const lineId = draft?.uid;
    for (const f of [...files]) {
      let dataUrl;
      try {
        const resized = await fileToJpegDataUrl(f);
        dataUrl = resized.dataUrl;
      } catch {
        setFormErr("Could not read photo");
        continue;
      }
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const pending = {
        localId,
        url: dataUrl,
        dataUrl,
        type: "",
        name: (f.name || "photo").replace(/\.[^.]+$/, ".jpg"),
        status: lineId ? "uploading" : "pending",
      };
      setDraft((prev) => ({ ...prev, photos: [...prev.photos, pending] }));
      if (lineId && visit?.id && !visit.readonly) {
        try {
          const saved = await uploadPhoto(lineId, pending);
          patchPhoto(localId, saved);
        } catch (e) {
          patchPhoto(localId, { status: "failed" });
          setFormErr(failedSaveMessage(e, "Some photos failed. Tap Retry."));
        }
      }
    }
  }

  async function retryPhoto(key) {
    const photo = draft.photos.find((p) => photoKey(p) === key);
    if (!photo || !draft.uid || visit.readonly) return;
    formScrollRef.current = window.scrollY;
    patchPhoto(key, { status: "uploading" });
    try {
      const saved = await uploadPhoto(draft.uid, photo);
      patchPhoto(key, saved);
      setFormErr("");
    } catch (e) {
      patchPhoto(key, { status: "failed" });
      setFormErr(failedSaveMessage(e));
    }
  }

  async function saveEquipment() {
    let err = "";
    if (draft.custom && !draft.name.trim()) err = "Type the equipment name.";
    else if (!draft.cond) err = "Choose the condition.";
    else if (draft.cond === "mixed" && draft.good + draft.ns + draft.oos !== draft.qty)
      err = `Good + Need service + Out of service must add up to ${draft.qty}.`;
    if (err) {
      setFormErr(err);
      return;
    }
    if (visit.readonly) {
      show("visit");
      return;
    }
    setFormErr("");
    const savedDraft = { ...draft, name: draft.name.trim() };
    if (savedDraft.cond !== "mixed") {
      savedDraft.good = 0;
      savedDraft.ns = 0;
      savedDraft.oos = 0;
    }
    if (!needsProblem(savedDraft)) savedDraft.problem = "";
    setBusy(true);
    try {
      let lineId = savedDraft.uid;
      if (lineId) {
        await api("PATCH", `/survey/visits/${visit.id}/lines/${lineId}`, { body: linePayload(savedDraft) });
      } else {
        const row = await api("POST", `/survey/visits/${visit.id}/lines`, { body: linePayload(savedDraft) });
        lineId = row.id;
        savedDraft.uid = lineId;
      }
      const pending = savedDraft.photos.filter((p) => !p.id && p.status !== "saved");
      for (const p of pending) {
        try {
          await uploadPhoto(lineId, p);
        } catch {
          /* line is saved; visit screen shows server photos */
        }
      }
      await refreshVisit(visit.id, visit);
      setFormErr("");
      setDraft(null);
      show("visit");
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setFormErr(e.message);
      else setFormErr(failedSaveMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteEquipment() {
    if (!delArmed) {
      formScrollRef.current = window.scrollY;
      setDelArmed(true);
      return;
    }
    if (!draft.uid) {
      show("visit");
      return;
    }
    setBusy(true);
    try {
      await api("DELETE", `/survey/visits/${visit.id}/lines/${draft.uid}`);
      await refreshVisit(visit.id, visit);
      show("visit");
    } catch (e) {
      setFormErr(failedSaveMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function deletePhoto(key) {
    formScrollRef.current = window.scrollY;
    const photo = draft.photos.find((p) => photoKey(p) === key);
    if (!photo) return;
    const deletedId = photo.id || null;
    if (deletedId) deletedPhotoIds.current.add(deletedId);
    if (deletedId) {
      try {
        await api("DELETE", `/survey/photos/${deletedId}`);
      } catch (e) {
        setFormErr(failedSaveMessage(e));
        return;
      }
    }
    setDraft((prev) => ({
      ...prev,
      photos: prev.photos.filter((p) => photoKey(p) !== key && p.id !== deletedId),
    }));
    if (deletedId && visit?.id && draft.uid) {
      const next = await refreshVisit(visit.id, visit);
      const item = next.items.find((i) => i.uid === draft.uid);
      setDraft((prev) => ({
        ...prev,
        photos: (item?.photos || prev.photos).filter((p) => (
          !deletedPhotoIds.current.has(p.id) && p.id !== deletedId && photoKey(p) !== key
        )),
      }));
    }
  }

  async function setPhotoType(key, type) {
    formScrollRef.current = window.scrollY;
    const photo = draft.photos.find((p) => photoKey(p) === key);
    const previous = photo?.type || "";
    setDraft((prev) => ({
      ...prev,
      photos: prev.photos.map((p) => (photoKey(p) === key ? { ...p, type } : p)),
    }));
    if (!photo?.id || visit?.readonly) return;
    try {
      const saved = await api("PATCH", `/survey/photos/${photo.id}`, { body: { kind: type || "Other" } });
      setDraft((prev) => ({
        ...prev,
        photos: prev.photos.map((p) => (
          photoKey(p) === key
            ? { ...p, type: saved.kind || type, id: saved.id, url: saved.url || p.url }
            : p
        )),
      }));
    } catch (e) {
      setDraft((prev) => ({
        ...prev,
        photos: prev.photos.map((p) => (photoKey(p) === key ? { ...p, type: previous } : p)),
      }));
      setFormErr(failedSaveMessage(e));
    }
  }

  async function finishSave() {
    setFinishErr("");
    if (!visit?.items.length) {
      setFinishErr("No equipment has been added to this visit.");
      return;
    }
    setBusy(true);
    try {
      const submitted = await api("POST", `/survey/visits/${visit.id}/submit`);
      setVisit(visitFromApi(submitted, catalog, visit));
      show("done");
    } catch (e) {
      setFinishErr(failedSaveMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    if (view === "pick" && pickCat !== null && !query) {
      setPickCat(null);
      return;
    }
    if (view === "form" && !draft?.uid) {
      show("pick");
      return;
    }
    show("visit");
  }

  function renderPickBody() {
    const q = query.trim().toLowerCase();
    if (q) {
      const words = q.split(/\s+/);
      const hits = EQ.filter((e) => {
        const h = (e.name + " " + e.alias).toLowerCase();
        return words.every((w) => h.includes(w));
      }).slice(0, 40);
      return {
        sub: `${hits.length} result${hits.length === 1 ? "" : "s"} in all categories`,
        body: hits.length ? (
          <ul className="rows">
            {hits.map(eqRow)}
            {otherRow()}
          </ul>
        ) : (
          <>
            <div className="empty">
              <b>Nothing matches &quot;{query.trim()}&quot;</b>
              Check the spelling, or add it as other equipment.
            </div>
            <ul className="rows">{otherRow()}</ul>
          </>
        ),
      };
    }
    if (pickCat === null) {
      return {
        sub: "Choose a category or search",
        body: (
          <div className="cats">
            {CATS.map((c, i) => (
              <button key={c} className="cat" type="button" onClick={() => setPickCat(i)}>
                {c}
                <small>{EQ.filter((e) => e.cats.includes(i)).length} types</small>
              </button>
            ))}
          </div>
        ),
      };
    }
    const list = EQ.filter((e) => e.cats.includes(pickCat));
    return {
      sub: CATS[pickCat],
      body: (
        <>
          <button className="crumb" type="button" onClick={() => setPickCat(null)}>
            ‹ All categories
          </button>
          <ul className="rows">
            {list.map(eqRow)}
            {otherRow()}
          </ul>
        </>
      ),
    };
  }

  function eqRow(e) {
    return (
      <li key={e.id}>
        <button type="button" onClick={() => pickEq(e)}>
          {e.name}
          {e.alias ? <small>{e.alias}</small> : null}
        </button>
      </li>
    );
  }

  function otherRow() {
    return (
      <li key="OTHER">
        <button className="other" type="button" onClick={() => pickEq(null)}>
          + Other equipment
          <small>Not in the list? Type its name.</small>
        </button>
      </li>
    );
  }

  function pickEq(eq) {
    const other = eq || otherTypeForCategory(EQ, CATS, pickCat);
    openForm({
      uid: null,
      eqId: other ? other.id : "CK-050",
      name: eq ? eq.name : "",
      custom: !eq,
      cat: eq ? CATS[eq.cats[0]] : pickCat !== null ? CATS[pickCat] : "Other",
      attrs: other ? other.attrs : [],
      specs: {},
      qty: 1,
      cond: null,
      good: 0,
      ns: 0,
      oos: 0,
      problem: "",
      photos: [],
    });
  }

  const pick = view === "pick" ? renderPickBody() : null;
  const readonly = !!visit?.readonly;

  if (view === "boot") {
    return (
      <div className="app app-auth">
        <section className="view on auth-view">
          <div className="auth-panel">
            <div className="auth-mark" aria-hidden="true">C</div>
            <p className="loading" style={{ textAlign: "center" }}>Checking session…</p>
          </div>
        </section>
      </div>
    );
  }

  if (view === "offline") {
    return (
      <div className="app app-auth">
        <section className="view on auth-view">
          <div className="auth-panel">
            <div className="auth-mark" aria-hidden="true">C</div>
            <p className="auth-brand">CULINOVA</p>
            <h1 className="auth-title">Cannot reach the server</h1>
            <p className="auth-sub">Your session is still saved. Try again when the API is available.</p>
            <button className="btn big" type="button" onClick={bootSession}>
              Retry
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (view === "login") {
    return (
      <div className="app app-auth">
        <section className="view on auth-view">
          <form className="auth-panel" onSubmit={login}>
            <div className="auth-mark" aria-hidden="true">C</div>
            <p className="auth-brand">CULINOVA</p>
            <h1 className="auth-title">Technician survey</h1>
            <p className="auth-sub">Sign in to record equipment on site.</p>
            <div className="field">
              <label className="f" htmlFor="login-email">Email</label>
              <input
                className="in"
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="f" htmlFor="login-pass">Password</label>
              <input
                className="in"
                id="login-pass"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {authErr ? <div className="err" role="alert">{authErr}</div> : null}
            <button className="btn big" type="submit" disabled={busy} aria-busy={busy || undefined}>
              {busy ? <Spinner /> : null}
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </section>
      </div>
    );
  }

  if (view === "denied") {
    return (
      <div className="app app-auth">
        <section className="view on auth-view">
          <div className="auth-panel">
            <div className="auth-mark" aria-hidden="true">C</div>
            <p className="auth-brand">CULINOVA</p>
            <h1 className="auth-title">No access</h1>
            <p className="auth-sub">You do not have access to Equipment Survey.</p>
            <UserBar user={user} onLogout={logout} />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <section className={`view${view === "start" ? " on" : ""}`} id="v-start">
        <header className="bar">
          <h1>
            <span className="brand">CULINOVA</span>
            <small>Equipment condition survey</small>
          </h1>
        </header>
        <div className="pad">
          <UserBar user={user} onLogout={logout} />
          {draftsStatus !== "ready" ? (
            <p className="hint" id="drafts-status">Checking for open visits...</p>
          ) : drafts.length ? (
            <div className="card">
              <h2>Continue visit</h2>
              {drafts.map((d) => (
                <button
                  key={d.id}
                  className="item"
                  type="button"
                  onClick={() => continueVisit(d.id)}
                >
                  <div className="top">
                    <b>{d.site?.name || "Site"}</b>
                    <span className="q">{d.totals?.total ?? ""}</span>
                  </div>
                  <p>
                    {d.site?.customer?.name || ""} · {fmtDate(d.visited_at)}
                  </p>
                </button>
              ))}
            </div>
          ) : null}
          <div className="card">
            <h2>Start a new visit</h2>
            <div className="field">
              <label className="f" htmlFor="s-client">Client</label>
              <select
                className="in"
                id="s-client"
                value={client}
                onChange={(e) => setClient(e.target.value)}
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{clientLabel(c)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="f" htmlFor="s-site">Site</label>
              <select
                className="in"
                id="s-site"
                value={site}
                onChange={(e) => setSite(e.target.value)}
              >
                {!sites.length ? (
                  <option value="">No sites yet — add one below</option>
                ) : (
                  sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.label || s.name}</option>
                  ))
                )}
              </select>
              {!sites.length ? (
                <p className="hint">This client has no kitchen/building yet. Type a site name and save, then start the visit.</p>
              ) : null}
              {addingSite ? (
                <div style={{ marginTop: 10 }}>
                  <input
                    className="in"
                    placeholder="Site name"
                    value={newSiteName}
                    onChange={(e) => setNewSiteName(e.target.value)}
                  />
                  <ActionBtn className="btn" style={{ marginTop: 8 }} busy={busy} idle="Save site" busyLabel="Saving site…" onClick={addSite} />
                </div>
              ) : (
                <button className="btn ghost" type="button" style={{ marginTop: 8 }} onClick={() => setAddingSite(true)}>
                  + Add site
                </button>
              )}
            </div>
            <div className="field">
              <label className="f" htmlFor="s-tech">Technician</label>
              <input className="in" id="s-tech" value={user?.name || ""} readOnly />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="f" htmlFor="s-date">Date and time</label>
              <input
                className="in"
                type="datetime-local"
                id="s-date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>
          {startErr ? <div className="err" role="alert">{startErr}</div> : null}
        </div>
        <div className="dock">
          <ActionBtn busy={busy} idle="Start visit" busyLabel="Starting visit…" onClick={startVisit} />
        </div>
      </section>

      <section className={`view${view === "visit" ? " on" : ""}`} id="v-visit">
        <header className="bar">
          <h1>
            {visit?.site}
            {visit ? (
              <small>
                {visit.client}, {fmtDate(visit.date)}, {visit.tech}
              </small>
            ) : null}
          </h1>
        </header>
        <div className="sticky">{t ? <Plate t={t} /> : null}</div>
        <div className="pad" style={{ paddingTop: 4 }}>
          {!visit?.items.length ? (
            <div className="empty">
              <b>No equipment added yet</b>
              Walk through the kitchen and add each equipment type as you see it.
            </div>
          ) : (
            [...visit.items].reverse().map((it) => {
              const [g, s, o] = split(it);
              const sp = specText(it, DEFS);
              return (
                <button
                  key={it.uid}
                  className="item"
                  type="button"
                  onClick={() => openForm(it)}
                >
                  <div className="top">
                    <b>{it.name}</b>
                    <span className="q">× {it.qty}</span>
                  </div>
                  {sp ? <p>{sp}</p> : null}
                  {it.problem ? <p>{it.problem}</p> : null}
                  <div className="tags">
                    {g ? <span className="tag g">Good {g}</span> : null}
                    {s ? <span className="tag s">Need service {s}</span> : null}
                    {o ? <span className="tag o">OOS {o}</span> : null}
                    {it.photos.length ? (
                      <span className="tag p">
                        {it.photos.length} photo{it.photos.length > 1 ? "s" : ""}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="dock">
          {!readonly ? (
            <button
              className="btn big"
              type="button"
              onClick={() => {
                setPickCat(null);
                setQuery("");
                show("pick");
              }}
            >
              + Add equipment
            </button>
          ) : null}
          <button className="btn ghost" type="button" onClick={() => { setFinishErr(""); show("finish"); }}>
            Finish visit
          </button>
        </div>
      </section>

      <section className={`view${view === "pick" ? " on" : ""}`} id="v-pick">
        <header className="bar">
          <button className="back" type="button" aria-label="Back" onClick={goBack}>
            ‹
          </button>
          <h1>
            Add equipment
            <small>{pick?.sub}</small>
          </h1>
        </header>
        <div className="searchwrap">
          <label className="sr" htmlFor="q">Search equipment</label>
          <input
            className="in"
            id="q"
            type="search"
            placeholder="Search all equipment, e.g. fryer, ice machine"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="pad" style={{ paddingTop: 0 }}>
          {pick?.body}
        </div>
      </section>

      <section className={`view${view === "form" ? " on" : ""}`} id="v-form">
        <header className="bar">
          <button className="back" type="button" aria-label="Back" onClick={goBack}>
            ‹
          </button>
          <h1>
            {draft ? (draft.custom ? "Other equipment" : draft.name) : ""}
            {draft ? <small>{draft.cat}</small> : null}
          </h1>
        </header>
        <div className="pad">
          {draft ? (
            <EquipmentFormBody
              draft={draft}
              delArmed={delArmed}
              defs={DEFS}
              readonly={readonly}
              photoBusy={!!draft?.photos?.some((p) => p.status === "uploading")}
              onUpdate={updateDraft}
              onSpec={setSpec}
              onDeletePhoto={deletePhoto}
              onPhotoType={setPhotoType}
              onRetryPhoto={retryPhoto}
              onDelete={deleteEquipment}
            />
          ) : null}
        </div>
        <div className="dock">
          <div>
            {formErr ? (
              <div className="err" role="alert">
                {formErr}
              </div>
            ) : null}
          </div>
          {!readonly ? (
            <button className="btn big" type="button" disabled={busy} onClick={saveEquipment} aria-busy={busy || undefined}>
              {busy ? <Spinner /> : null}
              {busy ? "Saving…" : "Save equipment"}
            </button>
          ) : null}
        </div>
      </section>

      <section className={`view${view === "finish" ? " on" : ""}`} id="v-finish">
        <header className="bar">
          <button className="back" type="button" aria-label="Back" onClick={goBack}>
            ‹
          </button>
          <h1>
            Visit summary
            {visit ? (
              <small>
                {visit.client}, {visit.site}
              </small>
            ) : null}
          </h1>
        </header>
        <div className="pad">
          {visit && t ? (
            <>
              <Plate t={t} />
              <div className="card" style={{ marginTop: 14 }}>
                <h2>Equipment with problems: {t.problems}</h2>
                {visit.items.filter((it) => {
                  const [, s, o] = split(it);
                  return s + o > 0;
                }).length ? (
                  visit.items
                    .filter((it) => {
                      const [, s, o] = split(it);
                      return s + o > 0;
                    })
                    .map((it) => {
                      const [, s, o] = split(it);
                      return (
                        <div
                          key={it.uid}
                          style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}
                        >
                          <b>{it.name}</b>
                          <div className="tags" style={{ marginTop: 6 }}>
                            {s ? <span className="tag s">Need service {s}</span> : null}
                            {o ? <span className="tag o">OOS {o}</span> : null}
                            <span className="tag p">
                              {it.photos.length} photo{it.photos.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          {it.problem ? (
                            <p className="hint">{it.problem}</p>
                          ) : (
                            <p className="hint">No observation written.</p>
                          )}
                        </div>
                      );
                    })
                ) : (
                  <p className="hint" style={{ margin: 0 }}>
                    Nothing reported. All equipment is in good condition.
                  </p>
                )}
              </div>
              {!visit.items.length ? (
                <div className="err">No equipment has been added to this visit.</div>
              ) : null}
              {finishErr ? <div className="err" role="alert">{finishErr}</div> : null}
            </>
          ) : null}
        </div>
        <div className="dock">
          {!readonly ? (
            <button className="btn big" type="button" disabled={busy} onClick={finishSave} aria-busy={busy || undefined}>
              {busy ? <Spinner /> : null}
              {busy ? "Saving visit…" : "Save visit"}
            </button>
          ) : null}
        </div>
      </section>

      <section className={`view${view === "done" ? " on" : ""}`} id="v-done">
        <header className="bar">
          <h1>
            <span className="brand">CULINOVA</span>
            <small>Equipment condition survey</small>
          </h1>
        </header>
        <div className="pad">
          {visit && t ? (
            <div className="card">
              <h2>Visit saved</h2>
              <Plate t={t} />
              <div className="path">
                {visit.client} › {visit.site} › {fmtDate(visit.date)}
              </div>
              <p className="hint">
                {visit.items.length} equipment record{visit.items.length === 1 ? "" : "s"} and{" "}
                {visit.items.reduce((n, i) => n + i.photos.length, 0)} photos saved by {visit.tech}.
              </p>
            </div>
          ) : null}
        </div>
        <div className="dock">
          <button
            className="btn big"
            type="button"
            onClick={() => {
              setVisit(null);
              setDate(nowLocal());
              setFinishErr("");
              show("start");
              api("GET", "/survey/visits?status=Draft").then((d) => setDrafts(Array.isArray(d) ? d : [])).catch(() => {});
            }}
          >
            Start another visit
          </button>
        </div>
      </section>

      <input
        className="sr"
        type="file"
        id="cam"
        ref={camRef}
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        onChange={(e) => {
          addPhotos(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        className="sr"
        type="file"
        id="gal"
        ref={galRef}
        accept="image/*"
        multiple
        tabIndex={-1}
        onChange={(e) => {
          addPhotos(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
