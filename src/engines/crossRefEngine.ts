import { getSymbolDef } from '../data/symbolCatalog';
import { CrossReferenceEntry, Project, SchematicComponent } from '../types/ecad';
import { formatRungNumber, getRungNumber } from './schematicEngine';

export function getAllParentCoils(project: Project): Array<{
  component: SchematicComponent;
  sheetId: string;
  sheetNumber: number;
  rung: number;
}> {
  const parents: Array<{
    component: SchematicComponent;
    sheetId: string;
    sheetNumber: number;
    rung: number;
  }> = [];

  for (const sheet of project.sheets) {
    for (const comp of sheet.components) {
      const def = getSymbolDef(comp.type);
      if (def?.isParent) {
        parents.push({
          component: comp,
          sheetId: sheet.id,
          sheetNumber: sheet.number,
          rung: getRungNumber(comp.y),
        });
      }
    }
  }
  return parents;
}

/**
 * Computes live Parent/Child cross-reference tables across all sheets.
 * Formats contact location lists underneath each parent coil (e.g. "NO: 02, 03 | NC: 05").
 */
export function computeCrossReferences(project: Project): Map<string, CrossReferenceEntry> {
  const map = new Map<string, CrossReferenceEntry>();
  const multiSheet = project.sheets.length > 1;

  for (const sheet of project.sheets) {
    for (const comp of sheet.components) {
      const def = getSymbolDef(comp.type);
      if (def?.isParent && !map.has(comp.tag)) {
        map.set(comp.tag, {
          parentTag: comp.tag,
          parentId: comp.id,
          parentSheetNumber: sheet.number,
          parentRung: getRungNumber(comp.y),
          parentType: comp.type,
          noContacts: [],
          ncContacts: [],
          summaryText: '',
        });
      }
    }
  }

  for (const sheet of project.sheets) {
    for (const comp of sheet.components) {
      const def = getSymbolDef(comp.type);
      if (!def?.isChild) continue;
      const pTag = comp.parentTag || comp.tag;
      const entry = map.get(pTag);
      if (!entry) continue;

      const rung = getRungNumber(comp.y);
      const isNo = comp.type === 'contact_no' || comp.type === 'timer_contact_no';
      const isTimed = comp.type === 'timer_contact_no' || comp.type === 'timer_contact_nc';

      if (isNo) {
        entry.noContacts.push({ id: comp.id, sheetNumber: sheet.number, rung, isTimed });
      } else {
        entry.ncContacts.push({ id: comp.id, sheetNumber: sheet.number, rung, isTimed });
      }
    }
  }

  for (const entry of map.values()) {
    const sortLoc = (
      a: { sheetNumber: number; rung: number },
      b: { sheetNumber: number; rung: number }
    ) => (a.sheetNumber !== b.sheetNumber ? a.sheetNumber - b.sheetNumber : a.rung - b.rung);

    entry.noContacts.sort(sortLoc);
    entry.ncContacts.sort(sortLoc);

    const fmtLoc = (c: { sheetNumber: number; rung: number }) =>
      multiSheet ? `${c.sheetNumber}.${formatRungNumber(c.rung)}` : formatRungNumber(c.rung);

    const parts: string[] = [];
    if (entry.noContacts.length > 0) {
      parts.push(`NO: ${entry.noContacts.map(fmtLoc).join(', ')}`);
    }
    if (entry.ncContacts.length > 0) {
      parts.push(`NC: ${entry.ncContacts.map(fmtLoc).join(', ')}`);
    }
    entry.summaryText = parts.length > 0 ? parts.join(' | ') : 'NO CONTACTS';
  }

  return map;
}

/**
 * Atomically renames a Parent coil tag and updates all linked Child contacts
 * across all sheets in the project.
 */
export function renameParentTag(
  project: Project,
  parentComponentId: string,
  newTagRaw: string
): Project {
  const newTag = newTagRaw.trim().toUpperCase();
  if (!newTag) return project;

  let oldTag: string | null = null;
  for (const sheet of project.sheets) {
    const found = sheet.components.find((c) => c.id === parentComponentId);
    if (found) {
      oldTag = found.tag;
      break;
    }
  }

  if (!oldTag || oldTag === newTag) return project;

  return {
    ...project,
    sheets: project.sheets.map((sheet) => ({
      ...sheet,
      components: sheet.components.map((comp) => {
        if (comp.id === parentComponentId) {
          return { ...comp, tag: newTag };
        }
        const def = getSymbolDef(comp.type);
        if (def?.isChild && (comp.parentTag === oldTag || (!comp.parentTag && comp.tag === oldTag))) {
          return {
            ...comp,
            parentTag: newTag,
            tag: newTag,
          };
        }
        return comp;
      }),
    })),
  };
}

/**
 * Links a Child contact to a specific Parent coil tag.
 */
export function linkChildToParent(
  project: Project,
  childComponentId: string,
  parentTag: string
): Project {
  return {
    ...project,
    sheets: project.sheets.map((sheet) => ({
      ...sheet,
      components: sheet.components.map((comp) => {
        if (comp.id !== childComponentId) return comp;
        return {
          ...comp,
          parentTag,
          tag: parentTag || comp.tag,
        };
      }),
    })),
  };
}
