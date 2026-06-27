'use client'

import { createContext, useContext } from 'react'

const InsideClerkContext = createContext(false)

export function InsideClerkProvider({ children }: { children: React.ReactNode }) {
  return <InsideClerkContext.Provider value>{children}</InsideClerkContext.Provider>
}

export function useInsideClerk() {
  return useContext(InsideClerkContext)
}
