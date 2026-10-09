import type { CatalogSupportReason } from '../src/data/catalogSupport';

export interface CatalogEvidenceEntry {
  machine: string;
  status: string;
}

export interface CatalogEvidenceReport<T extends CatalogEvidenceEntry> {
  semanticAudit: string;
  count: number;
  formed: number;
  rejected: number;
  exceptions: number;
  unresolved: number;
  entries: T[];
}

export const retainedShapes: readonly string[];
export function problemEntries<T extends CatalogEvidenceEntry>(report: CatalogEvidenceReport<T>): T[];
export function supportCode(entry: CatalogEvidenceEntry): CatalogSupportReason | undefined;
export function supportStatus(entry: CatalogEvidenceEntry): 'limited' | 'known-problem' | 'unverified';
export function generateStatus(): Promise<Record<string, string>>;
