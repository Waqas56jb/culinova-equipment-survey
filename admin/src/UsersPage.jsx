import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2, KeyRound, Search } from "lucide-react";
import { api } from "./api";
import { canDo, isSurveyOfficeUser, STAFF_PRESETS } from "./constants";
import { notify } from "./toast";

const LEVELS = ["View Only", "Create", "Edit", "Approval", "Full Admin"];

const emptyForm = (preset) => ({
  name: "",
  email: "",
  password: "",
  designation: preset.designation,
  department: preset.department,
  access_level: preset.access_level,
});

export function UsersPage({ kind, me }) {
  const preset = STAFF_PRESETS[kind];
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("idle");
  const [q, setQ] = useState("");
  const [form, setForm] = useState(() => emptyForm(preset));
  const [editing, setEditing] = useState(null);
  const [pwd, setPwd] = useState({ id: null, value: "" });
  const [busy, setBusy] = useState(false);
  const canCreate = canDo(me, "create");
  const canUpdate = canDo(me, "update");
  const canDelete = canDo(me, "delete");

  async function load() {
    setStatus("loading");
    try {
      const list = await api("GET", "/users");
      setRows(Array.isArray(list) ? list.filter((u) => isSurveyOfficeUser(u, kind)) : []);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      notify.err(e.message || "Could not load users");
    }
  }

  useEffect(() => {
    load();
  }, [kind]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((u) =>
      `${u.name} ${u.email} ${u.designation || ""} ${u.department || ""}`.toLowerCase().includes(s)
    );
  }, [rows, q]);

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function createUser(e) {
    e.preventDefault();
    if (!canCreate) return notify.err("Your access level cannot create users");
    setBusy(true);
    try {
      await api("POST", "/users", {
        body: {
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: preset.role,
          access_level: form.access_level,
          designation: form.designation.trim(),
          department: form.department.trim(),
        },
      });
      notify.ok(`${preset.createLabel.replace("Create ", "")} created`);
      setForm(emptyForm(preset));
      await load();
    } catch (err) {
      notify.err(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!canUpdate) return notify.err("Your access level cannot edit users");
    setBusy(true);
    try {
      await api("PATCH", `/users/${editing.id}`, {
        body: {
          name: editing.name.trim(),
          email: editing.email.trim(),
          designation: editing.designation,
          department: editing.department,
          access_level: editing.access_level,
        },
      });
      notify.ok("User updated");
      setEditing(null);
      await load();
    } catch (err) {
      notify.err(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(e) {
    e.preventDefault();
    if (!canUpdate) return notify.err("Your access level cannot reset passwords");
    setBusy(true);
    try {
      await api("POST", `/users/${pwd.id}/reset-password`, { body: { newPassword: pwd.value } });
      notify.ok("Password reset");
      setPwd({ id: null, value: "" });
    } catch (err) {
      notify.err(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(u) {
    if (!canDelete) return notify.err("Your access level cannot delete users");
    if (u.id === me?.id) return notify.err("You cannot delete your own account");
    if (!window.confirm(`Delete ${u.name}? This cannot be undone.`)) return;
    try {
      await api("DELETE", `/users/${u.id}`);
      notify.ok("User deleted");
      await load();
    } catch (err) {
      notify.err(err.message);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{preset.title}</h1>
          <p className="meta">Site maintenance survey team only — not ERP project, sales or warehouse staff.</p>
        </div>
      </div>

      {canCreate ? (
        <form className="card form-card" onSubmit={createUser}>
          <h2>
            <Plus size={18} /> {preset.createLabel}
          </h2>
          <div className="grid2">
            <div className="field">
              <label className="f">Full name</label>
              <input className="in" required value={form.name} onChange={(e) => setField("name", e.target.value)} />
            </div>
            <div className="field">
              <label className="f">Email</label>
              <input className="in" type="email" required value={form.email} onChange={(e) => setField("email", e.target.value)} />
            </div>
            <div className="field">
              <label className="f">Password</label>
              <input className="in" type="password" minLength={6} required value={form.password} onChange={(e) => setField("password", e.target.value)} />
            </div>
            <div className="field">
              <label className="f">Access level</label>
              <select className="in" value={form.access_level} onChange={(e) => setField("access_level", e.target.value)}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="f">Designation</label>
              <input className="in" readOnly value={form.designation} />
            </div>
            <div className="field">
              <label className="f">Department</label>
              <input className="in" readOnly value={form.department} />
            </div>
          </div>
          <button className="signin" type="submit" disabled={busy}>
            {busy ? "Saving…" : preset.createLabel}
          </button>
        </form>
      ) : null}

      <div className="card">
        <div className="list-head">
          <h2>Directory ({filtered.length})</h2>
          <label className="searchbox">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" />
          </label>
        </div>
        {status === "loading" ? (
          <p className="loading">Loading…</p>
        ) : !filtered.length ? (
          <p className="empty">No {preset.title.toLowerCase()} yet.</p>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Access</th>
                  <th>Designation</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <b>{u.name}</b>
                      <small>{u.department || preset.department}</small>
                    </td>
                    <td>{u.email}</td>
                    <td>{u.access_level}</td>
                    <td>{u.designation || "—"}</td>
                    <td className="row-actions">
                      {canUpdate ? (
                        <>
                          <button type="button" className="icon-act" onClick={() => setEditing({ ...u })} aria-label="Edit">
                            <Pencil size={16} />
                          </button>
                          <button type="button" className="icon-act" onClick={() => setPwd({ id: u.id, value: "" })} aria-label="Reset password">
                            <KeyRound size={16} />
                          </button>
                        </>
                      ) : null}
                      {canDelete ? (
                        <button type="button" className="icon-act danger" onClick={() => remove(u)} aria-label="Delete">
                          <Trash2 size={16} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing ? (
        <div className="modal" onClick={() => setEditing(null)}>
          <form className="logincard" onClick={(e) => e.stopPropagation()} onSubmit={saveEdit}>
            <h1>Edit {editing.name}</h1>
            <div className="field">
              <label className="f">Name</label>
              <input className="in" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="field">
              <label className="f">Email</label>
              <input className="in" type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            </div>
            <div className="field">
              <label className="f">Access level</label>
              <select className="in" value={editing.access_level} onChange={(e) => setEditing({ ...editing, access_level: e.target.value })}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="f">Designation</label>
              <input className="in" value={editing.designation || ""} onChange={(e) => setEditing({ ...editing, designation: e.target.value })} />
            </div>
            <button className="signin" type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
            <button className="signin ghost" type="button" onClick={() => setEditing(null)}>Cancel</button>
          </form>
        </div>
      ) : null}

      {pwd.id ? (
        <div className="modal" onClick={() => setPwd({ id: null, value: "" })}>
          <form className="logincard" onClick={(e) => e.stopPropagation()} onSubmit={resetPassword}>
            <h1>Reset password</h1>
            <div className="field">
              <label className="f">New password</label>
              <input className="in" type="password" minLength={6} required value={pwd.value} onChange={(e) => setPwd({ ...pwd, value: e.target.value })} />
            </div>
            <button className="signin" type="submit" disabled={busy}>{busy ? "Saving…" : "Reset password"}</button>
            <button className="signin ghost" type="button" onClick={() => setPwd({ id: null, value: "" })}>Cancel</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
