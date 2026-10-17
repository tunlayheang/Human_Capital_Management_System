/** Attach office location label for employee list / profile (from attendance zones). */
export function enrichEmployeeWithOfficeLocation<T extends Record<string, unknown>>(
  row: T,
  offices: Array<{ id: string; name: string }> = []
): T & { officeLocationName?: string; officeLocationId?: string } {
  if (!offices.length) return row;

  const dept = row.department as Record<string, unknown> | undefined;
  const officeId = String(
    row.office_location_id ?? dept?.office_location_id ?? ''
  ).trim();
  // Do not fall back to offices[0] — that mislabels employees with no zone.
  const office = officeId ? offices.find((o) => o.id === officeId) : undefined;
  if (!office) return row;

  return {
    ...row,
    officeLocationId: office.id,
    officeLocationName: office.name,
  };
}
