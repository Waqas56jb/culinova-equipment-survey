/** Roles that may use this read-only survey browser. Technician is allowed; the API scopes visits to their own. */
export function hasSurveyAccess(role) {
  const r = String(role || '')
  if (r === 'Management' || r === 'System Admin') return true
  return ['Project Manager', 'Site Engineer', 'Technician', 'Service User'].includes(r)
}
