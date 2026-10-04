import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, LogOut, Pencil, Search, Trash2 } from "lucide-react";
import "./App.css";
import { api, ApiError, clearSession, getToken, isNetworkError, setOnUnauthorized, setSession } from "./api";
import { canDo, hasSurveyAccess, isOfficeAdmin } from "./constants";
import { Logo } from "./Logo";
import { Layout, MenuButton } from "./Layout";
import { DashboardPage } from "./DashboardPage";
import { UsersPage } from "./UsersPage";
import { NotificationsPage } from "./NotificationsPage";
import { InboxBell } from "./InboxBell";

const fmt = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const fmtTime = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

function splitLine(line) {
  const qty = Number(line.qty) || 0;
  const cond = line.condition;
  if (cond === "good") return { qty, good: qty, ns: 0, oos: 0 };
  if (cond === "ns") return { qty, good: 0, ns: qty, oos: 0 };
  if (cond === "oos") return { qty, good: 0, ns: 0, oos: qty };
  return {
    qty,
    good: Number(line.qty_good) || 0,
    ns: Number(line.qty_ns) || 0,
    oos: Number(line.qty_oos) || 0,
  };
}

function visitTotals(v) {
  if (v?.totals) {
    return {
      total: v.totals.total || 0,
      good: v.totals.good || 0,
      ns: v.totals.ns || 0,
      oos: v.totals.oos || 0,
      prob: v.totals.problems || 0,
    };
  }
  const lines = v?.lines || [];
  return lines.reduce(
    (t, line) => {
      const s = splitLine(line);
      return {
        total: t.total + s.qty,
        good: t.good + s.good,
        ns: t.ns + s.ns,
        oos: t.oos + s.oos,
        prob: t.prob + (s.ns + s.oos > 0 ? 1 : 0),
      };
    },
    { total: 0, good: 0, ns: 0, oos: 0, prob: 0 }
  );
}

function lineName(line) {
  const attrs = line.attrs && typeof line.attrs === "object" && !Array.isArray(line.attrs) ? line.attrs : {};
  const custom = String(attrs["Custom Equipment Name"] || "").trim();
  return custom || line.type_name || "Equipment";
}

function specText(line, defMap) {
  const attrs = line.attrs && typeof line.attrs === "object" && !Array.isArray(line.attrs) ? line.attrs : {};
  return Object.entries(attrs)
    .filter(([k, v]) => v !== "" && v != null && !k.endsWith("__other") && k !== "Custom Equipment Name")
    .map(([k, v]) => {
      const lab = defMap[k]?.label || defMap[k]?.l || k;
      const shown = v === "Other" && attrs[k + "__other"] ? attrs[k + "__other"] : v;
      return `${lab}: ${shown}`;
    })
    .join(", ");
}

function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function sessionUser(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    name: raw.name,
    email: raw.email,
    role: raw.role,
    access_level: raw.access_level,
    designation: raw.designation,
  };
}

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "AD";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function Plate({ t }) {
  return (
    <div className="plate">
      <div>
        <b>{t.total}</b>
        <span>Total equipment</span>
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
      <div>
        <b>{t.prob}</b>
        <span>Types with problems</span>
      </div>
    </div>
  );
}

function LoadingLine({ text = "Loading…" }) {
  return <p className="loading">{text}</p>;
}

function reachMessage(err, fallback = "Could not load.") {
  if (!err) return fallback;
  if (isNetworkError(err)) return "Cannot reach the server";
  if (err instanceof ApiError && err.status >= 500) return "Cannot reach the server";
  return err.message || fallback;
}

function ErrorLine({ message, onRetry }) {
  return (
    <p className="err" role="alert">
      {message || "Could not load."}{" "}
      {onRetry ? (
        <button type="button" className="linkish" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </p>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("boot");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [page, setPage] = useState("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [editVisit, setEditVisit] = useState(null);
  const [authErr, setAuthErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [sel, setSel] = useState({ customerId: null, siteId: null, visitId: null });
  const [mobilePane, setMobilePane] = useState("clients");
  const [filter, setFilter] = useState("all");
  const [find, setFind] = useState("");
  const [lightbox, setLightbox] = useState(null);
  const dialogRef = useRef(null);

  const [clients, setClients] = useState([]);
  const [sites, setSites] = useState([]);
  const [visits, setVisits] = useState([]);
  const [attrDefs, setAttrDefs] = useState([]);
  const [treeStatus, setTreeStatus] = useState("idle");
  const [treeErr, setTreeErr] = useState("");
  const [visitFull, setVisitFull] = useState(null);
  const [visitStatus, setVisitStatus] = useState("idle");
  const [visitErr, setVisitErr] = useState("");
  const visitCache = useRef(new Map());

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setView("login");
    setClients([]);
    setSites([]);
    setVisits([]);
    setVisitFull(null);
    visitCache.current.clear();
    setPage("dashboard");
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
      const fromApi = sessionUser(me);
      setSession(getToken() || token, fromApi);
      setUser(fromApi);
      setView(hasSurveyAccess(fromApi.role) ? "app" : "denied");
      setPage("dashboard");
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

  const loadTree = useCallback(async () => {
    setTreeStatus("loading");
    setTreeErr("");
    try {
      const [cust, siteList, visitList, cat] = await Promise.all([
        api("GET", "/lookups/customers"),
        api("GET", "/lookups/sites"),
        api("GET", "/survey/visits"),
        api("GET", "/survey/catalog").catch(() => null),
      ]);
      setClients(Array.isArray(cust) ? cust : []);
      setSites(Array.isArray(siteList) ? siteList : []);
      const list = Array.isArray(visitList) ? visitList.slice() : [];
      list.sort((a, b) => String(b.visited_at || "").localeCompare(String(a.visited_at || "")));
      setVisits(list);
      setAttrDefs(Array.isArray(cat?.attr_defs) ? cat.attr_defs : []);
      setTreeStatus("ready");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setTreeErr(reachMessage(e, "Could not load surveys"));
      setTreeStatus("error");
    }
  }, []);

  useEffect(() => {
    if (view === "app" && user) loadTree();
  }, [view, user, loadTree]);

  useEffect(() => {
    if (view !== "app" || !user) return;
    let cancelled = false;
    api("GET", "/notifications")
      .then((data) => {
        if (!cancelled) setUnread(Number(data?.unread) || 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [view, user, page]);

  const loadVisit = useCallback(async (id, { force } = {}) => {
    if (!id) {
      setVisitFull(null);
      setVisitStatus("idle");
      return;
    }
    if (!force && visitCache.current.has(id)) {
      setVisitFull(visitCache.current.get(id));
      setVisitStatus("ready");
      setVisitErr("");
      return;
    }
    setVisitStatus("loading");
    setVisitErr("");
    try {
      const full = await api("GET", `/survey/visits/${id}`);
      visitCache.current.set(id, full);
      setVisitFull(full);
      setVisitStatus("ready");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setVisitFull(null);
      setVisitErr(reachMessage(e, "Could not load visit"));
      setVisitStatus("error");
    }
  }, []);

  useEffect(() => {
    if (view !== "app") return;
    if (sel.visitId) loadVisit(sel.visitId);
    else {
      setVisitFull(null);
      setVisitStatus("idle");
    }
  }, [view, sel.visitId, loadVisit]);

  const defMap = useMemo(
    () => Object.fromEntries((attrDefs || []).map((d) => [d.key, d])),
    [attrDefs]
  );

  const treeData = useMemo(() => {
    const sitesByCust = {};
    for (const s of sites) {
      const cid = s.customer_id;
      if (!cid) continue;
      (sitesByCust[cid] ||= []).push(s);
    }
    const visitsBySite = {};
    for (const v of visits) {
      const sid = v.site_id || v.site?.id;
      if (!sid) continue;
      (visitsBySite[sid] ||= []).push(v);
    }
    return clients
      .map((c) => {
        const cSites = (sitesByCust[c.id] || []).map((s) => ({
          ...s,
          visits: visitsBySite[s.id] || [],
        }));
        if (!cSites.length) return null;
        return { ...c, sites: cSites };
      })
      .filter(Boolean);
  }, [clients, sites, visits]);

  useEffect(() => {
    if (treeStatus !== "ready" || !treeData.length) return;
    const still = treeData.some((c) => c.id === sel.customerId && c.sites.some((s) => s.id === sel.siteId));
    if (still) return;
    const c = treeData[0];
    const s = c.sites[0];
    setSel({ customerId: c.id, siteId: s.id, visitId: null });
    setFilter("all");
  }, [treeStatus, treeData, sel.customerId, sel.siteId]);

  const client = treeData.find((c) => c.id === sel.customerId) || null;
  const site = client?.sites.find((s) => s.id === sel.siteId) || null;

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (lightbox) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [lightbox]);

  function go(customerId, siteId, visitId, { stayOnList } = {}) {
    setSel({ customerId, siteId, visitId });
    setFilter("all");
    if (stayOnList) setMobilePane("clients");
    else if (siteId) setMobilePane("detail");
    else setMobilePane("clients");
  }

  async function saveVisitEdit(e) {
    e.preventDefault();
    if (!editVisit?.id) return;
    if (!canDo(user, "update")) return notify.err("Your access level cannot edit surveys");
    setBusy(true);
    try {
      await api("PATCH", `/survey/visits/${editVisit.id}`, {
        body: {
          visited_at: new Date(editVisit.visited_at).toISOString(),
          notes: editVisit.notes,
          technician_name: editVisit.technician_name,
        },
      });
      notify.ok("Survey updated");
      setEditVisit(null);
      visitCache.current.delete(editVisit.id);
      await loadTree();
      if (sel.visitId === editVisit.id) await loadVisit(editVisit.id, { force: true });
    } catch (err) {
      notify.err(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeVisit(id) {
    if (!canDo(user, "delete")) return notify.err("Your access level cannot delete surveys");
    if (!window.confirm("Delete this survey visit and its photos? This cannot be undone.")) return;
    try {
      await api("DELETE", `/survey/visits/${id}`);
      notify.ok("Survey deleted");
      visitCache.current.delete(id);
      if (sel.visitId === id) setSel((s) => ({ ...s, visitId: null }));
      await loadTree();
    } catch (err) {
      notify.err(err.message);
    }
  }

  async function login(e) {
    e?.preventDefault?.();
    setAuthErr("");
    setBusy(true);
    try {
      const res = await api("POST", "/auth/login", { body: { email, password }, token: null });
      const fromApi = sessionUser(res.user);
      setSession(res.token, fromApi);
      setUser(fromApi);
      setPage("dashboard");
      setView(hasSurveyAccess(fromApi.role) ? "app" : "denied");
      notify.ok(`Welcome, ${fromApi.name}`);
    } catch (err) {
      setAuthErr(err.message || "Could not sign in");
      notify.err(err.message || "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  async function onPhotoError(photo) {
    if (!sel.visitId || photo._retried) return;
    try {
      const full = await api("GET", `/survey/visits/${sel.visitId}`);
      visitCache.current.set(sel.visitId, full);
      setVisitFull(full);
      const fresh = (full.lines || []).flatMap((l) => l.photos || []).find((p) => p.id === photo.id);
      if (fresh?.url) setLightbox((prev) => (prev ? { ...prev, url: fresh.url, _retried: true } : prev));
    } catch {
      /* keep broken image */
    }
  }

  const q = find.trim().toLowerCase();

  const filteredTree = useMemo(() => {
    return treeData
      .map((c) => {
        const clientName = `${c.label || ""} ${c.name || ""}`.toLowerCase();
        const cSites = (c.sites || []).filter((s) => {
          if (!q) return true;
          const siteName = `${s.label || ""} ${s.name || ""}`.toLowerCase();
          return clientName.includes(q) || siteName.includes(q);
        });
        if (!cSites.length) return null;
        return { ...c, sites: cSites };
      })
      .filter(Boolean);
  }, [treeData, q]);

  const officeKpis = useMemo(() => {
    let drafts = 0;
    let submitted = 0;
    let ns = 0;
    let oos = 0;
    for (const v of visits) {
      if (v.status === "Draft") drafts += 1;
      else submitted += 1;
      ns += Number(v.totals?.ns || 0);
      oos += Number(v.totals?.oos || 0);
    }
    return { total: visits.length, drafts, submitted, ns, oos };
  }, [visits]);

  const tree = filteredTree.map((c) => {
    const selected = c.id === sel.customerId;
    const visitCount = (c.sites || []).reduce((n, s) => n + (s.visits?.length || 0), 0);
      return (
      <div key={c.id} className={`nav-client${selected ? " open" : ""}`}>
                <button
                  type="button"
          className={`nav-client-btn${selected ? " on" : ""}`}
          onClick={() => go(c.id, c.sites[0]?.id || null, null, { stayOnList: true })}
        >
          <span>
            <b>{c.label || c.name}</b>
            <small>
              {c.sites.length} site{c.sites.length === 1 ? "" : "s"} · {visitCount} visit{visitCount === 1 ? "" : "s"}
            </small>
          </span>
                </button>
        {selected ? (
          <div className="nav-sites">
            {c.sites.map((s) => (
                      <button
                key={s.id}
                        type="button"
                className={sel.siteId === s.id ? "on" : ""}
                onClick={() => go(c.id, s.id, null)}
                      >
                <span>{s.label || s.name}</span>
                <i>{s.visits.length}</i>
                      </button>
            ))}
          </div>
        ) : null}
      </div>
      );
    });

  let main;
  if (treeStatus === "loading" || treeStatus === "idle") {
    main = <LoadingLine text="Loading surveys…" />;
  } else if (treeStatus === "error") {
    main = <ErrorLine message={treeErr} onRetry={loadTree} />;
  } else if (!client || !site) {
    main = <p className="empty">No sites with survey data yet.</p>;
  } else if (sel.visitId === null) {
    main = (
      <>
        <button type="button" className="back-link mobile-only" onClick={() => setMobilePane("clients")}>
          <ChevronLeft size={18} /> All clients
        </button>
        <p className="crumbs">{client.label || client.name}</p>
        <h1>{site.label || site.name}</h1>
        <p className="meta">
          {site.visits.length} visit{site.visits.length === 1 ? "" : "s"} at this site. Open a card to read equipment and photos.
        </p>
        {site.visits.length ? (
          <div className="visit-cards">
            {site.visits.map((v) => {
              const t = visitTotals(v);
                return (
                <button
                  key={v.id}
                  type="button"
                  className="visit-card"
                  onClick={() => go(sel.customerId, sel.siteId, v.id)}
                >
                  <div className="visit-card-top">
                    <div>
                      <b>{fmt(v.visited_at)}</b>
                      <small>
                        {fmtTime(v.visited_at)} · {v.technician_name || "Technician"}
                      </small>
                    </div>
                    <span className={`status-pill ${v.status === "Submitted" ? "ok" : "draft"}`}>
                      {v.status || "Draft"}
                    </span>
                  </div>
                  <div className="visit-mini">
                    <span>{t.total} total</span>
                    <span className="g">{t.good} good</span>
                    <span className="s">{t.ns} service</span>
                    <span className="o">{t.oos} OOS</span>
                  </div>
                </button>
                );
              })}
        </div>
        ) : (
          <p className="empty">No visits yet at this site.</p>
        )}
      </>
    );
  } else if (visitStatus === "loading" || visitStatus === "idle") {
    main = <LoadingLine text="Loading visit…" />;
  } else if (visitStatus === "error") {
    main = <ErrorLine message={visitErr} onRetry={() => loadVisit(sel.visitId, { force: true })} />;
  } else {
    const v = visitFull;
    const t = visitTotals(v);
    const lines = v.lines || [];
    const rows = lines
      .map((line) => ({ line, split: splitLine(line) }))
      .filter(
        ({ line, split }) =>
          filter === "all" ||
          (filter === "ns" && split.ns) ||
          (filter === "oos" && split.oos) ||
          (filter === "photos" && (line.photos || []).length)
      );
    const F = [
      ["all", `All (${lines.length})`],
      ["ns", "Need service"],
      ["oos", "Out of service"],
      ["photos", "With photos"],
    ];
    const photoCount = lines.reduce((n, line) => n + (line.photos || []).length, 0);
    main = (
      <>
        <button type="button" className="back-link" onClick={() => go(sel.customerId, sel.siteId, null)}>
          <ChevronLeft size={18} /> Back to visits
        </button>
        <p className="crumbs">
          {client.label || client.name} · {site.label || site.name}
        </p>
        <h1>Visit on {fmt(v.visited_at)}</h1>
        <p className="meta">
          {v.technician_name || "Technician"} · {fmtTime(v.visited_at)} · {lines.length} records · {photoCount} photos
          {v.status ? ` · ${v.status}` : ""}
        </p>
        <div className="toolbar">
          {v.status === "Draft" && canDo(user, "update") ? (
            <button
              type="button"
              className="pbtn"
              onClick={() =>
                setEditVisit({
                  id: v.id,
                  visited_at: toLocalInput(v.visited_at),
                  notes: v.notes || "",
                  technician_name: v.technician_name || "",
                })
              }
            >
              <Pencil size={16} /> Edit visit
            </button>
          ) : null}
          {canDo(user, "delete") ? (
            <button type="button" className="pbtn danger" onClick={() => removeVisit(v.id)}>
              <Trash2 size={16} /> Delete visit
            </button>
          ) : null}
        </div>
        <Plate t={t} />
        <div className="filters" role="group" aria-label="Filter equipment">
          {F.map(([k, l]) => (
            <button
              key={k}
              type="button"
              data-filter={k}
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="eq-list">
              {rows.length ? (
            rows.map(({ line, split }) => {
              const photos = line.photos || [];
              const specs = specText(line, defMap);
              return (
                <article key={line.id} className="eq-card">
                  <div className="eq-head">
                    <div>
                      <b>{lineName(line)}</b>
                      <small>{line.category}</small>
                    </div>
                    <strong>× {split.qty}</strong>
                  </div>
                  {specs ? <p className="eq-specs">{specs}</p> : null}
                  <div className="visit-mini">
                    {split.good ? <span className="g">Good {split.good}</span> : null}
                    {split.ns ? <span className="s">Need service {split.ns}</span> : null}
                    {split.oos ? <span className="o">OOS {split.oos}</span> : null}
                  </div>
                  {line.notes ? (
                    <p className="eq-note">
                      <b>Observation:</b> {line.notes}
                    </p>
                  ) : null}
                  {photos.length ? (
                            <div className="photos">
                      {photos.map((p) => (
                                <button
                          key={p.id}
                                  className="ph"
                                  type="button"
                          onClick={() =>
                            setLightbox({
                              title: `${lineName(line)}, ${p.kind || "Photo"}`,
                              type: p.kind || "Other",
                              url: p.url,
                              id: p.id,
                            })
                          }
                        >
                          <img src={p.url} alt={p.kind || "Photo"} />
                          <span>{p.kind || "Photo"}</span>
                                </button>
                              ))}
                            </div>
                    ) : null}
                </article>
              );
            })
          ) : (
            <p className="empty">No equipment matches this filter.</p>
          )}
        </div>
      </>
    );
  }

  const treeNodes = tree;

  const staff = isOfficeAdmin(user?.role);

  function goPage(next) {
    setPage(next);
    if (next === "surveys") setMobilePane("clients");
  }

  const header = (
    <header className="top">
      <MenuButton navOpen={navOpen} onToggle={() => setNavOpen((v) => !v)} />
      <span className="sec">{page === "surveys" ? "Surveys" : page === "dashboard" ? "Dashboard" : "Survey office"}</span>
      {user && view !== "login" && view !== "boot" ? (
        <div className="who">
          <span className="avatar">{initials(user.name)}</span>
          <span className="who-name">
            {user.name} · {user.role}
          </span>
          <InboxBell unread={unread} onUnread={setUnread} onSeeAll={() => goPage("notifications")} />
          <button className="logout-btn" type="button" onClick={logout}>
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      ) : null}
    </header>
  );

  if (view === "boot") {
    return (
      <div className="auth-page">
        <div className="logincard">
          <Logo className="logo-lg" />
          <p className="loading">Checking session…</p>
        </div>
      </div>
    );
  }

  if (view === "offline") {
    return (
      <div className="auth-page">
        <div className="logincard">
          <Logo className="logo-lg" />
          <h1>Cannot reach the server</h1>
          <p className="meta">Your session is still saved. Try again when the API is available.</p>
          <button className="signin" type="button" onClick={bootSession}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (view === "login") {
    return (
      <div className="auth-page">
        <form className="logincard" onSubmit={login}>
          <Logo className="logo-lg" />
          <h1>Survey office</h1>
          <p className="meta">Sign in to manage surveys, staff and notifications.</p>
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
          {authErr ? <p className="err" role="alert">{authErr}</p> : null}
          <button className="signin" type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? <span className="spin" aria-hidden="true" /> : null}
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  if (view === "denied") {
    return (
      <div className="auth-page">
        <div className="logincard">
          <Logo className="logo-lg" />
          <h1>No access</h1>
          <p className="meta">You do not have access to Equipment Survey.</p>
          <button className="signin ghost" type="button" onClick={logout}>
            Sign in with another account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="office">
      <Layout
        page={page}
        onPage={goPage}
        user={user}
        onLogout={logout}
        staff={staff}
        navOpen={navOpen}
        setNavOpen={setNavOpen}
        unread={unread}
      />
      <div className="office-body">
        {header}
        {page === "dashboard" ? (
          <main className="main">
            <DashboardPage kpis={officeKpis} ready={treeStatus === "ready"} staff={staff} onGo={goPage} />
          </main>
        ) : null}
        {page === "admins" && staff ? (
          <main className="main">
            <UsersPage kind="admin" me={user} />
          </main>
        ) : null}
        {page === "subadmins" && staff ? (
          <main className="main">
            <UsersPage kind="subadmin" me={user} />
          </main>
        ) : null}
        {page === "technicians" && staff ? (
          <main className="main">
            <UsersPage kind="technician" me={user} />
          </main>
        ) : null}
        {page === "notifications" ? (
          <main className="main">
            <NotificationsPage me={user} staff={staff} />
          </main>
        ) : null}
        {page === "surveys" ? (
          <div className={`shell survey-shell mobile-${mobilePane}`}>
            <nav className="side" aria-label="Clients and sites">
              <div className="side-search">
                <Search size={16} />
          <input
            id="find"
            type="search"
            placeholder="Search client or site"
            value={find}
            onChange={(e) => setFind(e.target.value)}
                  onInput={(e) => setFind(e.target.value)}
                />
              </div>
              <div id="tree" className="navlist">
                {treeStatus === "loading" || treeStatus === "idle" ? (
                  <LoadingLine text="Loading clients…" />
                ) : treeStatus === "error" ? (
                  <ErrorLine message={treeErr} onRetry={loadTree} />
                ) : treeNodes.length ? (
                  treeNodes
                ) : (
                  <p className="empty">{find.trim() ? "No client or site matches." : "No survey sites yet."}</p>
                )}
              </div>
            </nav>
            <main className="main survey-main">{main}</main>
          </div>
        ) : null}
      </div>
      {editVisit ? (
        <div className="modal" onClick={() => setEditVisit(null)}>
          <form className="logincard" onClick={(e) => e.stopPropagation()} onSubmit={saveVisitEdit}>
            <h1>Edit survey visit</h1>
            <div className="field">
              <label className="f">Date and time</label>
              <input
                className="in"
                type="datetime-local"
                value={editVisit.visited_at}
                onChange={(e) => setEditVisit({ ...editVisit, visited_at: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="f">Technician name</label>
              <input
                className="in"
                value={editVisit.technician_name}
                onChange={(e) => setEditVisit({ ...editVisit, technician_name: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="f">Notes</label>
              <textarea
                className="in"
                rows={4}
                value={editVisit.notes}
                onChange={(e) => setEditVisit({ ...editVisit, notes: e.target.value })}
              />
            </div>
            <button className="signin" type="submit" disabled={busy}>{busy ? "Saving…" : "Save visit"}</button>
            <button className="signin ghost" type="button" onClick={() => setEditVisit(null)}>Cancel</button>
          </form>
        </div>
      ) : null}
      <dialog
        id="lightbox"
        ref={dialogRef}
        onClose={() => setLightbox(null)}
        onCancel={() => setLightbox(null)}
      >
        <div id="lb-img">
          {lightbox?.url ? (
            <img
              src={lightbox.url}
              alt={lightbox.title}
              onError={() => onPhotoError(lightbox)}
            />
          ) : null}
        </div>
        <div className="cap">
          <b id="lb-cap">{lightbox?.title}</b>
          <button type="button" onClick={() => setLightbox(null)}>
            Close
          </button>
        </div>
      </dialog>
    </div>
  );
}
