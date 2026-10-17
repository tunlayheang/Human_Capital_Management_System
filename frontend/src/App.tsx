import React, { Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/routing/ProtectedRoute';
import { PERM } from './constants/permissionKeys';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider } from './context/LanguageContext';
import { ToastProvider } from './context/ToastContext';
import { AuthenticatedProviders } from './context/AuthenticatedProviders';
import { Role } from './types';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AuthBootSplash } from './components/auth/AuthBootSplash';
import { AuthenticatedShell } from './components/auth/AuthenticatedShell';
import { Toaster } from './components/ui/shadcn/sonner';

// --- LAZY LOADED PAGES ---
// This splits the code into smaller chunks, loading them only when needed.
const Login = React.lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const StaffVerifyPage = React.lazy(() =>
  import('./pages/StaffVerifyPage').then((m) => ({ default: m.StaffVerifyPage }))
);
const Dashboard = React.lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Attendance = React.lazy(() => import('./pages/Attendance').then(m => ({ default: m.Attendance })));
const AttendanceScanPage = React.lazy(() =>
  import('./pages/AttendanceScanPage').then((m) => ({ default: m.AttendanceScanPage }))
);
const EmployeeModule = React.lazy(() => import('./pages/EmployeeModule').then(m => ({ default: m.EmployeeModule })));
const EmployeeCard = React.lazy(() => import('./pages/EmployeeCard').then((m) => ({ default: m.EmployeeCard })));
const Projects = React.lazy(() => import('./pages/Projects').then(m => ({ default: m.Projects })));
const Leaves = React.lazy(() => import('./pages/Leaves').then(m => ({ default: m.Leaves })));
const Overtime = React.lazy(() => import('./pages/Overtime').then(m => ({ default: m.Overtime })));
const ApprovalsModule = React.lazy(() =>
  import('./pages/ApprovalsModule').then((m) => ({ default: m.ApprovalsModule }))
);
const PayrollModule = React.lazy(() =>
  import('./pages/payroll/PayrollModule').then((m) => ({ default: m.PayrollModule }))
);
const Departments = React.lazy(() => import('./pages/Departments').then(m => ({ default: m.Departments })));
const DepartmentDetail = React.lazy(() => import('./pages/DepartmentDetail').then(m => ({ default: m.DepartmentDetail })));
const Profile = React.lazy(() => import('./pages/Profile'));
const ReportsModule = React.lazy(() =>
  import('./pages/ReportsModule').then((m) => ({ default: m.ReportsModule }))
);
const Chat = React.lazy(() => import('./pages/Chat').then(m => ({ default: m.Chat })));
const Notifications = React.lazy(() =>
  import('./pages/Notifications').then((m) => ({ default: m.Notifications }))
);
const CompanyStructure = React.lazy(() =>
  import('./pages/CompanyStructure').then((m) => ({ default: m.CompanyStructure }))
);
const SystemSettings = React.lazy(() => import('./pages/SystemSettings'));
const UserManagement = React.lazy(() => import('./pages/UserManagement').then(m => ({ default: m.UserManagement })));
const PermissionManagement = React.lazy(() =>
  import('./pages/PermissionManagement').then((m) => ({ default: m.PermissionManagement }))
);
const AuditLogs = React.lazy(() => import('./pages/AuditLogs'));
const AuditTrail = React.lazy(() => import('./pages/AuditTrail'));
const DatabaseBackup = React.lazy(() => import('./pages/DatabaseBackup'));
const Forbidden = React.lazy(() => import('./pages/Forbidden'));
const Tasks = React.lazy(() => import('./pages/Tasks'));
const MyPayroll = React.lazy(() => import('./pages/MyPayroll').then((m) => ({ default: m.MyPayroll })));
const AccountSettings = React.lazy(() => import('./pages/AccountSettings'));
const EmployeePerformance = React.lazy(() =>
  import('./pages/EmployeePerformance').then((m) => ({ default: m.EmployeePerformance }))
);
const MyPerformance = React.lazy(() =>
  import('./pages/MyPerformance').then((m) => ({ default: m.MyPerformance }))
);
const PersonalAnalytics = React.lazy(() =>
  import('./pages/PersonalAnalytics').then((m) => ({ default: m.PersonalAnalytics }))
);

const App: React.FC = () => {
  return (
    <HashRouter>
      <ErrorBoundary>
        <LanguageProvider>
          <ThemeProvider>
            <Toaster richColors closeButton />
            <ToastProvider>
              <AuthProvider>
                    <Suspense fallback={<AuthBootSplash />}>
                      <Routes>
                        {/* Public Routes — careers landing lives on /login; home-screen start_url is /dashboard */}
                        <Route path="/" element={<Navigate to="/login" replace />} />
                        <Route path="/login" element={<Login />} />
                        <Route path="/verify/:employeeId" element={<StaffVerifyPage />} />
                        <Route
                          path="/attendance/scan"
                          element={
                            <ProtectedRoute>
                              <AuthenticatedProviders>
                                <AttendanceScanPage />
                              </AuthenticatedProviders>
                            </ProtectedRoute>
                          }
                        />
                        <Route
                          path="/forbidden"
                          element={
                            <ProtectedRoute>
                              <Forbidden />
                            </ProtectedRoute>
                          }
                        />

                        {/* App Routes */}
                        <Route path="/app" element={<ProtectedRoute><Navigate to="/dashboard" replace /></ProtectedRoute>} />
                        
                        <Route element={<AuthenticatedShell />}>
                            {/* Common / self-service */}
                            <Route
                              path="/dashboard"
                              element={
                                <ProtectedRoute permission={PERM.DASHBOARD_VIEW}>
                                  <Dashboard />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/projects"
                              element={
                                <ProtectedRoute
                                  permissionAny={[
                                    PERM.PROJECTS_SELF_VIEW,
                                    PERM.PROJECTS_VIEW,
                                  ]}
                                >
                                  <Projects />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/tasks"
                              element={
                                <ProtectedRoute permission={PERM.PROJECTS_VIEW}>
                                  <Tasks />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/my-pay"
                              element={
                                <ProtectedRoute permission={PERM.PAYROLL_MYPAY_VIEW}>
                                  <MyPayroll />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/personal-analytics"
                              element={
                                <ProtectedRoute permission={PERM.PERSONAL_VIEW}>
                                  <PersonalAnalytics />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/performance"
                              element={
                                <ProtectedRoute
                                  roles={[Role.ADMIN, Role.HR, Role.MANAGER]}
                                  permission={PERM.PERFORMANCE_VIEW}
                                >
                                  <EmployeePerformance />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/my-performance"
                              element={
                                <ProtectedRoute permission={PERM.PERSONAL_VIEW}>
                                  <MyPerformance />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/my-performance-reviews"
                              element={<Navigate to="/my-performance" replace />}
                            />
                            <Route path="/profile/security" element={<Navigate to="/account-settings" replace />} />
                            <Route
                              path="/account-settings"
                              element={
                                <ProtectedRoute permission={PERM.ACCOUNT_SETTINGS_VIEW}>
                                  <AccountSettings />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/leaves"
                              element={
                                <ProtectedRoute permission={PERM.LEAVE_VIEW}>
                                  <Leaves />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/approvals/evaluations/self"
                              element={
                                <ProtectedRoute
                                  roles={[Role.EMPLOYEE, Role.HR, Role.MANAGER, Role.ADMIN]}
                                  permission={PERM.PERSONAL_VIEW}
                                >
                                  <Navigate to="/my-performance?tab=action" replace />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/approvals/*"
                              element={
                                <ProtectedRoute
                                  roles={[Role.ADMIN, Role.HR, Role.MANAGER]}
                                  permissionAny={[
                                    PERM.LEAVE_APPROVE,
                                    PERM.OVERTIME_MANAGE,
                                    PERM.EMPLOYEE_MOVEMENTS,
                                    PERM.PAYROLL_APPROVE,
                                    PERM.PERFORMANCE_VIEW,
                                    PERM.PERFORMANCE_APPRAISAL_VIEW,
                                  ]}
                                >
                                  <ApprovalsModule />
                                </ProtectedRoute>
                              }
                            />
                            <Route path="/reviews/kpi" element={<Navigate to="/approvals/evaluations/kpi" replace />} />
                            <Route path="/reviews/probation" element={<Navigate to="/approvals/evaluations/probation" replace />} />
                            <Route
                              path="/reviews/self"
                              element={
                                <ProtectedRoute
                                  roles={[Role.EMPLOYEE, Role.HR, Role.MANAGER, Role.ADMIN]}
                                  permission={PERM.PERSONAL_VIEW}
                                >
                                  <Navigate to="/my-performance?tab=action" replace />
                                </ProtectedRoute>
                              }
                            />
                            <Route path="/reviews" element={<Navigate to="/dashboard" replace />} />
                            <Route
                              path="/overtime"
                              element={
                                <ProtectedRoute permission={PERM.OVERTIME_VIEW}>
                                  <Overtime />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/chat"
                              element={
                                <ProtectedRoute permission={PERM.CHAT_VIEW}>
                                  <Chat />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/notifications"
                              element={
                                <ProtectedRoute permission={PERM.NOTIFICATIONS_VIEW}>
                                  <Notifications />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/company-structure"
                              element={
                                <ProtectedRoute permission={PERM.COMPANY_STRUCTURE_VIEW}>
                                  <CompanyStructure />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/profile"
                              element={
                                <ProtectedRoute permission={PERM.PROFILE_VIEW}>
                                  <Profile />
                                </ProtectedRoute>
                              }
                            />

                            <Route
                              path="/attendance"
                              element={
                                <ProtectedRoute permission={PERM.ATTENDANCE_VIEW}>
                                  <Attendance />
                                </ProtectedRoute>
                              }
                            />

                            <Route
                              path="/employees/card/:employeeId/:cardId"
                              element={
                                <ProtectedRoute
                                  roles={[Role.ADMIN, Role.HR, Role.MANAGER]}
                                  permission={PERM.EMPLOYEE_VIEW}
                                >
                                  <EmployeeCard />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/employees/card/:employeeId"
                              element={
                                <ProtectedRoute
                                  roles={[Role.ADMIN, Role.HR, Role.MANAGER]}
                                  permission={PERM.EMPLOYEE_VIEW}
                                >
                                  <EmployeeCard />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/employees/*"
                              element={
                                <ProtectedRoute
                                  roles={[Role.ADMIN, Role.HR, Role.MANAGER]}
                                  permission={PERM.EMPLOYEE_VIEW}
                                >
                                  <EmployeeModule />
                                </ProtectedRoute>
                              }
                            />

                            <Route
                              path="/payroll/*"
                              element={
                                <ProtectedRoute
                                  roles={[Role.ADMIN, Role.HR, Role.MANAGER]}
                                  permissionAny={[PERM.PAYROLL_VIEW, PERM.PAYROLL_APPROVE]}
                                >
                                  <PayrollModule />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/departments"
                              element={
                                <ProtectedRoute
                                  roles={[Role.ADMIN, Role.HR, Role.MANAGER]}
                                  permission={PERM.DEPARTMENTS_VIEW}
                                >
                                  <Departments />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/departments/:id"
                              element={
                                <ProtectedRoute
                                  roles={[Role.ADMIN, Role.HR, Role.MANAGER]}
                                  permission={PERM.DEPARTMENTS_VIEW}
                                >
                                  <DepartmentDetail />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/reports/*"
                              element={
                                <ProtectedRoute
                                  roles={[Role.ADMIN, Role.HR]}
                                  permission={PERM.REPORTS_VIEW}
                                >
                                  <ReportsModule />
                                </ProtectedRoute>
                              }
                            />

                            {/* Administration — matrix Grant/Deny controls access for every role */}
                            <Route
                              path="/settings"
                              element={
                                <ProtectedRoute
                                  roles={[Role.ADMIN, Role.HR]}
                                  permissionAny={[PERM.SETTINGS_VIEW, PERM.SETTINGS_SECURITY_VIEW]}
                                >
                                  <SystemSettings />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/settings/backup"
                              element={
                                <ProtectedRoute roles={[Role.ADMIN]}>
                                  <DatabaseBackup />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/users"
                              element={
                                <ProtectedRoute
                                  roles={[Role.ADMIN, Role.HR]}
                                  permission={PERM.USERS_VIEW}
                                >
                                  <UserManagement />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/permissions"
                              element={
                                <ProtectedRoute
                                  roles={[Role.ADMIN, Role.HR]}
                                  permission={PERM.PERMISSIONS_VIEW}
                                >
                                  <PermissionManagement />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/audit/logs"
                              element={
                                <ProtectedRoute
                                  roles={[Role.ADMIN, Role.HR]}
                                  permission={PERM.AUDIT_VIEW}
                                >
                                  <AuditLogs />
                                </ProtectedRoute>
                              }
                            />
                            <Route
                              path="/audit/trail"
                              element={
                                <ProtectedRoute
                                  roles={[Role.ADMIN, Role.HR]}
                                  permission={PERM.AUDIT_VIEW}
                                >
                                  <AuditTrail />
                                </ProtectedRoute>
                              }
                            />
                            <Route path="/permissions/matrix" element={<Navigate to="/permissions" replace />} />
                            <Route path="/permissions/users" element={<Navigate to="/permissions" replace />} />
                            <Route
                              path="/permissions/menu"
                              element={<Navigate to="/permissions?tab=matrix" replace />}
                            />
                            <Route path="/settings/enhanced" element={<Navigate to="/settings" replace />} />
                            <Route path="/dashboard/enhanced" element={<Navigate to="/dashboard" replace />} />
                        </Route>
                      </Routes>
                    </Suspense>
              </AuthProvider>
            </ToastProvider>
          </ThemeProvider>
        </LanguageProvider>
      </ErrorBoundary>
    </HashRouter>
  );
};

export default App;