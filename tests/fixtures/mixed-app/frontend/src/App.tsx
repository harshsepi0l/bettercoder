import { useEffect, useState } from 'react'
import { fetchPatents } from './api/client'
import type { Patent } from '@/api/client'

export function App() {
  const [items, setItems] = useState<Patent[]>([])
  useEffect(() => {
    void fetchPatents().then(setItems)
  }, [])
  return null
}
