// How a role's location may be worked: on-site, hybrid, remote (any mix).
// Stored on the location filter row as a `work_types` child (list_value), so
// no schema change is needed and it is never read as a place name. The older
// `remote_work` boolean child is kept in sync for backward compatibility.
//
// Semantics:
// - REMOTE in the list: remote candidates are acceptable.
// - ONSITE or HYBRID in the list: the location itself matters.
// - Empty list (rows saved before work types existed, with remote_work
//   false): unspecified, so the location matters and remote is not allowed.

export const WORK_TYPES = ['ONSITE', 'HYBRID', 'REMOTE'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const WORK_TYPES_CHILD = 'work_types';
export const REMOTE_WORK_CHILD = 'remote_work';

interface ChildLike {
  title: string;
  list_value?: string[] | null;
  boolean?: boolean | null;
  boolean_value?: boolean | null;
}

export function isWorkType(value: string): value is WorkType {
  return (WORK_TYPES as readonly string[]).includes(value);
}

// Valid values only, deduped, in canonical order.
export function normalizeWorkTypes(
  values: readonly string[] | null | undefined,
): WorkType[] {
  const given = new Set(
    (values ?? []).map((value) => value.trim().toUpperCase()),
  );
  return WORK_TYPES.filter((type) => given.has(type));
}

// Reads the work types off a location row's children (DB rows carry
// `boolean`, DTOs `boolean_value`). A legacy row with only remote_work=true
// meant "this location, remote also fine", i.e. ONSITE + REMOTE.
export function workTypesFromChildren(
  children: readonly ChildLike[] | null | undefined,
): WorkType[] {
  const explicit = children?.find((child) => child.title === WORK_TYPES_CHILD);
  if (explicit) return normalizeWorkTypes(explicit.list_value);
  const remote = children?.find((child) => child.title === REMOTE_WORK_CHILD);
  return (remote?.boolean ?? remote?.boolean_value) ? ['ONSITE', 'REMOTE'] : [];
}

// The shape of a stored child as the save path writes it.
export interface WorkTypeChild {
  title: string;
  value?: string;
  list_value?: string[];
  boolean_value?: boolean;
}

// Replaces any work_types / remote_work children with ones for `types`.
export function withWorkTypeChildren<T extends { title: string }>(
  children: readonly T[],
  types: readonly WorkType[],
): (T | WorkTypeChild)[] {
  const normalized = normalizeWorkTypes(types);
  return [
    ...children.filter(
      (child) =>
        child.title !== WORK_TYPES_CHILD && child.title !== REMOTE_WORK_CHILD,
    ),
    { title: WORK_TYPES_CHILD, list_value: normalized },
    { title: REMOTE_WORK_CHILD, boolean_value: normalized.includes('REMOTE') },
  ];
}

interface LocationWorkTypes {
  remoteWork: boolean;
  workTypes?: WorkType[];
}

export function remoteAllowed(location: LocationWorkTypes): boolean {
  return location.workTypes?.length
    ? location.workTypes.includes('REMOTE')
    : location.remoteWork;
}

// False only for a remote-only role.
export function locationMatters(location: LocationWorkTypes): boolean {
  return (
    !location.workTypes?.length ||
    location.workTypes.some((type) => type !== 'REMOTE')
  );
}
