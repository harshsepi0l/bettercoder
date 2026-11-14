import { createContext, useContext } from 'react'

/** Open a chat's board (by its chat item id) full size in Visualize mode; null where there is nowhere to open it. */
export const BoardOpenContext = createContext<((id: string) => void) | null>(null)

export function useBoardOpen(): ((id: string) => void) | null {
  return useContext(BoardOpenContext)
}
