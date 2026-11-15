import { useTranslation } from 'react-i18next';

export type SkeletonLayout = 'settings' | 'instance' | 'skins';

const surface = 'rounded-2xl border border-white/[0.06] bg-white/[0.025]';
const line = 'rounded-full bg-white/[0.07]';

export function ViewSkeleton({ layout = 'settings' }: { layout?: SkeletonLayout }) {
  const { t } = useTranslation('common');
  return (
    <div role="status" aria-label={t('loading')} aria-busy="true" className="h-full w-full overflow-hidden" data-view-skeleton={layout}>
      <div aria-hidden="true" className="h-full">
        {layout === 'instance' ? (
          <div className="flex h-full flex-col items-center justify-end gap-6 px-8 pb-12">
            <div className="flex flex-1 items-center justify-center w-full">
              <div className={`${line} h-16 w-2/5 max-w-sm opacity-40`} />
            </div>
            <div className="flex gap-4"><div className={`${surface} h-10 w-28`} /><div className={`${surface} h-10 w-24`} /></div>
            <div className={`${surface} h-20 w-full max-w-xs border-[#d4af37]/15 bg-[#d4af37]/[0.025]`} />
            <div className={`${line} h-3 w-24 opacity-40`} />
          </div>
        ) : layout === 'skins' ? (
          <div className="grid h-full grid-cols-1 gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.5fr)]">
            <div className="flex min-h-0 flex-col gap-8">
              <div className={`${line} h-9 w-3/4`} />
              <div className={`${surface} flex flex-1 items-center justify-center`}>
                <div className="flex w-24 flex-col items-center gap-2 opacity-40"><div className="h-16 w-16 rounded-xl bg-white/10" /><div className="h-36 w-24 rounded-xl bg-white/10" /><div className="flex gap-2"><div className="h-24 w-11 rounded-lg bg-white/10" /><div className="h-24 w-11 rounded-lg bg-white/10" /></div></div>
              </div>
            </div>
            <div className="flex flex-col gap-6"><div className={`${line} h-6 w-32`} /><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className={`${surface} aspect-[31/40]`} />)}</div></div>
          </div>
        ) : (
          <div className="h-full px-8 pt-8">
            <div className={`${line} mb-8 h-9 w-48`} />
            <div className="mb-8 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <div className="mx-auto flex max-w-4xl flex-col gap-6">
              {[0, 1, 2].map(index => <div key={index} className={`${surface} p-6`}><div className={`${line} mb-5 h-6 w-40`} /><div className={`${line} mb-5 h-3 w-2/3 opacity-50`} /><div className="flex gap-3"><div className={`${surface} h-10 w-28`} /><div className={`${surface} h-10 w-28`} /></div></div>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
