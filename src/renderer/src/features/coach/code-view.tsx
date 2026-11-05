import { createContext, useContext } from 'react'
import type { CodeView } from '../../../../shared/profile'

/**
 * How step cards show real code next to pseudocode. Chosen in onboarding or Settings › You (never inside a
 * session); undefined until they pick, and cards then use Highlight.
 */
export const CodeViewContext = createContext<{ view: CodeView | undefined }>({ view: undefined })

export const useCodeView = () => useContext(CodeViewContext)
