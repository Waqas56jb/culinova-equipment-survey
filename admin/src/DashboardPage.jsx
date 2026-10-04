import { Bell, ClipboardList, HardHat, Shield } from "lucide-react";

export function DashboardPage({ kpis, ready, staff, onGo }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="meta">Survey office overview — visits, staff, and work that still needs attention.</p>
        </div>
      </div>
      <div className="office-kpis">
        <div>
          <b>{ready ? kpis.total : "—"}</b>
          <span>All visits</span>
        </div>
        <div>
          <b>{ready ? kpis.drafts : "—"}</b>
          <span>In progress</span>
        </div>
        <div>
          <b>{ready ? kpis.submitted : "—"}</b>
          <span>Submitted</span>
        </div>
        <div className="warn">
          <b>{ready ? kpis.ns + kpis.oos : "—"}</b>
          <span>Need attention</span>
        </div>
      </div>
      <div className="quick-grid">
        <button type="button" onClick={() => onGo("surveys")}>
          <ClipboardList size={22} />
          <b>View surveys</b>
          <span>Open the client / site tree and visit records</span>
        </button>
        {staff ? (
          <>
            <button type="button" onClick={() => onGo("admins")}>
              <Shield size={22} />
              <b>Create admin</b>
              <span>Add a System Admin with full control</span>
            </button>
            <button type="button" onClick={() => onGo("technicians")}>
              <HardHat size={22} />
              <b>Create technician</b>
              <span>Issue a field login for recording surveys</span>
            </button>
            <button type="button" onClick={() => onGo("notifications")}>
              <Bell size={22} />
              <b>Post notification</b>
              <span>Send an announcement to survey staff</span>
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
