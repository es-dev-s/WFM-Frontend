export function PageFallback() {
  return (
    <section className="smp-page-fallback" aria-busy="true" aria-live="polite">
      <div className="smp-page-fallback__block smp-page-fallback__block--lg" />
      <div className="smp-page-fallback__block smp-page-fallback__block--md" />
      <div className="smp-page-fallback__panel" />
    </section>
  );
}
