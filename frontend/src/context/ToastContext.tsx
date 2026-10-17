import React, { createContext, useContext, useCallback } from 'react';
import { toast as sonnerToast } from 'sonner';

interface ToastContextType {
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const showToast = useCallback(
    (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
      switch (type) {
        case 'success':
          sonnerToast.success(message);
          break;
        case 'error':
          sonnerToast.error(message);
          break;
        case 'warning':
          sonnerToast.warning(message);
          break;
        default:
          sonnerToast.info(message);
      }
    },
    []
  );

  return <ToastContext.Provider value={{ showToast }}>{children}</ToastContext.Provider>;
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
};
