/** Skeleton while the 홈 data (진행 현황) loads. */
export default function HomeLoading() {
  const block = "animate-pulse rounded bg-surface-4";
  return (
    <main className="min-w-0 flex-1 bg-body-2 px-4" aria-busy="true" aria-label="홈을 불러오는 중">
      <div className="mx-auto w-full max-w-[744px] pt-[34px]">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className={`${block} h-5 w-24`} />
            <div className={`${block} h-6 w-64`} />
          </div>
          <div className={`${block} h-[42px] w-44 rounded-md`} />
        </div>
        {[188, 154, 380].map((h, i) => (
          <div key={i} className="mt-6 rounded-xl border border-line bg-surface p-6" style={{ height: h }}>
            <div className={`${block} h-6 w-24`} />
            <div className="mt-8 grid grid-cols-4 gap-6">
              {[0, 1, 2, 3].map((k) => (
                <div key={k} className={`${block} h-12`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
