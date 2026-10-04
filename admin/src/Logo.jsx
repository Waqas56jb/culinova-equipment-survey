export function Logo({ className = "logo", tone = "dark" }) {
  const src = tone === "light" ? "/logo-on-dark.png" : "/logo.png";
  return (
    <img
      className={className}
      src={src}
      alt="CULINOVA"
      width="220"
      height="88"
      decoding="async"
    />
  );
}
