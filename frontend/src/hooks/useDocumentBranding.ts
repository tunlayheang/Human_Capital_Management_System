import { useEffect, useState } from 'react';
import {
  defaultDocumentBranding,
  loadDocumentBranding,
  type DocumentBranding,
} from '../utils/documentBranding';

export function useDocumentBranding(): DocumentBranding {
  const [branding, setBranding] = useState<DocumentBranding>(defaultDocumentBranding());

  useEffect(() => {
    let active = true;
    void loadDocumentBranding().then((loaded) => {
      if (active) setBranding(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  return branding;
}
