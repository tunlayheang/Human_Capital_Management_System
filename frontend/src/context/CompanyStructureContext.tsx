import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type CompanyStructureContextValue = {
  isOpen: boolean;
  openCompanyStructure: () => void;
  closeCompanyStructure: () => void;
};

const CompanyStructureContext = createContext<CompanyStructureContextValue | null>(null);

export const CompanyStructureProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);

  const openCompanyStructure = useCallback(() => setIsOpen(true), []);
  const closeCompanyStructure = useCallback(() => setIsOpen(false), []);

  const value = useMemo(
    () => ({ isOpen, openCompanyStructure, closeCompanyStructure }),
    [isOpen, openCompanyStructure, closeCompanyStructure]
  );

  return (
    <CompanyStructureContext.Provider value={value}>{children}</CompanyStructureContext.Provider>
  );
};

export function useCompanyStructure(): CompanyStructureContextValue {
  const ctx = useContext(CompanyStructureContext);
  if (!ctx) {
    throw new Error('useCompanyStructure must be used within CompanyStructureProvider');
  }
  return ctx;
}
