export default function SettingsLoading() {
  return (
    <section aria-busy="true" aria-label="불러오는 중" className="mb-3 animate-pulse rounded-xl border border-line bg-surface p-[30px]">
      <div className="h-6 w-32 rounded bg-surface-4" />
      <div className="mt-8 space-y-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-6">
            <div className="h-4 w-20 rounded bg-surface-4" />
            <div className="h-4 w-56 rounded bg-surface-4" />
          </div>
        ))}
      </div>
    </section>
  );
}
