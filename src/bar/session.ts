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

export async function fetchCurrentUser(projectId: string): Promise<StudioUser | null> {
  const token = storedToken(projectId)
  const response = await fetch(`https://${projectId}.api.sanity.io/v2021-06-07/users/me`, {
    ...(token ? {headers: {authorization: `Bearer ${token}`}} : {credentials: 'include'}),
    cache: 'no-store',
  })
  if (!response.ok) return null
  const user = (await response.json()) as Partial<StudioUser> | null
  return user && typeof user.id === 'string' ? (user as StudioUser) : null
}

/**
 * The Studio session, rechecked when another window of this origin changes Studio auth (the
 * sign-in popup writing its token or cookie state), and when this window regains focus.
 */
export function useStudioSession(projectId: string | null) {
  const [session, setSession] = useState<StudioSession>({status: 'loading'})
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    if (!projectId) return setSession({status: 'signed-out'})
    const request = ++latest.current
    try {
      const user = await fetchCurrentUser(projectId)
      if (request !== latest.current) return
      setSession(user ? {status: 'signed-in', user} : {status: 'signed-out'})
    } catch {
      if (request === latest.current) setSession({status: 'signed-out'})
    }
  }, [projectId])

  useEffect(() => {
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
  }, [refresh])

  return {session, refresh}
}

/**
 * Opens the embedded Studio's own sign-in screen in a popup. The Studio completes the provider
 * redirect itself; `onSignedIn` runs (and the popup closes) once this window sees the session.
 */
export function openStudioSignIn(
  studioPath: string,
  check: () => Promise<boolean>,
  onDone: () => void,
) {
  const popup = window.open(studioPath, 'sanity-preview-bar-sign-in', 'popup,width=480,height=720')
  if (!popup) {
    window.open(studioPath, '_blank')
    return
  }
  const timer = window.setInterval(async () => {
    if (popup.closed) {
      window.clearInterval(timer)
      onDone()
      return
    }
    if (await check()) {
      window.clearInterval(timer)
      popup.close()
      onDone()
    }
  }, 1500)
}
