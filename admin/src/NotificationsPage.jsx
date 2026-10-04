import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { api } from "./api";
import { canDo } from "./constants";
import { notify } from "./toast";

export function NotificationsPage({ me, staff }) {
  const [title, setTitle] = useState("Survey announcement");
  const [body, setBody] = useState("");
  const [slice, setSlice] = useState("technicians");
  const [busy, setBusy] = useState(false);
  const [inbox, setInbox] = useState([]);
  const canSend = canDo(me, "create");

  async function loadInbox() {
    try {
      const data = await api("GET", "/notifications");
      setInbox(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      notify.err(e.message || "Could not load inbox");
    }
  }

  useEffect(() => {
    loadInbox();
  }, []);

  async function send(e) {
    e.preventDefault();
    if (!canSend) return notify.err("Your access level cannot post notifications");
    setBusy(true);
    try {
      const res = await api("POST", "/notifications/send", {
        body: { title, body, audience: "survey_team", value: slice },
      });
      notify.ok(`Notification sent to ${res.sent} recipient${res.sent === 1 ? "" : "s"}`);
      setBody("");
      await loadInbox();
    } catch (err) {
      notify.err(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p className="meta">
            Send only to this survey office: technicians, and admins / sub-admins created here. ERP project managers and other ERP roles are not included.
          </p>
        </div>
      </div>

      {staff ? (
        <form className="card form-card" onSubmit={send}>
          <h2>
            <Send size={18} /> Post notification
          </h2>
          <div className="field">
            <label className="f">Send to</label>
            <select className="in" value={slice} onChange={(e) => setSlice(e.target.value)}>
              <option value="technicians">Technicians</option>
              <option value="subadmins">Sub admins (created here)</option>
              <option value="admins">Admins (created here)</option>
              <option value="all">All survey office staff</option>
            </select>
          </div>
          <div className="field">
            <label className="f">Title</label>
            <input className="in" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label className="f">Message</label>
            <textarea className="in" required rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <button className="signin" type="submit" disabled={busy || !canSend}>
            {busy ? "Sending…" : "Send notification"}
          </button>
        </form>
      ) : null}

      <div className="card">
        <h2>Your inbox</h2>
        {!inbox.length ? (
          <p className="empty">No notifications yet.</p>
        ) : (
          <ul className="inbox">
            {inbox.map((n) => (
              <li key={n.id} className={n.read ? "" : "unread"}>
                <b>{n.title || "Announcement"}</b>
                <p>{n.body}</p>
                <small>
                  {n.sender ? `From ${n.sender}` : ""} {n.created_at ? `· ${new Date(n.created_at).toLocaleString()}` : ""}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
