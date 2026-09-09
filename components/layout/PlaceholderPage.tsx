type PlaceholderPageProps = {
  title: string;
  description?: string;
};

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <>
      <section className="smp-page-hero">
        <h2 className="smp-page-hero__title">{title}</h2>
      </section>

      <section className="smp-page-panel">
        <span className="smp-page-panel__accent">Coming next</span>
        <h3 className="smp-page-panel__title">This surface is wired into the shell.</h3>
        <p className="smp-page-panel__body">
          Route, navigation, and page meta are connected. Domain workflows can be
          built here without changing the platform chrome.
        </p>
      </section>
    </>
  );
}
