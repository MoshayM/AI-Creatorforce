'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BarChart2, Target, Gift, Activity } from 'lucide-react';
import AnalyticsPage from '../analytics/page';
import StrategyPage from '../strategy/page';
import GrowthPage from '../growth/page';
import MonitorPage from '../monitor/page';

interface TabDef {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabDef[] = [
  { id: 'analytics', label: 'Analytics', icon: BarChart2 },
  { id: 'strategy',  label: 'Strategy',  icon: Target },
  { id: 'growth',    label: 'Growth',    icon: Gift },
  { id: 'monitor',   label: 'Monitor',   icon: Activity },
];

function InsightsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = searchParams.get('tab') ?? 'analytics';

  return (
    <div>
      <div className="sticky top-0 z-10 bg-white border-b border-[#ede9f8] px-6 py-3 flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => router.replace(`/insights?tab=${t.id}`)}
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

      {activeTab === 'analytics' && <AnalyticsPage />}
      {activeTab === 'strategy'  && <StrategyPage />}
      {activeTab === 'growth'    && <GrowthPage />}
      {activeTab === 'monitor'   && <MonitorPage />}
    </div>
  );
}

export default function InsightsPage() {
  return (
    <Suspense fallback={null}>
      <InsightsContent />
    </Suspense>
  );
}
