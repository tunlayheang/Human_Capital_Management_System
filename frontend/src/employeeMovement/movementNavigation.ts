import type { NavigateFunction } from 'react-router-dom';
import type { EmployeeMovementRow } from '../types/employeeMovement';

export function movementViewPath(row: EmployeeMovementRow, step = 0): string {
  const params = new URLSearchParams();
  params.set('movementId', row.id);
  if (step > 0) params.set('step', String(step));
  return `/employees/movements/view?${params.toString()}`;
}

export function navigateToMovementView(
  navigate: NavigateFunction,
  row: EmployeeMovementRow,
  step = 0
): void {
  navigate(movementViewPath(row, step), { state: { movement: row } });
}
