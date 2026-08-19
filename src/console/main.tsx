import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { RuntimeProvider } from '../core/runtime'
import { ConsoleApp } from './App'
import './console.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/console">
      {/* 后台与展示页跑的是同一个运行时，所以后台看到的判定结果与屏幕上一模一样 */}
      <RuntimeProvider role="console">
        <ConsoleApp />
      </RuntimeProvider>
    </BrowserRouter>
  </StrictMode>,
)
