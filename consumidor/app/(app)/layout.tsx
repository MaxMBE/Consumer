import { Sidebar } from "@/components/layout";
import { CampaignsProvider } from "@/context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CampaignsProvider>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </CampaignsProvider>
  );
}
