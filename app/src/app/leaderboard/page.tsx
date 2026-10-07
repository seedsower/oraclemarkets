import type { Metadata } from "next";
import { StatusBar } from "@/components/layout/status-bar";
import { Leaderboard } from "@/components/leaderboard";

export const metadata: Metadata = {
  title: "Leaderboard · Oracle Markets",
  description: "Top predictors trading from X, ranked by profit.",
};

export default function LeaderboardPage() {
  return (
    <>
      <StatusBar />
      <main className="flex-1 max-w-3xl mx-auto w-full px-[16px] md:px-[32px] py-[28px] flex flex-col gap-[20px]">
        <Leaderboard />
      </main>
    </>
  );
}
