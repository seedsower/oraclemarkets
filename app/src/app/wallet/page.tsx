import type { Metadata } from "next";
import { StatusBar } from "@/components/layout/status-bar";
import { XWalletView } from "@/components/xwallet/xwallet-view";

export const metadata: Metadata = {
  title: "Your X wallet · Oracle Markets",
  description: "Trade prediction markets by replying on X. Sign in with X to see your wallet.",
};

export default function WalletPage() {
  return (
    <>
      <StatusBar />
      <main className="flex-1 max-w-xl mx-auto w-full px-[20px] md:px-[32px] py-[28px] flex flex-col gap-[20px]">
        <XWalletView />
      </main>
    </>
  );
}
