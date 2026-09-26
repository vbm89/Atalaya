import { createFileRoute } from "@tanstack/react-router";
import { BotScreen } from "@/components/bot-screen";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <BotScreen />;
}
