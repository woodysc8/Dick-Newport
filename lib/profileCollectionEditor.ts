export type EditableRecord<T> = T & { id: string };

export function appendRecord<T>(rows: readonly EditableRecord<T>[], record: EditableRecord<T>): EditableRecord<T>[] {
  return [...rows, record];
}

export function updateRecord<T>(rows: readonly EditableRecord<T>[], id: string, patch: Partial<T>): EditableRecord<T>[] {
  return rows.map((row) => row.id === id ? { ...row, ...patch, id: row.id } : row);
}

export function removeRecord<T>(rows: readonly EditableRecord<T>[], id: string): EditableRecord<T>[] {
  return rows.filter((row) => row.id !== id);
}
