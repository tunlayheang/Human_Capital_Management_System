export type StructureTier = 'manager' | 'officer' | 'staff';

export type CompanyStructureMember = {
  id: string;
  employeeCode: string;
  name: string;
  nameKh?: string;
  positionTitle: string;
  positionTitleKh?: string;
  levelLabel: string;
  tier: StructureTier;
  avatarUrl: string | null;
};

export type CompanyStructureTierGroup = {
  manager: CompanyStructureMember[];
  officer: CompanyStructureMember[];
  staff: CompanyStructureMember[];
};

export type CompanyStructureDepartmentNode = {
  id: string;
  name: string;
  nameKh?: string;
  children: CompanyStructureDepartmentNode[];
  tiers: CompanyStructureTierGroup;
};

export type CompanyStructureOfficeNode = {
  id: string;
  name: string;
  departments: CompanyStructureDepartmentNode[];
};

export type CompanyStructurePayload = {
  offices: CompanyStructureOfficeNode[];
  unassigned: CompanyStructureTierGroup;
  totals: { offices: number; departments: number; employees: number };
};
