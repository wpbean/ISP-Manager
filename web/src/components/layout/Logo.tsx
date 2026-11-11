export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#FCD535" />
        <path d="M8 20a11 11 0 0 1 16 0M11.5 16.5a6 6 0 0 1 9 0" stroke="#181a20" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <circle cx="16" cy="22.5" r="2.2" fill="#181a20" />
      </svg>
      {!compact && (
        <span className="text-[17px] font-bold tracking-tight text-accent">
          ISP<span className="text-strong">MANAGER</span>
        </span>
      )}
    </div>
  );
}
