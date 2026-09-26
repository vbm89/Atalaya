import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/dashboard/dashboard";
import { QueryProvider } from "@/components/query-provider";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <QueryProvider>
      <Dashboard />
    </QueryProvider>
  );
}
