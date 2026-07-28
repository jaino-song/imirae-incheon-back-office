"use client";

import { createContext, useContext } from "react";

const InfoCardDataComponentContext = createContext<string | null>(null);

export const InfoCardDataComponentProvider = InfoCardDataComponentContext.Provider;

export function useInfoCardDataComponent(): string | null {
  return useContext(InfoCardDataComponentContext);
}
