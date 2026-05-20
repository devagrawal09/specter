import type { HarlanEvent } from './harlan/events'
import type { ThreadplaneEvent } from './threadplane/events'
import type { Event as TodoEvent } from './todos-json/events'

export type Event = TodoEvent | HarlanEvent | ThreadplaneEvent
