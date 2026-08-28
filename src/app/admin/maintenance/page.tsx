import { MaintenancePanel } from "@/components/admin/maintenance-panel";
import { ParticipantsCard } from "@/components/admin/participants-card";
import { SeasonArchiveCard } from "@/components/admin/season-archive-card";

export const dynamic = "force-dynamic";

export default function AdminMaintenancePage() {
  return (
    <div className="space-y-6">
      <MaintenancePanel />
      <SeasonArchiveCard />
      <ParticipantsCard />
    </div>
  );
}
