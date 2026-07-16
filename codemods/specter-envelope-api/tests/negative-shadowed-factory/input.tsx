import { defineSpecterClient } from '@specter-ts/core/client'

const specterClient = defineSpecterClient<Config>('/api')

function unrelated(defineSpecterClient: (url: string) => unknown) {
  return defineSpecterClient('/not-specter')
}

void specterClient
void unrelated
