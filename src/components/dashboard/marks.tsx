import type { AssetId } from "@/lib/trading/types";
import { cn } from "@/lib/utils";

export const ASSET_SUBTITLE: Record<AssetId, string> = {
  XAUUSD: "Oro / Dólar estadounidense",
  BTCUSD: "Bitcoin",
  US100: "Nasdaq 100",
  WTI: "Petróleo WTI",
};

export function AtalayaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7 shrink-0", className)} aria-hidden>
      <path
        d="M16 4.5 28 26.5H4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path d="M16 12.2 22.4 24.2h-12.8Z" fill="currentColor" />
    </svg>
  );
}

export function AssetMark({
  id,
  size = "md",
}: {
  id: AssetId;
  size?: "sm" | "md" | "lg";
}) {
  const box = size === "lg" ? "size-10" : size === "sm" ? "size-7" : "size-8";
  return (
    <span className={cn("atalaya-asset-mark", box)} data-asset-mark={id} aria-hidden>
      {id === "XAUUSD" ? <GoldMark /> : null}
      {id === "BTCUSD" ? <BtcMark /> : null}
      {id === "US100" ? <UsMark /> : null}
      {id === "WTI" ? <OilMark /> : null}
    </span>
  );
}

function GoldMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-[70%]">
      <rect x="6" y="16" width="20" height="8" rx="1.4" fill="#E7C56A" />
      <rect x="9" y="11" width="14" height="7" rx="1.2" fill="#F3D98A" />
      <rect x="12" y="7" width="8" height="6" rx="1" fill="#FFE9A8" />
    </svg>
  );
}

function BtcMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-[78%]">
      <circle cx="16" cy="16" r="12" fill="#F5A623" />
      <path
        d="M14.2 8.8v14.4M17.8 8.8v14.4M12.2 12.4h7.2c1.6 0 2.7.9 2.7 2.3s-1.1 2.3-2.7 2.3h-7.2m0 0h7.6c1.7 0 2.9.9 2.9 2.4s-1.2 2.4-2.9 2.4H12.2"
        fill="none"
        stroke="#1a1206"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UsMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-[78%]">
      <circle cx="16" cy="16" r="12" fill="#1d3b73" />
      <path d="M4.8 13.2h22.4M4.8 16h22.4M4.8 18.8h22.4M7.4 22.2h17.2" stroke="#f2f4f8" strokeWidth="1.35" />
      <path d="M4.8 9.2h22.4v3.2H4.8z" fill="#c63c3c" />
      <path d="M4.8 9.2h11.2v8.2H4.8z" fill="#16305c" />
      <circle cx="8.2" cy="11.4" r="0.55" fill="#f2f4f8" />
      <circle cx="10.4" cy="11.4" r="0.55" fill="#f2f4f8" />
      <circle cx="12.6" cy="11.4" r="0.55" fill="#f2f4f8" />
      <circle cx="9.3" cy="13.2" r="0.55" fill="#f2f4f8" />
      <circle cx="11.5" cy="13.2" r="0.55" fill="#f2f4f8" />
      <circle cx="8.2" cy="15" r="0.55" fill="#f2f4f8" />
      <circle cx="10.4" cy="15" r="0.55" fill="#f2f4f8" />
      <circle cx="12.6" cy="15" r="0.55" fill="#f2f4f8" />
    </svg>
  );
}

function OilMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-[72%]">
      <path
        d="M16 5.5c4.8 7.2 8.2 11.4 8.2 15.2A8.2 8.2 0 0 1 16 28.9a8.2 8.2 0 0 1-8.2-8.2C7.8 16.9 11.2 12.7 16 5.5Z"
        fill="#d8dee6"
      />
      <path
        d="M16 9.2c3.6 5.4 6.1 8.6 6.1 11.5A6.1 6.1 0 0 1 16 26.8a6.1 6.1 0 0 1-6.1-6.1c0-2.9 2.5-6.1 6.1-11.5Z"
        fill="#9aa7b5"
      />
    </svg>
  );
}
