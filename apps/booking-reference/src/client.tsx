import { render } from '@solidjs/web'

import { BookingApp } from './booking-app'
import './styles.css'

const root = document.getElementById('app')

if (!root) {
  throw new Error('Missing app root')
}

render(() => <BookingApp />, root)
