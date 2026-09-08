export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'date-fns') {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export function format() { return "formatted date"; }',
    };
  }

  return nextResolve(specifier, context);
}
