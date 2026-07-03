'use client';
import { Download, Printer } from 'lucide-react';

interface ResultActionsProps {
  data: unknown;
  filename: string;
}

export function ResultActions({ data, filename }: ResultActionsProps) {
  function handleSave() {
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex gap-2 no-print">
      <button
        onClick={handleSave}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
      >
        <Download className="w-3.5 h-3.5" />
        Save
      </button>
      <button
        onClick={() => window.print()}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
      >
        <Printer className="w-3.5 h-3.5" />
        Print
      </button>
    </div>
  );
}
