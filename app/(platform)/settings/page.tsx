import { AppearanceSettings } from "@/components/layout/AppearanceSettings";
import { getSessionFromCookies } from "@/lib/server/auth/request";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const user = await getSessionFromCookies();
  if (!user) redirect("/login");

  return (
    <div className="smp-page-stack smp-page-stack--fill">
      <div className="smp-stage smp-stage--pad">
        <section className="smp-page-hero">
          <h2 className="smp-page-hero__title">Settings</h2>
        </section>
        <section className="smp-page-panel" aria-labelledby="account-heading">
          <span className="smp-page-panel__accent">Account</span>
          <h3 id="account-heading" className="smp-page-panel__title">
            {user.name}
          </h3>
          <p className="smp-page-panel__body">
            {user.email} · {user.role === "wfm" ? "WFM superadmin" : user.role === "hr" ? "HR" : "Team lead"}
          </p>
          {user.role === "team_lead" ? (
            <ul className="smp-access__assigned">
              {user.assignments.map((item) => (
                <li key={`${item.source}:${item.teamId}`}>
                  <strong>{item.source === "tivazo" ? "Tivazo" : "Biometrics"}</strong>
                  {item.teamLabel}
                </li>
              ))}
            </ul>
          ) : user.role === "hr" ? (
            <p className="smp-page-panel__body">
              You can see every Tivazo group and Biometrics department, same as Superadmin.
            </p>
          ) : (
            <p className="smp-page-panel__body">
              You can create team leads and HR users and assign Tivazo groups or Biometrics
              departments from Users.
            </p>
          )}
        </section>
        <AppearanceSettings />
      </div>
    </div>
  );
}
