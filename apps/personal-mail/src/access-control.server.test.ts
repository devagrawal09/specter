import { describe, expect, test } from 'vitest'

import {
  accessConfiguration,
  requestHasActionAuthorization,
  requestIsAuthorized,
} from './access-control.server'

describe('Personal Mail access control', () => {
  test('allows only loopback hosts in local mode', () => {
    const configuration = { mode: 'local' as const }
    expect(
      requestIsAuthorized(
        new Request('http://127.0.0.1:41738/api/status'),
        configuration,
      ),
    ).toBe(true)
    expect(
      requestIsAuthorized(
        new Request('http://192.168.1.25:41738/api/status'),
        configuration,
      ),
    ).toBe(false)
  })

  test('requires the exact Tailscale identity in tailscale mode', () => {
    const configuration = {
      mode: 'tailscale' as const,
      allowedLogin: 'owner@example.com',
    }
    expect(
      requestIsAuthorized(
        new Request('https://mail.tailnet.ts.net/api/status', {
          headers: { 'tailscale-user-login': 'owner@example.com' },
        }),
        configuration,
      ),
    ).toBe(true)
    expect(
      requestIsAuthorized(
        new Request('https://mail.tailnet.ts.net/api/status', {
          headers: { 'tailscale-user-login': 'someone@example.com' },
        }),
        configuration,
      ),
    ).toBe(false)
  })

  test('refuses production without tailscale mode and an owner', () => {
    expect(() =>
      accessConfiguration({
        NODE_ENV: 'production',
        SPECTER_MAIL_ACCESS_MODE: 'local',
      }),
    ).toThrow('Production Personal Mail requires tailscale access mode')
    expect(() =>
      accessConfiguration({
        NODE_ENV: 'production',
        SPECTER_MAIL_ACCESS_MODE: 'tailscale',
      }),
    ).toThrow('TAILSCALE_ALLOWED_LOGIN is required in tailscale mode')
  })

  test('requires a non-simple action header for state-changing requests', () => {
    expect(
      requestHasActionAuthorization(
        new Request('http://127.0.0.1:41738/api/sync', { method: 'POST' }),
      ),
    ).toBe(false)
    expect(
      requestHasActionAuthorization(
        new Request('http://127.0.0.1:41738/api/sync', {
          method: 'POST',
          headers: { 'x-personal-mail-action': '1' },
        }),
      ),
    ).toBe(true)
    expect(
      requestHasActionAuthorization(
        new Request('http://127.0.0.1:41738/api/status'),
      ),
    ).toBe(true)
  })
})
