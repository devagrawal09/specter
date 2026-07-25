import { render } from '@solidjs/web'
import { LastLanternApp } from './last-lantern-app'
import './styles.css'

const root = document.getElementById('app')
if (!root) throw new Error('Missing app root')
render(() => <LastLanternApp />, root)
