/** Shared joins/selects for appraisal list + analytics queries. */

export const APPRAISAL_EMPLOYEE_JOINS = `
  LEFT JOIN users u ON u.id = ea.user_id
  LEFT JOIN employees e ON e.id = COALESCE(NULLIF(TRIM(u.employeeId), ''), u.id)
`;

export const APPRAISAL_EMPLOYEE_NAME_EXPR = `
  COALESCE(
    NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))), ''),
    NULLIF(TRIM(u.display_name), ''),
    u.email,
    ea.user_id
  ) AS employeeName
`;

export const APPRAISAL_EMPLOYEE_CODE_EXPR = `e.employee_id AS employeeCode`;

export const APPRAISAL_EMPLOYEE_EMAIL_EXPR = `
  COALESCE(NULLIF(TRIM(e.email), ''), NULLIF(TRIM(u.email), '')) AS employeeEmail
`;

export const APPRAISAL_EMPLOYEE_PHONE_EXPR = `
  COALESCE(NULLIF(TRIM(e.phone), ''), NULLIF(TRIM(u.phone), '')) AS employeePhone
`;

export const APPRAISAL_DEPARTMENT_ID_EXPR = `e.department_id AS departmentId`;

/** Manager/evaluator display name: employee record first, then portal display_name/email. */
export const APPRAISAL_ASSIGNED_MANAGER_JOINS = `
  LEFT JOIN users mgr ON mgr.id = ea.assigned_manager_user_id
  LEFT JOIN employees me ON me.id = COALESCE(NULLIF(TRIM(mgr.employeeId), ''), mgr.id)
`;

export const APPRAISAL_ASSIGNED_MANAGER_NAME_EXPR = `
  COALESCE(
    NULLIF(TRIM(CONCAT(COALESCE(me.last_name, ''), ' ', COALESCE(me.first_name, ''))), ''),
    NULLIF(TRIM(CONCAT(COALESCE(me.first_name, ''), ' ', COALESCE(me.last_name, ''))), ''),
    NULLIF(TRIM(mgr.display_name), ''),
    NULLIF(TRIM(SUBSTRING_INDEX(COALESCE(mgr.email, ''), '@', 1)), ''),
    NULLIF(TRIM(mgr.email), '')
  ) AS assignedManagerName
`;
