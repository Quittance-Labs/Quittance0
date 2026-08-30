/** `next/image` outside a Next runtime — the props that matter here are src and alt. */
export default function Image({ src, alt, width, height, className, style }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={width} height={height} className={className} style={style} />;
}
