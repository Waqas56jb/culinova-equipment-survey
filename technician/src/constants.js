export const PHOTO_TYPES = [
  'Equipment',
  'Nameplate',
  'Problem',
  'Interior/Filter',
  'Control Panel',
  'Other',
]

/** Field tech + survey office only. ERP PM / site / service stay in the main ERP. */
export function hasSurveyAccess(role) {
  const r = String(role || "")
  return r === "Management" || r === "System Admin" || r === "Technician"
}

export const NETWORK_SAVE_MSG = 'Not saved. Check connection and try again'
