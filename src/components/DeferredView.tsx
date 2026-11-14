import { Component, lazy, Suspense, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

class ViewBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function deferredView<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  return function DeferredView(props: P) {
    const { t } = useTranslation('common');
    const [attempt, setAttempt] = useState(0);
    const View = useMemo(() => lazy(load), [attempt]);
    const pending = <div className="h-full flex items-center justify-center text-white/70" role="status">{t('loading')}</div>;
    return (
      <ViewBoundary key={attempt} fallback={
        <div className="h-full flex flex-col items-center justify-center gap-4 text-white" role="alert">
          <p>{t('viewLoadFailed')}</p>
          <button type="button" className="rounded-lg bg-white/10 px-4 py-2 hover:bg-white/20" onClick={() => setAttempt(value => value + 1)}>{t('retry')}</button>
        </div>
      }>
        <Suspense fallback={pending}><View {...props} /></Suspense>
      </ViewBoundary>
    );
  };
}
