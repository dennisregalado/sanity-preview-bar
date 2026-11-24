/** How long a perspective switch waits for the page's `refreshed` before giving up on it. */
export const HOST_REFRESH_TIMEOUT_MS = 5000

/**
 * Pending refresh requests: `request` posts a refresh and resolves on the next `settle` (the
 * host's `refreshed`), or after `timeoutMs` when the page never answers.
 */
export function createRefreshWaiter(post: () => void, timeoutMs = HOST_REFRESH_TIMEOUT_MS) {
  const pending = new Set<() => void>()
  return {
    request: () =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          pending.delete(done)
          resolve()
        }
        const timer = setTimeout(done, timeoutMs)
        pending.add(done)
        post()
      }),
    settle: () => {
      for (const done of [...pending]) done()
    },
  }
}
