export async function shouldPreventWindowClose(
  dirty: boolean,
  confirmDiscard: () => Promise<boolean>,
): Promise<boolean> {
  return dirty && !(await confirmDiscard());
}
