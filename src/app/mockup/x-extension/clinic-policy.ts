import type { Branch } from './model';

export const locationLabel = (branch: Branch, clientName: string) => `${clientName} · ${branch.name}`;
