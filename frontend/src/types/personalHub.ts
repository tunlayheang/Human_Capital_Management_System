export type PersonalHubNote = {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
  createdAt: string;
};

export type PersonalHubAlert = {
  id: string;
  title: string;
  alertAt: string;
  notes: string | null;
  isDone: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkRosterDay = {
  date: string;
  day: number;
  leaveType: string;
  category: 'working' | 'off' | 'leave' | 'holiday';
};

export type PersonalRequestItem = {
  id: string;
  kind: 'leave' | 'overtime' | 'movement';
  title: string;
  status: string;
  dateLabel: string;
  submittedAt: string;
  detail?: string;
};

export type BirthdayInfo = {
  hasBirthDate: boolean;
  birthDate?: string;
  displayName?: string;
  isToday?: boolean;
  isUpcoming?: boolean;
  daysUntil?: number;
  age?: number;
  messageKey?: 'today' | 'upcoming' | 'none';
};

export type EmployeeScheduleInfo = {
  timeIn?: string | null;
  timeOut?: string | null;
  breakDurationMinutes?: number | null;
  gracePeriodMinutes?: number | null;
} | null;

export type PersonalHubOverview = {
  birthday: BirthdayInfo;
  schedule: EmployeeScheduleInfo;
  upcomingAlerts: PersonalHubAlert[];
  requestCount: number;
};
