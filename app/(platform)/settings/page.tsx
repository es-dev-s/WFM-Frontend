import { AppearanceSettings } from "@/components/layout/AppearanceSettings";

export default function SettingsPage() {
  return (
    <div className="smp-page-stack smp-page-stack--fill">
      <div className="smp-stage smp-stage--pad">
        <section className="smp-page-hero">
          <h2 className="smp-page-hero__title">Settings</h2>
        </section>
        <AppearanceSettings />
      </div>
    </div>
  );
}
