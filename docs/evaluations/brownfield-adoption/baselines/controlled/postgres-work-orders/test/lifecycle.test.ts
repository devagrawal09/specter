import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('fixed HTTP listener', () => {
  it('rejects configuration for any public port other than 42131', () => {
    expect(() => loadConfig({ PORT: '42132' })).toThrow();
    expect(loadConfig({ PORT: '42131' }).PORT).toBe(42131);
  });
});
