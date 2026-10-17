import React from 'react';
import { AuthBootSplash } from '../auth/AuthBootSplash';
import { Z_PIN_LOCK } from '../../utils/overlayPortal';

/** Full-screen Lottie while the PIN lock chunk loads (blank overlay, not in-layout). */
export const PinLockFallback: React.FC = () => (
  <div className="fixed inset-0" style={{ zIndex: Z_PIN_LOCK }} aria-busy="true">
    <AuthBootSplash />
  </div>
);
