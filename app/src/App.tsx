import { Routes, Route } from 'react-router'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Usuarios from './pages/Usuarios'
import Leads from './pages/Leads'
import LeadDetail from './pages/LeadDetail'
import EventLog from './pages/EventLog'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Dashboard />} />
      <Route path="/usuarios" element={<Usuarios />} />
      <Route path="/leads" element={<Leads />} />
      <Route path="/leads/:id" element={<LeadDetail />} />
      <Route path="/event-log" element={<EventLog />} />
    </Routes>
  )
}
