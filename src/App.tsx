import { RuntimeProvider } from './core/runtime'
import { Display } from './display/Display'

export default function App() {
  return (
    <RuntimeProvider role="display">
      <Display />
    </RuntimeProvider>
  )
}
