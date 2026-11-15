import { Component, lazy, Suspense, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewSkeleton } from './ViewSkeleton';
import type { SkeletonLayout } from './ViewSkeleton';

class ViewBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function deferredView<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, layout: SkeletonLayout = 'settings') {
  let cachedView = lazy(load);
  return function DeferredView(props: P) {
    const { t } = useTranslation('common');
    const [attempt, setAttempt] = useState(0);
    const [View, setView] = useState(() => cachedView);
    const retry = () => {
      cachedView = lazy(load);
      setView(() => cachedView);
      setAttempt(value => value + 1);
    };
    return (
      <ViewBoundary key={attempt} fallback={
        <div className="h-full flex flex-col items-center justify-center gap-4 text-white" role="alert">
          <p>{t('viewLoadFailed')}</p>
          <button type="button" className="rounded-lg bg-white/10 px-4 py-2 hover:bg-white/20" onClick={retry}>{t('retry')}</button>
        </div>
      }>
        <Suspense fallback={<ViewSkeleton layout={layout} />}><View {...props} /></Suspense>
      </ViewBoundary>
    );
  };
}
