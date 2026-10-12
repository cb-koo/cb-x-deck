import type { DemoTask, Stage } from './model';
import { stage } from './policy';

export type TaskSectionKey = 'history' | 'consent' | 'draft' | 'money' | 'memo' | 'posting';
export type TaskSectionPrefs = Partial<Record<TaskSectionKey, { open: boolean; stage: Stage }>>;

// Manual expansion survives phase changes and navigation. A manual collapse applies
// to the current phase; entering a newly relevant phase can reveal that section again.
export function taskSectionOpen(task: DemoTask, key: TaskSectionKey, preferences: TaskSectionPrefs) {
  const current = stage(task);
  const preference = preferences[key];
  if (preference?.open || preference?.stage === current) return preference.open;
  if (key === 'consent') return current === '확정';
  if (key === 'draft' || key === 'posting') return current === '방문';
  if (key === 'money') return current === '업로드' || current === '정산';
  return false;
}
