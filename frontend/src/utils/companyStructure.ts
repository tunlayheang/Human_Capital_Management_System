import type {
  CompanyStructureDepartmentNode,
  CompanyStructureTierGroup,
} from '../types/companyStructure';

export function tierEmployeeCount(tiers: CompanyStructureTierGroup): number {
  return tiers.manager.length + tiers.officer.length + tiers.staff.length;
}

export function departmentEmployeeCount(node: CompanyStructureDepartmentNode): number {
  let n = tierEmployeeCount(node.tiers);
  for (const child of node.children) n += departmentEmployeeCount(child);
  return n;
}

export function officeEmployeeCount(office: { departments: CompanyStructureDepartmentNode[] }): number {
  return office.departments.reduce((sum, d) => sum + departmentEmployeeCount(d), 0);
}
