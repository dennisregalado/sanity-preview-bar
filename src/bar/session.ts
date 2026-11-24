/**
 * Whether the viewer is signed in to the project's embedded Studio, read the way the Studio's auth
 * store does (`sanity@6.23`): a token in `localStorage` under `__studio_auth_token_<projectId>`
 * (token login), or Sanity's session cookie on the project API (cookie login). The bar runs on the
 * Studio's origin, so it sees the same session. Shared-link guests usually have none.
 */
import {useCallback, useEffect, useRef, useState} from 'react'

export type StudioUser = {id: string; name?: string; email?: string; profileImage?: string}

export type StudioSession =
  {status: 'loading'} | {status: 'signed-out'} | {status: 'signed-in'; user: StudioUser}

const AUTH_KEY_PREFIX = '__studio_auth_'

function storedToken(projectId: string): string | undefined {
  try {
    const raw = window.localStorage.getItem(`${AUTH_KEY_PREFIX}token_${projectId}`)
    const token = raw ? (JSON.parse(raw) as {token?: unknown}).token : undefined
    return typeof token === 'string' && token ? token : undefined
  } catch {
    return undefined
  }
}

/** A `/users/me` check that didn't say either way (a 429, a 5xx, the network). */
export class SessionCheckError extends Error {
  constructor(readonly status?: number) {
    super(status ? `Studio session check failed (${status})` : 'Studio session check failed')
    this.name = 'SessionCheckError'
  }
}

/**
 * The signed-in user, or `null` when the API says there's none (401/403, or a body without a
 * user: an anonymous session). Anything else (rate limits, server errors, network failures) throws
 * `SessionCheckError`, so callers can keep the session they already know.
 */
export async function fetchCurrentUser(projectId: string): Promise<StudioUser | null> {
  const token = storedToken(projectId)
  let response: Response
  try {
    response = await fetch(`https://${projectId}.api.sanity.io/v2021-06-07/users/me`, {
      ...(token ? {headers: {authorization: `Bearer ${token}`}} : {credentials: 'include'}),
      cache: 'no-store',
    })
  } catch {
    throw new SessionCheckError()
  }
  if (response.status === 401 || response.status === 403) return null
  if (!response.ok) throw new SessionCheckError(response.status)
  let user: Partial<StudioUser> | null
  try {
    user = (await response.json()) as Partial<StudioUser> | null
  } catch {
    throw new SessionCheckError(response.status)
  }
  return user && typeof user.id === 'string' ? (user as StudioUser) : null
}

/**
 * The next session after a check: a definite answer replaces the session; a failed check keeps
 * the last known one (still `loading` if there isn't one yet).
 */
export function nextSession(
  current: StudioSession,
  result: {user: StudioUser | null} | {error: unknown},
): StudioSession {
  if ('user' in result)
    return result.user ? {status: 'signed-in', user: result.user} : {status: 'signed-out'}
  return current
}

/**
 * The Studio session, rechecked when another window of this origin changes Studio auth (the
 * sign-in popup writing its token or cookie state), and when this window regains focus.
 */
export function useStudioSession(projectId: string | null, {enabled = true} = {}) {
  const [session, setSession] = useState<StudioSession>({status: 'loading'})
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    if (!enabled) return
    if (!projectId) return setSession({status: 'signed-out'})
    const request = ++latest.current
    let result: {user: StudioUser | null} | {error: unknown}
    try {
      result = {user: await fetchCurrentUser(projectId)}
    } catch (error) {
      result = {error}
    }
    if (request === latest.current) setSession((current) => nextSession(current, result))
  }, [projectId, enabled])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith(AUTH_KEY_PREFIX)) void refresh()
    }
    const onFocus = () => void refresh()
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh, enabled])

  return {session, refresh}
}

/**
 * Opens the embedded Studio's own sign-in screen in a popup. The Studio completes the provider
 * redirect itself; `onDone` runs (and the popup closes) once this window sees the session, or
 * the popup is closed. When popups are blocked it opens a tab and calls `onDone` at once (the
 * session is rechecked on focus). Returns a function that stops watching (call it on unmount).
 */
export function openStudioSignIn(
  studioPath: string,
  check: () => Promise<boolean>,
  onDone: () => void,
): () => void {
  const popup = window.open(studioPath, 'sanity-preview-bar-sign-in', 'popup,width=480,height=720')
  if (!popup) {
    window.open(studioPath, '_blank')
    onDone()
    return () => {}
  }
  let stopped = false
  let checking = false
  const stop = () => {
    stopped = true
    window.clearInterval(timer)
  }
  const timer = window.setInterval(async () => {
    if (stopped || checking) return
    if (popup.closed) {
      stop()
      onDone()
      return
    }
    checking = true
    let signedIn = false
    try {
      signedIn = await check()
    } catch {
      // Offline or a failed check: try again on the next tick.
    } finally {
      checking = false
    }
    if (signedIn && !stopped) {
      stop()
      popup.close()
      onDone()
    }
  }, 1500)
  return stop
}
