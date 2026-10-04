import {
  Bell,
  ClipboardList,
  HardHat,
  LayoutDashboard,
  LogOut,
  Menu,
  Shield,
  UserCog,
  X,
} from "lucide-react";
import { Logo } from "./Logo";

const ITEMS = [
  { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard, staff: false },
  { id: "surveys", label: "Surveys", Icon: ClipboardList, staff: false },
  { id: "admins", label: "Admins", Icon: Shield, staff: true },
  { id: "subadmins", label: "Sub admins", Icon: UserCog, staff: true },
  { id: "technicians", label: "Technicians", Icon: HardHat, staff: true },
  { id: "notifications", label: "Notifications", Icon: Bell, staff: true },
];

export function MenuButton({ navOpen, onToggle }) {
  return (
    <button
      className="nav-burger"
      type="button"
      aria-label={navOpen ? "Close menu" : "Open menu"}
      aria-expanded={navOpen}
      onClick={onToggle}
    >
      {navOpen ? <X size={22} /> : <Menu size={22} />}
    </button>
  );
}

export function Layout({ page, onPage, user, onLogout, staff, navOpen, setNavOpen, unread }) {
  return (
    <>
      {navOpen ? (
        <button className="nav-scrim" type="button" aria-label="Close menu" onClick={() => setNavOpen(false)} />
      ) : null}
      <aside className={`navside${navOpen ? " open" : ""}`}>
        <div className="nav-brand">
          <Logo tone="light" className="logo logo-on-dark" />
          <small>Equipment survey office</small>
        </div>
        <nav>
          {ITEMS.filter((it) => !it.staff || staff).map((it) => (
            <button
              key={it.id}
              type="button"
              className={page === it.id ? "on" : ""}
              onClick={() => {
                onPage(it.id);
                setNavOpen(false);
              }}
            >
              <it.Icon size={18} strokeWidth={2.2} />
              {it.label}
              {it.id === "notifications" && unread ? <i>{unread > 9 ? "9+" : unread}</i> : null}
            </button>
          ))}
        </nav>
        <div className="nav-foot">
          <span>{user?.name}</span>
          <button type="button" onClick={onLogout}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>
    </>
  );
}
