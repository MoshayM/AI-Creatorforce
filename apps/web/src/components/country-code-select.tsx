'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';

export interface Country {
  iso: string;
  name: string;
  dialCode: string;
}

const flag = (iso: string) =>
  String.fromCodePoint(...iso.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

export const COUNTRIES: Country[] = [
  { iso: 'IN', name: 'India', dialCode: '+91' },
  { iso: 'US', name: 'United States', dialCode: '+1' },
  { iso: 'GB', name: 'United Kingdom', dialCode: '+44' },
  { iso: 'AU', name: 'Australia', dialCode: '+61' },
  { iso: 'CA', name: 'Canada', dialCode: '+1' },
  { iso: 'AE', name: 'UAE', dialCode: '+971' },
  { iso: 'SG', name: 'Singapore', dialCode: '+65' },
  { iso: 'MY', name: 'Malaysia', dialCode: '+60' },
  { iso: 'PH', name: 'Philippines', dialCode: '+63' },
  { iso: 'PK', name: 'Pakistan', dialCode: '+92' },
  { iso: 'BD', name: 'Bangladesh', dialCode: '+880' },
  { iso: 'LK', name: 'Sri Lanka', dialCode: '+94' },
  { iso: 'NP', name: 'Nepal', dialCode: '+977' },
  { iso: 'NG', name: 'Nigeria', dialCode: '+234' },
  { iso: 'ZA', name: 'South Africa', dialCode: '+27' },
  { iso: 'KE', name: 'Kenya', dialCode: '+254' },
  { iso: 'GH', name: 'Ghana', dialCode: '+233' },
  { iso: 'ET', name: 'Ethiopia', dialCode: '+251' },
  { iso: 'EG', name: 'Egypt', dialCode: '+20' },
  { iso: 'SA', name: 'Saudi Arabia', dialCode: '+966' },
  { iso: 'OM', name: 'Oman', dialCode: '+968' },
  { iso: 'QA', name: 'Qatar', dialCode: '+974' },
  { iso: 'KW', name: 'Kuwait', dialCode: '+965' },
  { iso: 'BH', name: 'Bahrain', dialCode: '+973' },
  { iso: 'JO', name: 'Jordan', dialCode: '+962' },
  { iso: 'IQ', name: 'Iraq', dialCode: '+964' },
  { iso: 'IR', name: 'Iran', dialCode: '+98' },
  { iso: 'TR', name: 'Turkey', dialCode: '+90' },
  { iso: 'DE', name: 'Germany', dialCode: '+49' },
  { iso: 'FR', name: 'France', dialCode: '+33' },
  { iso: 'IT', name: 'Italy', dialCode: '+39' },
  { iso: 'ES', name: 'Spain', dialCode: '+34' },
  { iso: 'NL', name: 'Netherlands', dialCode: '+31' },
  { iso: 'SE', name: 'Sweden', dialCode: '+46' },
  { iso: 'NO', name: 'Norway', dialCode: '+47' },
  { iso: 'DK', name: 'Denmark', dialCode: '+45' },
  { iso: 'CH', name: 'Switzerland', dialCode: '+41' },
  { iso: 'PL', name: 'Poland', dialCode: '+48' },
  { iso: 'RU', name: 'Russia', dialCode: '+7' },
  { iso: 'UA', name: 'Ukraine', dialCode: '+380' },
  { iso: 'CN', name: 'China', dialCode: '+86' },
  { iso: 'JP', name: 'Japan', dialCode: '+81' },
  { iso: 'KR', name: 'South Korea', dialCode: '+82' },
  { iso: 'ID', name: 'Indonesia', dialCode: '+62' },
  { iso: 'TH', name: 'Thailand', dialCode: '+66' },
  { iso: 'VN', name: 'Vietnam', dialCode: '+84' },
  { iso: 'MM', name: 'Myanmar', dialCode: '+95' },
  { iso: 'KH', name: 'Cambodia', dialCode: '+855' },
  { iso: 'MX', name: 'Mexico', dialCode: '+52' },
  { iso: 'BR', name: 'Brazil', dialCode: '+55' },
  { iso: 'AR', name: 'Argentina', dialCode: '+54' },
  { iso: 'CO', name: 'Colombia', dialCode: '+57' },
  { iso: 'CL', name: 'Chile', dialCode: '+56' },
  { iso: 'NZ', name: 'New Zealand', dialCode: '+64' },
  { iso: 'IL', name: 'Israel', dialCode: '+972' },
  { iso: 'PT', name: 'Portugal', dialCode: '+351' },
  { iso: 'BE', name: 'Belgium', dialCode: '+32' },
  { iso: 'AT', name: 'Austria', dialCode: '+43' },
  { iso: 'GR', name: 'Greece', dialCode: '+30' },
  { iso: 'RO', name: 'Romania', dialCode: '+40' },
  { iso: 'CZ', name: 'Czech Republic', dialCode: '+420' },
  { iso: 'HU', name: 'Hungary', dialCode: '+36' },
  { iso: 'FI', name: 'Finland', dialCode: '+358' },
];

interface DropdownPos { top: number; left: number; width: number }

interface Props {
  value: Country;
  onChange: (country: Country) => void;
}

export default function CountryCodeSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<DropdownPos | null>(null);
  const [mounted, setMounted] = useState(false);

  const btnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMounted(true); }, []);

  const filtered = COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.dialCode.includes(search) ||
      c.iso.toLowerCase().includes(search.toLowerCase()),
  );

  const close = useCallback(() => {
    setOpen(false);
    setSearch('');
  }, []);

  const openDropdown = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + window.scrollY + 4, left: r.left + window.scrollX, width: 288 });
    setOpen(true);
  }, []);

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return;
    // Auto-focus search after state settles
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inBtn = btnRef.current?.contains(target);
      const inMenu = document.getElementById('cf-country-menu')?.contains(target);
      if (!inBtn && !inMenu) close();
    };
    const onScroll = () => close();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, close]);

  const dropdown = open && pos ? (
    <div
      id="cf-country-menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
      className="bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden"
    >
      <div className="p-2 border-b border-gray-100">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-full">
          <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search country or code…"
            className="flex-1 bg-transparent text-sm outline-none text-gray-700 placeholder:text-gray-400"
          />
        </div>
      </div>
      <ul className="max-h-56 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <li className="px-4 py-3 text-sm text-gray-400 text-center">No results</li>
        ) : (
          filtered.map((c) => (
            <li key={c.iso}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()} // keep focus in search
                onClick={() => { onChange(c); close(); }}
                className={`w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-purple-50 transition-colors text-left ${c.iso === value.iso ? 'bg-purple-50 text-[#7b5ec7] font-medium' : 'text-gray-700'}`}
              >
                <span className="text-lg leading-none">{flag(c.iso)}</span>
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-gray-400 text-xs">{c.dialCode}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? close() : openDropdown())}
        className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#7b5ec7]/40 transition-colors whitespace-nowrap rounded-l-full border-r border-gray-200"
      >
        <span className="text-lg leading-none">{flag(value.iso)}</span>
        <span className="text-gray-600">{value.dialCode}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {mounted && createPortal(dropdown, document.body)}
    </>
  );
}
