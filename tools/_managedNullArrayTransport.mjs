// Adversarial transport model of the observed managed cjson null-array loss.
// All Redis commands still run against the test process's private Redis.
export function compactNullArrays(value) {
  if (Array.isArray(value)) return value.filter(item => item !== null).map(compactNullArrays);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, compactNullArrays(item)]));
  return value;
}
export function withManagedNullArrayLoss(execute) {
  return async command => {
    if (command[0] === 'EVAL') {
      const index = 3 + Number(command[2]), raw = command[index];
      if (typeof raw === 'string' && /^(?:\{|\[)/.test(raw)) {
        const next = [...command];
        next[index] = JSON.stringify(compactNullArrays(JSON.parse(raw)));
        return execute(next);
      }
    }
    return execute(command);
  };
}
