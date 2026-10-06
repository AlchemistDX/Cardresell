// Tests may set globalThis.__XIMILAR_GRADE to a function returning the
// grader result; default is a failed/unused CV step.
export async function gradeWithXimilar(...args) {
  if (typeof globalThis.__XIMILAR_GRADE === 'function') return globalThis.__XIMILAR_GRADE(...args);
  return { ok: false, reason: 'not_used_in_identify_tests' };
}
export default { gradeWithXimilar };
