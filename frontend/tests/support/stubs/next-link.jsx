/**
 * `next/link` outside a Next runtime.
 *
 * The real component reads the App Router context, which does not exist in a
 * bare jsdom document. It renders an anchor, and an anchor is all the audited
 * markup needs to be correct.
 */
export default function Link({ href, children, ...rest }) {
  return (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  );
}
