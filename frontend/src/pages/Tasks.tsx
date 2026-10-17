import React, { useCallback, useEffect, useState } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Api } from '../services/api';
import { Task, TaskStatus, User, Role, Department } from '../types';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { onAvatarImageError, resolveMediaUrl } from '../utils/mediaUrl';
import { Plus, Calendar, Edit2, Trash2, ArrowRight, CheckCircle, Clock, Circle } from 'lucide-react';
import { Input, Select, Textarea } from '../components/ui/FormFields';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { PageShell } from '../components/ui/page';
import { LoadingState } from '../components/common/LoadingState';
import { formatDateOnlyDisplay } from '../utils/formatDisplayDate';
import { TaskAssigneeSearchSelect } from './projects/TaskModals';
import { modalInputClass } from '../components/ui/ModalForm';

const TASKS_CACHE_SLOT = 'tasks-v1';

export const Tasks: React.FC = () => {
  const { user, hasRole } = useAuth();
  const { t } = useLanguage();
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const canManageTasks = hasRole([Role.ADMIN, Role.MANAGER]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
      title: '',
      description: '',
      assigneeId: '',
      dueDate: '',
      status: TaskStatus.TODO
  });

  const tabCache = useWorkspaceTabCache<{
    tasks: Task[];
    users: User[];
    departments: Department[];
    showOverdueOnly: boolean;
  }>({
    slot: TASKS_CACHE_SLOT,
    cacheKey: user?.id ?? 'anon',
    getSnapshot: () => ({ tasks, users, departments, showOverdueOnly }),
    applySnapshot: (cached) => {
      setTasks(cached.tasks);
      setUsers(cached.users);
      setDepartments(cached.departments ?? []);
      setShowOverdueOnly(cached.showOverdueOnly);
      setLoading(false);
    },
    shouldPersist: (cached) => cached.tasks.length > 0,
    persistDeps: [tasks, users, departments, showOverdueOnly],
  });

  const loadData = useCallback(async (opts?: WorkspaceLoadOptions) => {
    if (!opts?.background) setLoading(true);
    try {
        const [tasksData, usersData, deptsData] = await Promise.all([
            Api.tasks.getAll(),
            Api.users.getAll(),
            Api.departments.getAll().catch(() => []),
        ]);

        // Filter Tasks logic (simulating backend filtering)
        let filteredTasks = tasksData;
        if (user && !hasRole([Role.ADMIN])) {
            if (hasRole([Role.MANAGER])) {
                // Managers see their own tasks + tasks assigned to their department members
                filteredTasks = tasksData.filter(task => {
                   const assignee = usersData.find(u => u.id === task.assigneeId);
                   return task.assigneeId === user.id || (assignee && assignee.departmentId === user.departmentId);
                });
            } else {
                // Employees only see assigned tasks
                filteredTasks = tasksData.filter(task => task.assigneeId === user.id);
            }
        }
        setTasks(filteredTasks);
        setUsers(usersData);
        setDepartments(Array.isArray(deptsData) ? deptsData : []);
    } catch (err) {
        console.error("Failed to load tasks", err);
    } finally {
        if (!opts?.background) setLoading(false);
    }
  }, [user, hasRole]);

  const openCreateModal = () => {
    setIsEditMode(false);
    setEditingId(null);
    setFormData({
        title: '',
        description: '',
        assigneeId: user?.id || '',
        dueDate: new Date().toISOString().split('T')[0],
        status: TaskStatus.TODO
    });
    setIsModalOpen(true);
  };

  useWorkspaceTabMountLoad(loadData, [loadData, user?.id], tabCache, Boolean(user));

  useEffect(() => {
    if (searchParams.get('action') === 'new' || searchParams.get('action') === 'assign') {
      openCreateModal();
    }
    if (searchParams.get('filter') === 'overdue') {
      setShowOverdueOnly(true);
    }
  }, [searchParams]);

  const openEditModal = (task: Task) => {
    setIsEditMode(true);
    setEditingId(task.id);
    setFormData({
        title: task.title,
        description: task.description,
        assigneeId: task.assigneeId,
        dueDate: task.dueDate,
        status: task.status
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if(!user) return;

    if (isEditMode && editingId) {
        const existing = tasks.find(t => t.id === editingId);
        if(existing) {
            await Api.tasks.update({
                ...existing,
                ...formData
            });
        }
    } else {
        await Api.tasks.create({
            ...formData,
            creatorId: user.id
        });
    }
    setIsModalOpen(false);
    loadData();
  };

  const handleDelete = async (id: string) => {
      const ok = await confirm({
        title: t('tasks.confirmDeleteTitle') || 'Delete task?',
        description:
          t('tasks.confirmDelete') ||
          'Cancel this task from the active list? It stays in history and can be shown with the Cancelled filter.',
        variant: 'danger',
        confirmLabel: 'Delete',
      });
      if (!ok) return;
      await Api.tasks.delete(id);
      loadData();
  };

  const advanceStatus = async (task: Task) => {
      let nextStatus = TaskStatus.TODO;
      if(task.status === TaskStatus.TODO) nextStatus = TaskStatus.IN_PROGRESS;
      else if(task.status === TaskStatus.IN_PROGRESS) nextStatus = TaskStatus.DONE;
      else return;

      await Api.tasks.update({ ...task, status: nextStatus });
      loadData();
  };

  const getAssignee = (id: string) => users.find(u => u.id === id);

  const TaskCard: React.FC<{ task: Task }> = ({ task }) => {
      const assignee = getAssignee(task.assigneeId);
      const isOverdue = new Date(task.dueDate) < new Date() && task.status !== TaskStatus.DONE;

      return (
          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group relative">
              <div className="flex justify-between items-start mb-3">
                 <h4 className="font-bold text-slate-800 dark:text-white line-clamp-1 pr-8 text-base">{task.title}</h4>
                 {canManageTasks && (
                    <button onClick={() => openEditModal(task)} className="opacity-0 group-hover:opacity-100 absolute top-4 right-4 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-primary-600 transition-all">
                        <Edit2 className="w-4 h-4" />
                    </button>
                 )}
              </div>
              
              <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 mb-4 h-10 leading-relaxed">{task.description}</p>
              
              <div className="flex items-center justify-between mt-auto pt-4 border-t border-slate-100 dark:border-slate-700/50">
                  <div className="flex items-center gap-3">
                      {assignee ? (
                          <img src={resolveMediaUrl(assignee.avatarUrl) || assignee.avatarUrl} title={assignee.name} className="w-8 h-8 rounded-full bg-slate-200 border-2 border-white dark:border-slate-700 shadow-sm" onError={onAvatarImageError} />
                      ) : <div className="w-8 h-8 rounded-full bg-slate-200 border-2 border-white dark:border-slate-700 shadow-sm" />}
                      <span className={`text-xs px-2.5 py-1 rounded-lg font-medium flex items-center gap-1.5 ${isOverdue ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-slate-50 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300 border border-slate-100 dark:border-slate-700'}`}>
                          <Calendar className="w-3.5 h-3.5" />
                          {formatDateOnlyDisplay(task.dueDate)}
                      </span>
                  </div>

                  {task.status !== TaskStatus.DONE && (
                      <button onClick={() => advanceStatus(task)} className="p-2 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-full text-primary-600 dark:text-primary-400 transition-colors" title="Move to next stage">
                          <ArrowRight className="w-4 h-4" />
                      </button>
                  )}
                  {task.status === TaskStatus.DONE && (
                      <div className="p-1.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-full">
                        <CheckCircle className="w-4 h-4 text-emerald-500" />
                      </div>
                  )}
              </div>
          </div>
      );
  };

  const visibleTasks = showOverdueOnly
    ? tasks.filter((t) => new Date(t.dueDate) < new Date() && t.status !== TaskStatus.DONE)
    : tasks;

  const Column = ({ title, status, icon: Icon, color }: any) => {
      const colTasks = visibleTasks.filter(t => t.status === status);
      return (
          <div className="flex flex-col lg:h-full bg-slate-50/50 dark:bg-slate-900/50 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 w-full min-w-0 lg:min-w-[280px] lg:max-w-[360px] backdrop-blur-sm">
              <div className={`p-3 sm:p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center ${color} bg-opacity-10 rounded-t-xl sm:rounded-t-2xl`}>
                  <div className="flex items-center gap-2.5 font-bold text-slate-700 dark:text-slate-200">
                      <div className={`p-1.5 rounded-lg ${color} bg-opacity-20`}>
                        <Icon className={`w-4 h-4 ${color.replace('bg-', 'text-')}`} />
                      </div>
                      {title}
                  </div>
                  <span className="bg-white dark:bg-slate-800 px-2.5 py-1 rounded-lg text-xs font-bold shadow-sm border border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-400">{colTasks.length}</span>
              </div>
              <div className="p-3 sm:p-4 space-y-3 sm:space-y-4 lg:overflow-y-auto lg:flex-1 lg:max-h-[calc(100dvh-16rem)] scrollbar-thin custom-scrollbar">
                  {colTasks.map(task => <TaskCard key={task.id} task={task} />)}
                  {colTasks.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-32 text-slate-400 text-sm italic border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                          <p>{t('tasks.noTasks') || 'No tasks'}</p>
                      </div>
                  )}
              </div>
          </div>
      );
  };

  return (
    <PageShell className="flex flex-col min-h-0 lg:min-h-[calc(100dvh-10rem)]">
      <ConfirmDialogHost />
        <div className="surface-card surface-card-pad flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
            <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{t('tasks.title')}</h1>
                <p className="text-slate-500 dark:text-slate-400 mt-0.5 text-sm">{t('tasks.subtitle') || 'Track and manage team assignments'}</p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
            {showOverdueOnly && (
              <Button type="button" variant="outline" onClick={() => setShowOverdueOnly(false)} className="rounded-xl">
                Show all tasks
              </Button>
            )}
            {canManageTasks && (
                <Button type="button" onClick={openCreateModal} className="flex-1 sm:flex-none bg-primary-600 hover:bg-primary-700 text-white shadow-lg shadow-primary-500/30 rounded-xl py-2.5">
                    <Plus className="w-4 h-4 mr-2" /> {t('tasks.create')}
                </Button>
            )}
            </div>
        </div>

        <div className="flex-1 min-w-0 lg:overflow-x-auto pb-4">
            {loading ? (
              <LoadingState variant="page" layout="cards" label={t('common.retrievingData')} />
            ) : (
            <div className="flex flex-col lg:flex-row gap-3 sm:gap-4 lg:flex-1 lg:min-h-0 min-w-0">
                <Column title={t('tasks.todo')} status={TaskStatus.TODO} icon={Circle} color="bg-slate-500" />
                <Column title={t('tasks.inProgress')} status={TaskStatus.IN_PROGRESS} icon={Clock} color="bg-primary-500" />
                <Column title={t('tasks.done')} status={TaskStatus.DONE} icon={CheckCircle} color="bg-emerald-500" />
            </div>
            )}
        </div>

        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={isEditMode ? (t('tasks.editTask') || "Edit Task") : (t('tasks.create') || "Create New Task")}
          description={isEditMode ? 'Update task details and status.' : 'Provide clear task details for your team.'}
        >
            <form onSubmit={handleSubmit} className="space-y-5">
                <Input label={t('tasks.titleLabel') || "Title"} required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} placeholder="Task title" />
                
                <div className="responsive-form-grid">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('tasks.assignTo') || 'Assign To'}
                      </label>
                      <TaskAssigneeSearchSelect
                        value={formData.assigneeId}
                        employees={users}
                        departments={departments}
                        allowUnassigned={false}
                        onChange={(assigneeId) => setFormData({ ...formData, assigneeId })}
                        className={modalInputClass}
                      />
                    </div>
                    <Input label={t('tasks.dueDate') || "Due Date"} type="date" required value={formData.dueDate} onChange={e => setFormData({...formData, dueDate: e.target.value})} />
                </div>

                {isEditMode && (
                    <Select 
                        label={t('tasks.status') || "Status"}
                        value={formData.status}
                        onChange={e => setFormData({...formData, status: e.target.value as TaskStatus})}
                        options={[
                            { value: TaskStatus.TODO, label: t('tasks.todo') || 'To Do' },
                            { value: TaskStatus.IN_PROGRESS, label: t('tasks.inProgress') || 'In Progress' },
                            { value: TaskStatus.DONE, label: t('tasks.done') || 'Done' }
                        ]}
                    />
                )}

                <Textarea label={t('tasks.description') || "Description"} required rows={4} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Task details..." />

                <div className="hcms-modal-actions hcms-modal-actions--between">
                    {isEditMode && (
                        <Button type="button" variant="danger" size="sm" onClick={() => { setIsModalOpen(false); handleDelete(editingId!); }} className="rounded-xl">
                            <Trash2 className="w-4 h-4 mr-2" /> {t('common.delete') || 'Delete'}
                        </Button>
                    )}
                    <div className="flex gap-3 ml-auto">
                        <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>{t('common.cancel') || 'Cancel'}</Button>
                        <Button type="submit" className="bg-primary-600 hover:bg-primary-700 text-white shadow-lg shadow-primary-500/30 rounded-xl">{isEditMode ? (t('tasks.saveChanges') || 'Save Changes') : (t('tasks.createTask') || 'Create Task')}</Button>
                    </div>
                </div>
            </form>
        </Modal>
    </PageShell>
  );
};

export default Tasks;