import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useWorkspaceNavigate } from '../hooks/useWorkspaceNavigate';
import { isManageScope } from '../utils/selfServiceScope';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PageShell } from '../components/ui/page';
import { PageLoading } from '../components/ui/page/PageLoading';
import { Department, Project, ProjectStatus, Task, User } from '../types';
import { Api } from '../services/api';
import { projectService } from '../services/projectService';
import { taskService } from '../services/taskService';
import { userService } from '../services/userService';
import { ProjectsMainView } from './projects/ProjectsMainView';
import { canViewAllProjects } from './projects/projectAccess';
import { ProjectDetailView, ProjectDetails } from './projects/ProjectDetailView';
import {
  CreateProjectModal,
  defaultCreateProjectForm,
  validateCreateProjectForm,
} from './projects/CreateProjectModal';
import {
  AddTaskModal,
  EditTaskModal,
  defaultNewTaskForm,
  NewTaskForm,
} from './projects/TaskModals';
import { ProjectSettingsModal } from './projects/ProjectSettingsModal';
import { PROJECT_DELETED_FILTER } from '../services/projectService';
import { PERM } from '../constants/permissionKeys';
import { ShieldOff } from 'lucide-react';

type StatusFilter = 'ALL' | ProjectStatus | typeof PROJECT_DELETED_FILTER;
type MainTab = 'overview' | 'timeline';

const ProjectsPage: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const { goTo } = useWorkspaceNavigate();
  const manageScope = isManageScope(searchParams);
  const mainTab: MainTab =
    searchParams.get('tab') === 'timeline' ? 'timeline' : 'overview';

  const [projects, setProjects] = useState<Project[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState(defaultCreateProjectForm());
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isEditTaskModalOpen, setIsEditTaskModalOpen] = useState(false);
  const [isTaskSubmitting, setIsTaskSubmitting] = useState(false);
  const [newTask, setNewTask] = useState<NewTaskForm>(defaultNewTaskForm());
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [settingsProject, setSettingsProject] = useState<Project | null>(null);
  const handledDeepLinkRef = useRef('');

  /** Admin/HR only — Managers and staff get assignment-scoped lists from the API. */
  const viewAllProjects = useMemo(
    () => canViewAllProjects(user?.role),
    [user?.role]
  );

  /** Self-service: tasks assigned to me. Management: own/assigned (unless view-all). */
  const tasksOnly = !manageScope;

  const canConfigureProject = useMemo(
    () =>
      hasPermission('projects.edit.info') ||
      hasPermission('projects.edit.lead') ||
      hasPermission('projects.edit.status'),
    [hasPermission]
  );

  const canViewSelf = hasPermission(PERM.PROJECTS_SELF_VIEW);
  const canViewManage = hasPermission(PERM.PROJECTS_VIEW);

  const scopeKey = manageScope ? 'manage' : 'self';
  const tabCache = useWorkspaceTabCache<{
    projects: Project[];
    allTasks: Task[];
    employees: User[];
    departments: Department[];
    statusFilter: StatusFilter;
    searchTerm: string;
    selectedProjectId: string | null;
    mainTab: MainTab;
  }>({
    slot: 'projects-v1',
    cacheKey: `${scopeKey}:${mainTab}`,
    getSnapshot: () => ({
      projects,
      allTasks,
      employees,
      departments,
      statusFilter,
      searchTerm,
      selectedProjectId,
      mainTab,
    }),
    applySnapshot: (cached) => {
      setProjects(cached.projects);
      setAllTasks(cached.allTasks);
      setEmployees(cached.employees);
      setDepartments(cached.departments);
      setStatusFilter(cached.statusFilter);
      setSearchTerm(cached.searchTerm);
      setSelectedProjectId(cached.selectedProjectId);
      setInitialLoading(false);
    },
    shouldPersist: (cached) => cached.projects.length > 0,
    persistDeps: [
      projects,
      allTasks,
      employees,
      departments,
      statusFilter,
      searchTerm,
      selectedProjectId,
      mainTab,
    ],
  });

  const loadProjects = useCallback(async (opts?: WorkspaceLoadOptions) => {
    try {
      const data = await projectService.getAll(statusFilter === 'ALL' ? undefined : statusFilter, {
        tasksOnly,
      });
      setProjects(data);
    } catch {
      if (!opts?.background) showToast('Failed to load projects', 'error');
    } finally {
      if (!opts?.background) setInitialLoading(false);
    }
  }, [statusFilter, showToast, tasksOnly]);

  useWorkspaceTabMountLoad(loadProjects, [loadProjects], tabCache);

  /** Returns the freshly fetched tasks so callers can refresh details without waiting for state. */
  const loadReferenceData = useCallback(async (): Promise<Task[]> => {
    try {
      const [users, tasks, depts] = await Promise.all([
        userService.getAll(),
        taskService.getAll({ deleted: 'include' }),
        Api.departments.getAll(),
      ]);
      setEmployees(users);
      setAllTasks(tasks);
      setDepartments(Array.isArray(depts) ? depts : []);
      return tasks;
    } catch {
      setEmployees([]);
      setAllTasks([]);
      setDepartments([]);
      return [];
    }
  }, []);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  const openCreateModal = () => {
    setCreateForm(defaultCreateProjectForm(user?.id));
    setShowCreateModal(true);
  };

  const openDetails = useCallback(
    async (projectId: string, taskSource?: Task[]) => {
      const project = await projectService.getById(projectId, {
        tasksOnly,
      });
      if (!project) {
        showToast('You do not have access to this project', 'error');
        return;
      }
      let tasks = (taskSource ?? allTasks).filter((t) => t.projectId === projectId);
      if (tasksOnly && user?.id) {
        tasks = tasks.filter((t) => t.assigneeId === user.id);
      }
      // Active project view uses non-deleted tasks for progress; deleted stay available via filter.
      setDetails({
        project,
        tasks,
        members: project.members ?? [],
        milestones: project.milestones ?? [],
      });
      setSelectedProjectId(projectId);
    },
    [showToast, user?.id, tasksOnly, allTasks]
  );

  const handleOpenDetails = useCallback(
    async (projectId: string) => {
      // Opening from Timeline should land in Overview context when the user goes back.
      if (mainTab === 'timeline') {
        goTo(
          '/projects',
          `?scope=${manageScope ? 'manage' : 'self'}&tab=overview`
        );
      }
      await openDetails(projectId);
    },
    [mainTab, manageScope, goTo, openDetails]
  );

  useEffect(() => {
    const projectId = String(searchParams.get('project') || '').trim();
    const taskId = String(searchParams.get('task') || '').trim();
    if (!projectId) return;
    const key = `${projectId}:${taskId}`;
    if (handledDeepLinkRef.current === key) return;
    handledDeepLinkRef.current = key;

    void (async () => {
      const taskSource = allTasks.length ? allTasks : await loadReferenceData();
      await openDetails(projectId, taskSource);
      if (taskId) {
        const task = taskSource.find(
          (candidate) => candidate.id === taskId && candidate.projectId === projectId
        );
        if (task) {
          setEditingTask(task);
          setIsEditTaskModalOpen(true);
        }
      }
    })();
  }, [allTasks, loadReferenceData, openDetails, searchParams]);

  const handleCreateProject = async () => {
    const validationError = validateCreateProjectForm(createForm);
    if (validationError) {
      showToast(validationError, 'error');
      return;
    }
    setIsCreatingProject(true);
    try {
      const memberIds = Array.from(
        new Set([createForm.leadId, user?.id].filter((id): id is string => Boolean(id)))
      );
      await projectService.create({
        title: createForm.title.trim(),
        description: createForm.description.trim(),
        startDate: createForm.startDate,
        deadline: createForm.deadline,
        status: createForm.status,
        priority: createForm.priority,
        departmentId: createForm.departmentId,
        leadId: createForm.leadId,
        progress: 0,
        members: memberIds,
      });
      showToast('Project created successfully', 'success');
      setShowCreateModal(false);
      await loadProjects();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create project', 'error');
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleDeleteProject = async (id: string) => {
    await projectService.delete(id);
    loadProjects();
    if (selectedProjectId === id) {
      setSelectedProjectId(null);
      setDetails(null);
    }
  };

  const resetTaskForm = () => setNewTask(defaultNewTaskForm());

  const handleCreateTask = async () => {
    if (!details?.project || !user) return;
    setIsTaskSubmitting(true);
    try {
      const isStaff = String(user.role || '').toUpperCase() === 'EMPLOYEE';
      await taskService.create({
        title: newTask.title.trim(),
        description: newTask.description,
        assigneeId: isStaff ? user.id : newTask.assigneeId,
        status: newTask.status,
        priority: newTask.priority,
        startDate: newTask.startDate,
        dueDate: newTask.dueDate,
        estimatedHours: newTask.estimatedHours,
        projectId: details.project.id,
        creatorId: user.id,
        progress: 0,
        loggedHours: 0,
        dependencies: [],
        subtasks: [],
        comments: [],
      });
      await openDetails(details.project.id, await loadReferenceData());
      resetTaskForm();
      setIsTaskModalOpen(false);
      showToast('Task created successfully!', 'success');
      loadProjects();
    } catch (err: unknown) {
      showToast(
        err instanceof Error ? err.message : 'Failed to create task. Please try again.',
        'error'
      );
    } finally {
      setIsTaskSubmitting(false);
    }
  };

  const handleUpdateTask = async () => {
    if (!editingTask || !details?.project) return;
    setIsTaskSubmitting(true);
    try {
      await taskService.update(editingTask);
      await openDetails(details.project.id, await loadReferenceData());
      setIsEditTaskModalOpen(false);
      setEditingTask(null);
      showToast('Task updated successfully!', 'success');
      loadProjects();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update task.', 'error');
    } finally {
      setIsTaskSubmitting(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!details?.project) return;
    await taskService.delete(taskId);
    await openDetails(details.project.id, await loadReferenceData());
    loadProjects();
  };

  const handleProjectSettingsSaved = useCallback(async () => {
    const projectId = settingsProject?.id;
    setSettingsProject(null);
    await loadProjects();
    if (projectId && selectedProjectId === projectId) {
      await openDetails(projectId);
    }
  }, [settingsProject?.id, selectedProjectId, loadProjects, openDetails]);

  const isStaffUser = String(user?.role || '').toUpperCase() === 'EMPLOYEE';

  const canProgressTask = (task: Task) =>
    Boolean(user?.id) &&
    (task.assigneeId === user?.id ||
      (!isStaffUser && hasPermission('tasks.progress')));

  // Staff may only update their assigned task progress — not full task admin fields.
  const editModalTitle =
    isStaffUser || !hasPermission('tasks.edit.info') ? 'Update Task Progress' : 'Edit Task';

  if (!canViewSelf && !canViewManage) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
        <ShieldOff className="w-14 h-14 text-slate-400 mb-4" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Access restricted</h2>
        <p className="text-slate-500 dark:text-slate-400 mt-2">
          You do not have permission to view projects.
        </p>
      </div>
    );
  }

  if (manageScope && !canViewManage) {
    return <Navigate to="/projects?scope=self" replace />;
  }

  if (!manageScope && !canViewSelf) {
    return <Navigate to="/projects?scope=manage" replace />;
  }

  return (
    <PageShell>
      {initialLoading && !selectedProjectId ? (
        <PageLoading layout="cards" />
      ) : selectedProjectId && !details ? (
        <PageLoading layout="table" />
      ) : selectedProjectId && details ? (
        <ProjectDetailView
          details={details}
          employees={employees}
          onBack={() => {
            setSelectedProjectId(null);
            setDetails(null);
          }}
          hasPermission={hasPermission}
          onDeleteTask={handleDeleteTask}
          onEditTask={(task) => {
            setEditingTask({ ...task });
            setIsEditTaskModalOpen(true);
          }}
          onAddTask={() => setIsTaskModalOpen(true)}
          onOpenSettings={
            canConfigureProject && !details.project.deletedAt
              ? () => setSettingsProject(details.project)
              : undefined
          }
        />
      ) : (
        <ProjectsMainView
          projects={projects}
          allTasks={allTasks}
          employees={employees}
          scopedToMyAssignments={tasksOnly}
          assignmentScoped={!viewAllProjects && manageScope}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          mainTab={mainTab}
          showMainTabs={manageScope}
          canCreate={manageScope && hasPermission('projects.create')}
          canDelete={manageScope && hasPermission('projects.delete')}
          canConfigure={manageScope && canConfigureProject}
          onOpenCreate={openCreateModal}
          onOpenDetails={handleOpenDetails}
          onOpenSettings={setSettingsProject}
          onDeleteProject={handleDeleteProject}
        />
      )}

      <CreateProjectModal
        isOpen={showCreateModal}
        form={createForm}
        onChange={setCreateForm}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateProject}
        departments={departments}
        employees={employees}
        currentUser={user ?? undefined}
        isSubmitting={isCreatingProject}
      />

      <AddTaskModal
        isOpen={isTaskModalOpen}
        project={details?.project}
        employees={employees}
        departments={departments}
        currentUser={user ?? undefined}
        isSubmitting={isTaskSubmitting}
        form={newTask}
        onChange={setNewTask}
        onClose={() => setIsTaskModalOpen(false)}
        onSubmit={handleCreateTask}
      />

      <EditTaskModal
        isOpen={isEditTaskModalOpen}
        task={editingTask}
        project={details?.project}
        employees={employees}
        departments={departments}
        isSubmitting={isTaskSubmitting}
        canEditInfo={!isStaffUser && hasPermission('tasks.edit.info')}
        canEditDates={
          !isStaffUser &&
          (hasPermission('tasks.edit.dates') || hasPermission('tasks.edit.info'))
        }
        canProgress={editingTask ? canProgressTask(editingTask) : false}
        canAssign={!isStaffUser && hasPermission('tasks.assign')}
        title={editModalTitle}
        onClose={() => {
          setIsEditTaskModalOpen(false);
          setEditingTask(null);
        }}
        onChange={setEditingTask}
        onSubmit={handleUpdateTask}
      />

      <ProjectSettingsModal
        isOpen={!!settingsProject}
        project={settingsProject}
        employees={employees}
        canEditInfo={hasPermission('projects.edit.info')}
        canEditLead={hasPermission('projects.edit.lead')}
        canEditStatus={hasPermission('projects.edit.status')}
        onClose={() => setSettingsProject(null)}
        onSaved={() => void handleProjectSettingsSaved()}
        showToast={showToast}
      />
    </PageShell>
  );
};

export const Projects = ProjectsPage;
