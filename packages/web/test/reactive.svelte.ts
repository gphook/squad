/** Reactive props for mounting components in tests, so a bound prop the component changes re-renders it. */
export function reactive<T extends Record<string, unknown>>(initial: T): T {
  const props = $state(initial);
  return props;
}
