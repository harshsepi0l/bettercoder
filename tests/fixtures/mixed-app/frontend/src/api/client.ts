export interface Patent {
  title: string
  year: number
}

export interface LibraryPatent extends Patent {
  savedAt: string
}

export async function fetchPatents(): Promise<Patent[]> {
  const res = await fetch('/api/patents')
  return res.json()
}
