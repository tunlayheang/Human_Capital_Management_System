import React from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { EmployeeCardModal } from '../components/employee/EmployeeCardModal';

/** Deep-link route: opens the ID card modal and returns to employees on close. */
export const EmployeeCard: React.FC = () => {
  const { employeeId, cardId } = useParams<{ employeeId: string; cardId?: string }>();
  const navigate = useNavigate();

  if (!employeeId) {
    return <Navigate to="/employees" replace />;
  }

  return (
    <EmployeeCardModal
      isOpen
      employeeId={employeeId}
      initialCardId={cardId ?? null}
      onClose={() => navigate('/employees')}
    />
  );
};
