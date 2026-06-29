import { mountColonyBenchApp } from './app'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('ColonyBench root element not found')

mountColonyBenchApp(root)
