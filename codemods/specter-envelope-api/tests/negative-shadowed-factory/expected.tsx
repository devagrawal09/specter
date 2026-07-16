import { createSpecterBrowserTransport } from './transport/specter-browser'

const specterClient = createSpecterBrowserTransport<Config>('/api')

function unrelated(defineSpecterClient: (url: string) => unknown) {
  return defineSpecterClient('/not-specter')
}

void specterClient
void unrelated
