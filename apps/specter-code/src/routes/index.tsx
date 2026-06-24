import { createFileRoute } from '@tanstack/solid-router'

import { SpecterCodeShell } from '../features/specter-code/ui/specter-code-shell'

export const Route = createFileRoute('/')({ component: SpecterCodeShell })
