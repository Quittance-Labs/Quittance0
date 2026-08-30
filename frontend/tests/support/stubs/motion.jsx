/**
 * `motion/react` renders plain elements with animation props attached.
 *
 * Only the landing page uses it, and the animation props are not markup the
 * audit cares about — they are stripped so they do not reach the DOM as unknown
 * attributes.
 */
const ANIMATION_PROPS = new Set([
  'initial', 'animate', 'exit', 'transition', 'whileInView', 'whileHover',
  'whileTap', 'whileFocus', 'viewport', 'layout', 'layoutId', 'variants',
]);

const strip = (props) =>
  Object.fromEntries(Object.entries(props).filter(([key]) => !ANIMATION_PROPS.has(key)));

export const motion = new Proxy(
  {},
  {
    get(_target, tag) {
      const Component = ({ children, ...props }) => {
        const Tag = tag;
        return <Tag {...strip(props)}>{children}</Tag>;
      };
      Component.displayName = `motion.${String(tag)}`;
      return Component;
    },
  }
);

export const AnimatePresence = ({ children }) => children;
