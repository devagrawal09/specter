import { loadEnvFile } from 'node:process';
import path from 'node:path';

/** Load an optional local file while preserving the normal process environment precedence. */
export function loadLocalEnvironment(): void {
  try {
    loadEnvFile(path.join(process.cwd(), '.env'));
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return;
    }
    throw error;
  }
}
