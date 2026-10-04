import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "./api";

function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function InboxBell({ unread, onUnread, onSeeAll }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState({ top: 56, right: 16 });
  const wrap = useRef(null);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      if (next && wrap.current) {
        const r = wrap.current.getBoundingClientRect();
        setPos({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) });
      }
      return next;
    });
  }

  async function load() {
    try {
      const data = await api("GET", "/notifications");
      setItems(Array.isArray(data?.items) ? data.items : []);
      onUnread?.(Number(data?.unread) || 0);
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  useEffect(() => {
    function onDoc(e) {
      if (!wrap.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function markOne(id) {
    try {
      await api("POST", `/notifications/${id}/read`);
      await load();
    } catch {
      /* keep list */
    }
  }

  async function markAll() {
    setBusy(true);
    try {
      await api("POST", "/notifications/read-all");
      await load();
    } catch {
      /* keep list */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bell-wrap" ref={wrap}>
      <button
        type="button"
        className="iconbtn"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={toggle}
      >
        <Bell size={18} />
        {unread ? <i>{unread > 9 ? "9+" : unread}</i> : null}
      </button>
      {open ? (
        <div className="bell-panel" role="dialog" aria-label="Notifications" style={{ top: pos.top, right: pos.right }}>
          <div className="bell-head">
            <b>Notifications</b>
            {unread ? (
              <button type="button" className="linkish" disabled={busy} onClick={markAll}>
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="bell-list">
            {items.length ? (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`bell-item${n.read ? "" : " unread"}`}
                  onClick={() => markOne(n.id)}
                >
                  <strong>{n.title || "Announcement"}</strong>
                  <p>{n.body}</p>
                  <small>
                    {n.sender ? `${n.sender} · ` : ""}
                    {when(n.created_at)}
                  </small>
                </button>
              ))
            ) : (
              <p className="empty">No notifications yet.</p>
            )}
          </div>
          <button
            type="button"
            className="bell-foot"
            onClick={() => {
              setOpen(false);
              onSeeAll?.();
            }}
          >
            Open notifications page
          </button>
        </div>
      ) : null}
    </div>
  );
}
