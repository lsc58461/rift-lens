import { MaintenancePanel } from "@/components/admin/maintenance-panel";
import { SeasonArchiveCard } from "@/components/admin/season-archive-card";

export const dynamic = "force-dynamic";

export default function AdminMaintenancePage() {
  return (
    <div className="space-y-6">
      <MaintenancePanel />
      <SeasonArchiveCard />
    </div>
  );
}
