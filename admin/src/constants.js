/** Survey office + field tech only. ERP PM / site / service logins stay in the main ERP. */
export function hasSurveyAccess(role) {
  const r = String(role || "");
  return r === "Management" || r === "System Admin" || r === "Technician";
}

export function isOfficeAdmin(role) {
  return role === "Management" || role === "System Admin";
}

const LEVEL = {
  "View Only": ["read"],
  Create: ["read", "create"],
  Edit: ["read", "create", "update"],
  Approval: ["read", "create", "update", "approve"],
  "Full Admin": ["read", "create", "update", "delete", "approve"],
};

export function canDo(user, action) {
  return (LEVEL[user?.access_level] || ["read"]).includes(action);
}

export function isSurveyOfficeUser(u, kind = "all") {
  const role = String(u?.role || "");
  const des = String(u?.designation || "");
  const tech = role === "Technician";
  const sub = des === "Sub Admin";
  const adm = des === "Administrator";
  if (kind === "technician" || kind === "technicians") return tech;
  if (kind === "subadmin" || kind === "subadmins") return sub;
  if (kind === "admin" || kind === "admins") return adm;
  return tech || sub || adm;
}

export const STAFF_PRESETS = {
  admin: {
    title: "Admins",
    subtitle: "System Admin accounts with full survey office control.",
    role: "System Admin",
    access_level: "Full Admin",
    designation: "Administrator",
    department: "Admin",
    createLabel: "Create admin",
  },
  subadmin: {
    title: "Sub admins",
    subtitle: "Management accounts that can review and edit surveys.",
    role: "Management",
    access_level: "Edit",
    designation: "Sub Admin",
    department: "Admin",
    createLabel: "Create sub admin",
  },
  technician: {
    title: "Technicians",
    subtitle: "Field staff who record equipment surveys on site.",
    role: "Technician",
    access_level: "Create",
    designation: "Technician",
    department: "Survey",
    createLabel: "Create technician",
  },
};
