export type AccessConfiguration = {
  mode: 'local' | 'tailscale'
  allowedLogin?: string
}

export function accessConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  production = env.NODE_ENV === 'production',
): AccessConfiguration {
  const mode = env.SPECTER_MAIL_ACCESS_MODE ?? 'local'
  if (mode !== 'local' && mode !== 'tailscale') {
    throw new Error('SPECTER_MAIL_ACCESS_MODE must be local or tailscale')
  }
  if (mode === 'tailscale' && !env.TAILSCALE_ALLOWED_LOGIN) {
    throw new Error('TAILSCALE_ALLOWED_LOGIN is required in tailscale mode')
  }
  if (production && mode !== 'tailscale') {
    throw new Error('Production Personal Mail requires tailscale access mode')
  }
  return { mode, allowedLogin: env.TAILSCALE_ALLOWED_LOGIN }
}

export function requestIsAuthorized(
  request: Request,
  configuration: AccessConfiguration,
) {
  if (configuration.mode === 'local') {
    const hostname = new URL(request.url).hostname
    return (
      hostname === '127.0.0.1' ||
      hostname === 'localhost' ||
      hostname === '[::1]'
    )
  }
  return (
    request.headers.get('tailscale-user-login') === configuration.allowedLogin
  )
}
