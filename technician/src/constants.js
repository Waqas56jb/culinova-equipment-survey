export const PHOTO_TYPES = [
  'Equipment',
  'Nameplate',
  'Problem',
  'Interior/Filter',
  'Control Panel',
  'Other',
]

/** Mirror of ERP server survey panel roles (client-side gate only). */
export function hasSurveyAccess(role) {
  const r = String(role || '')
  if (r === 'Management' || r === 'System Admin') return true
  return ['Project Manager', 'Site Engineer', 'Technician', 'Service User'].includes(r)
}

export const NETWORK_SAVE_MSG = 'Not saved. Check connection and try again'
