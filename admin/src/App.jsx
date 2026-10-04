import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { api, ApiError, clearSession, getToken, isNetworkError, setOnUnauthorized, setSession } from "./api";
import { hasSurveyAccess } from "./constants";

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

function NumCell({ n, cls }) {
  return <td className={`n ${n ? cls : "zero"}`}>{n}</td>;
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
  const [authErr, setAuthErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [sel, setSel] = useState({ customerId: null, siteId: null, visitId: null });
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(() => new Set());
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
    const v = s.visits[0];
    setSel({ customerId: c.id, siteId: s.id, visitId: v ? v.id : null });
    setFilter("all");
  }, [treeStatus, treeData, sel.customerId, sel.siteId]);

  const client = treeData.find((c) => c.id === sel.customerId) || null;
  const site = client?.sites.find((s) => s.id === sel.siteId) || null;

  useEffect(() => {
    const lines = visitFull?.lines || [];
    const next = new Set();
    lines.forEach((line) => {
      const s = splitLine(line);
      if (s.ns + s.oos > 0) next.add(line.id);
    });
    setOpen(next);
  }, [visitFull?.id]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (lightbox) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [lightbox]);

  function go(customerId, siteId, visitId) {
    setSel({ customerId, siteId, visitId });
    setFilter("all");
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
      setView(hasSurveyAccess(fromApi.role) ? "app" : "denied");
    } catch (err) {
      setAuthErr(err.message || "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  function toggleRow(id) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onRowKey(e, handler) {
    if (e.key === "Enter") handler();
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

  const tree = filteredTree.map((c) => {
    const clientOpen = !!q || c.id === sel.customerId;
    return (
      <details key={c.id} open={clientOpen}>
        <summary>{c.label || c.name}</summary>
        <div className="sites">
          {c.sites.map((s) => {
            const siteOpen = !!q || (c.id === sel.customerId && s.id === sel.siteId);
            return (
              <details key={s.id} open={siteOpen}>
                <summary>{s.label || s.name}</summary>
                <button
                  className="sitebtn"
                  type="button"
                  aria-current={sel.customerId === c.id && sel.siteId === s.id && sel.visitId === null}
                  onClick={() => go(c.id, s.id, null)}
                >
                  Visit history ({s.visits.length})
                </button>
                {s.visits.length ? (
                  <ul className="visits">
                    {s.visits.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          aria-current={sel.visitId === v.id}
                          onClick={() => go(c.id, s.id, v.id)}
                        >
                          {fmt(v.visited_at)}
                          <small>
                            {v.totals?.total ?? 0}
                            {v.status ? ` · ${v.status}` : ""}
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="novisits">No visits yet</p>
                )}
              </details>
            );
          })}
        </div>
      </details>
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
        <p className="crumbs">{client.label || client.name}</p>
        <h1>{site.label || site.name}</h1>
        <p className="meta">
          {site.visits.length} saved visit{site.visits.length === 1 ? "" : "s"}. Select a visit to see
          its equipment and photos.
        </p>
        {site.visits.length ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Visit date</th>
                  <th>Technician</th>
                  <th className="n">Total</th>
                  <th className="n">Good</th>
                  <th className="n">Need service</th>
                  <th className="n">OOS</th>
                </tr>
              </thead>
              <tbody>
                {site.visits.map((v) => {
                  const t = visitTotals(v);
                  return (
                    <tr
                      key={v.id}
                      className="clickable"
                      tabIndex={0}
                      onClick={() => go(sel.customerId, sel.siteId, v.id)}
                      onKeyDown={(e) => onRowKey(e, () => go(sel.customerId, sel.siteId, v.id))}
                    >
                      <td>
                        <b>{fmt(v.visited_at)}</b>
                        <small>{fmtTime(v.visited_at)}</small>
                      </td>
                      <td>{v.technician_name || "—"}</td>
                      <td className="n">{t.total}</td>
                      <NumCell n={t.good} cls="g" />
                      <NumCell n={t.ns} cls="s" />
                      <NumCell n={t.oos} cls="o" />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">No visits yet</p>
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
        <p className="crumbs">
          {client.label || client.name} › {site.label || site.name}
        </p>
        <h1>Visit on {fmt(v.visited_at)}</h1>
        <p className="meta">
          Technician {v.technician_name || "—"}, started {fmtTime(v.visited_at)}. {lines.length} equipment records,{" "}
          {photoCount} photos.
        </p>
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
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Specifications</th>
                <th className="n">Qty</th>
                <th className="n">Good</th>
                <th className="n">Need service</th>
                <th className="n">OOS</th>
                <th>Photos</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map(({ line, split }) => {
                  const photos = line.photos || [];
                  const specs = specText(line, defMap);
                  return (
                    <Fragment key={line.id}>
                      <tr
                        className="row"
                        tabIndex={0}
                        aria-expanded={open.has(line.id)}
                        onClick={() => toggleRow(line.id)}
                        onKeyDown={(e) => onRowKey(e, () => toggleRow(line.id))}
                      >
                        <td>
                          <b>{lineName(line)}</b>
                          <small>{line.category}</small>
                        </td>
                        <td>{specs || <small>None recorded</small>}</td>
                        <td className="n">{split.qty}</td>
                        <NumCell n={split.good} cls="g" />
                        <NumCell n={split.ns} cls="s" />
                        <NumCell n={split.oos} cls="o" />
                        <td>
                          <span className="pbtn">
                            {photos.length
                              ? `${photos.length} photo${photos.length > 1 ? "s" : ""}`
                              : "None"}
                          </span>
                        </td>
                      </tr>
                      {open.has(line.id) ? (
                        <tr className="detail">
                          <td colSpan={7}>
                            {line.notes ? (
                              <p>
                                <b>Problem / observation:</b> {line.notes}
                              </p>
                            ) : (
                              <p>No problem reported.</p>
                            )}
                            {photos.length ? (
                              <div className="photos">
                                {photos.map((p) => (
                                  <button
                                    key={p.id}
                                    className="ph"
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setLightbox({
                                        title: `${lineName(line)}, ${p.kind || "Photo"}`,
                                        type: p.kind || "Other",
                                        url: p.url,
                                        id: p.id,
                                      });
                                    }}
                                  >
                                    <img src={p.url} alt={p.kind || "Photo"} />
                                    <span>{p.kind || "Photo"}</span>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <small>No photos attached to this record.</small>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="empty">
                    No equipment matches this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  const treeNodes = tree;

  const header = (
    <header className="top">
      <span className="brand">CULINOVA</span>
      <span className="sec">Equipment surveys</span>
      {user && view !== "login" && view !== "boot" ? (
        <span className="who">
          <span>
            {user.name} · {user.role}
          </span>
          <button type="button" onClick={logout}>
            Logout
          </button>
        </span>
      ) : null}
    </header>
  );

  if (view === "boot") {
    return (
      <div className="auth-page">
        <div className="logincard">
          <div className="auth-mark" aria-hidden="true">C</div>
          <p className="loading">Checking session…</p>
        </div>
      </div>
    );
  }

  if (view === "offline") {
    return (
      <div className="auth-page">
        <div className="logincard">
          <div className="auth-mark" aria-hidden="true">C</div>
          <p className="auth-brand">CULINOVA</p>
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
          <div className="auth-mark" aria-hidden="true">C</div>
          <p className="auth-brand">CULINOVA</p>
          <h1>Office surveys</h1>
          <p className="meta">Read-only view of site equipment visits.</p>
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
          <div className="auth-mark" aria-hidden="true">C</div>
          <p className="auth-brand">CULINOVA</p>
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
    <>
      {header}
      <div className="shell">
        <nav className="side" aria-label="Clients, sites and visits">
          <label htmlFor="find" style={{ position: "absolute", left: -9999 }}>
            Search clients and sites
          </label>
          <input
            id="find"
            type="search"
            placeholder="Search client or site"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onInput={(e) => setFind(e.target.value)}
          />
          <div id="tree">
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
        <main className="main">{main}</main>
      </div>
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
    </>
  );
}
