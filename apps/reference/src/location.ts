import { createSignal } from 'solid-js'

const [href, setHref] = createSignal(window.location.href)

window.addEventListener('popstate', () => setHref(window.location.href))

export function locationHref() {
  return href()
}

export function searchParams() {
  locationHref()
  return new URLSearchParams(window.location.search)
}

export function navigate(to: string) {
  if (to === `${window.location.pathname}${window.location.search}`) {
    return
  }

  window.history.pushState(null, '', to)
  setHref(window.location.href)
}

export function setSearch(next: Record<string, string | undefined>) {
  const params = new URLSearchParams(window.location.search)

  for (const [key, value] of Object.entries(next)) {
    if (!value) {
      params.delete(key)
    } else {
      params.set(key, value)
    }
  }

  const query = params.toString()
  navigate(query ? `/?${query}` : '/')
}
