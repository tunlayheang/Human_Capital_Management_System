import React, { createContext, useContext } from 'react';

/** True when rendered under the app Layout chrome (sidebar / header). */
const InAppLayoutContext = createContext(false);

export const InAppLayoutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <InAppLayoutContext.Provider value={true}>{children}</InAppLayoutContext.Provider>
);

export function useInAppLayout(): boolean {
  return useContext(InAppLayoutContext);
}
