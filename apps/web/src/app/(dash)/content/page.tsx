'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BookOpen, Compass, ArrowRightLeft, ListOrdered, Award } from 'lucide-react';
import ResearchPage from '../research/page';
import DiscoverPage from '../discover/page';
import RepurposePage from '../repurpose/page';
import SeriesPlannerPage from '../series-planner/page';
import ScoreScriptPage from '../score-script/page';

interface TabDef {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabDef[] = [
  { id: 'research',       label: 'Research',       icon: BookOpen },
  { id: 'discover',       label: 'Discover',       icon: Compass },
  { id: 'repurpose',      label: 'Repurpose',      icon: ArrowRightLeft },
  { id: 'series-planner', label: 'Series Planner', icon: ListOrdered },
  { id: 'score-script',   label: 'Script Scorer',  icon: Award },
];

function ContentContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = searchParams.get('tab') ?? 'research';

  return (
    <div>
      <div className="sticky top-0 z-10 bg-white border-b border-[#ede9f8] px-6 py-3 flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => router.replace(`/content?tab=${t.id}`)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-2xl transition-all"
            style={
              activeTab === t.id
                ? { background: '#f5f2fd', border: '2px solid #6D4AE0', color: '#6D4AE0' }
                : { background: '#faf9ff', border: '1.5px solid #e3ddf8', color: '#374151' }
            }
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'research'       && <ResearchPage />}
      {activeTab === 'discover'       && <DiscoverPage />}
      {activeTab === 'repurpose'      && <RepurposePage />}
      {activeTab === 'series-planner' && <SeriesPlannerPage />}
      {activeTab === 'score-script'   && <ScoreScriptPage />}
    </div>
  );
}

export default function ContentPage() {
  return (
    <Suspense fallback={null}>
      <ContentContent />
    </Suspense>
  );
}
