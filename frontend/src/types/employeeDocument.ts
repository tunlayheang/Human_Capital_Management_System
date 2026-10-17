export type EmployeeDocumentRow = {
  id: number;
  employeeId: string;
  documentType: string;
  documentName: string;
  filePath: string;
  fileSize: number | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
