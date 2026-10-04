const TOKEN_KEY = 'culinova_survey_admin_token'
const USER_KEY = 'culinova_survey_admin_user'

const DEFAULT_API = import.meta.env.PROD
  ? 'https://culinova-backend.vercel.app/api'
  : 'http://localhost:5050/api'

export const BASE = String(import.meta.env.VITE_API_URL || DEFAULT_API).replace(/\/$/, '')

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY)
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user || null))
  sessionStorage.removeItem(TOKEN_KEY)
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message || 'Request failed')
    this.status = status
    this.body = body
  }
}

export function isNetworkError(err) {
  if (!err) return false
  if (err instanceof ApiError) return false
  const name = err.name || ''
  const m = String(err.message || err)
  return err instanceof TypeError
    || name === 'AbortError'
    || name === 'TimeoutError'
    || /failed to fetch|networkerror|load failed|err_internet|offline|timeout|aborted/i.test(m)
}

let onUnauthorized = null
export function setOnUnauthorized(fn) {
  onUnauthorized = fn
}

export async function api(method, path, { body, token } = {}) {
  const headers = {}
  const auth = token === undefined ? getToken() : token
  if (auth) headers.authorization = `Bearer ${auth}`
  let payload
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  } catch (e) {
    throw isNetworkError(e) ? e : new TypeError('Failed to fetch')
  }
  const text = await res.text()
  let json = null
  if (text) {
    try { json = JSON.parse(text) } catch { json = text }
  }
  if (res.status === 401) {
    clearSession()
    onUnauthorized?.()
    throw new ApiError(401, (json && json.error) || 'Session expired', json)
  }
  if (!res.ok) {
    const msg = (json && typeof json === 'object' && json.error) ? json.error : (typeof json === 'string' ? json : `Request failed (${res.status})`)
    throw new ApiError(res.status, msg, json)
  }
  return json
}
