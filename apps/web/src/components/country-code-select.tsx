'use client';
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import {
  useFloating,
  useClick,
  useDismiss,
  useRole,
  useListNavigation,
  useInteractions,
  FloatingPortal,
  flip,
  shift,
  offset,
  size,
  autoUpdate,
} from '@floating-ui/react';
import { ChevronDown, Search } from 'lucide-react';

export interface Country {
  iso: string;
  name: string;
  dialCode: string;
}

const flag = (iso: string) =>
  String.fromCodePoint(
    ...iso.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );

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

interface Props {
  value: Country;
  onChange: (country: Country) => void;
}

export default function CountryCodeSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [listMaxHeight, setListMaxHeight] = useState(280);

  const listRef = useRef<Array<HTMLElement | null>>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () =>
      COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.dialCode.includes(search) ||
          c.iso.toLowerCase().includes(search.toLowerCase()),
      ),
    [search],
  );

  const selectedIndex = filtered.findIndex((c) => c.iso === value.iso);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => {
      setOpen(next);
      if (!next) setSearch('');
    },
    placement: 'bottom-start',
    middleware: [
      offset(6),
      flip({ fallbackAxisSideDirection: 'start', padding: 12 }),
      shift({ padding: 12 }),
      size({
        apply({ availableHeight }) {
          setListMaxHeight(Math.min(280, Math.max(120, availableHeight - 56)));
        },
        padding: 12,
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context, { toggle: true });
  const dismiss = useDismiss(context, { outsidePressEvent: 'mousedown' });
  const role = useRole(context, { role: 'listbox' });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    selectedIndex,
    onNavigate: setActiveIndex,
    loop: true,
    virtual: true,
    focusItemOnOpen: false,
  });

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    click,
    dismiss,
    role,
    listNav,
  ]);

  // Focus search input when dropdown opens; scroll selected item into view
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      searchRef.current?.focus({ preventScroll: true });
      if (selectedIndex >= 0) {
        listRef.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [open, selectedIndex]);

  const handleSelect = useCallback(
    (country: Country) => {
      onChange(country);
      setOpen(false);
      setSearch('');
    },
    [onChange],
  );

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const target = activeIndex !== null ? filtered[activeIndex] : filtered[selectedIndex >= 0 ? selectedIndex : 0];
      if (target) handleSelect(target);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={`Country code: ${value.name} ${value.dialCode}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7b5ec7]/50 transition-colors whitespace-nowrap rounded-l-full border-r border-gray-200 select-none"
        {...getReferenceProps()}
      >
        <span className="text-lg leading-none" aria-hidden="true">{flag(value.iso)}</span>
        <span className="text-gray-600 tabular-nums">{value.dialCode}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              zIndex: 99999,
              width: 288,
              outline: 'none',
            }}
            className="bg-white border border-gray-200 rounded-2xl shadow-2xl"
            {...getFloatingProps()}
          >
            {/* Sticky search bar */}
            <div className="p-2 border-b border-gray-100">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-full">
                <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" aria-hidden="true" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search country or code…"
                  aria-label="Search countries"
                  aria-autocomplete="list"
                  className="flex-1 bg-transparent text-sm outline-none text-gray-700 placeholder:text-gray-400"
                />
              </div>
            </div>

            {/* Scrollable country list */}
            <ul
              role="listbox"
              aria-label="Countries"
              style={{ maxHeight: listMaxHeight, overflowY: 'auto' }}
              className="py-1"
            >
              {filtered.length === 0 ? (
                <li className="px-4 py-3 text-sm text-gray-400 text-center" role="option" aria-selected={false}>
                  No results
                </li>
              ) : (
                filtered.map((c, i) => {
                  const isSelected = c.iso === value.iso;
                  const isActive = activeIndex === i;
                  return (
                    <li key={c.iso} role="option" aria-selected={isSelected}>
                      <button
                        ref={(el) => { listRef.current[i] = el; }}
                        type="button"
                        tabIndex={isActive ? 0 : -1}
                        className={[
                          'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors duration-100 text-left cursor-pointer',
                          isSelected ? 'bg-purple-50 text-[#7b5ec7] font-medium' : 'text-gray-700',
                          isActive && !isSelected ? 'bg-gray-50' : '',
                          'hover:bg-purple-50 hover:text-[#7b5ec7]',
                        ].join(' ')}
                        {...getItemProps({
                          onClick: () => handleSelect(c),
                          onKeyDown: (e) => { if (e.key === 'Enter') handleSelect(c); },
                        })}
                      >
                        <span className="text-lg leading-none" aria-hidden="true">{flag(c.iso)}</span>
                        <span className="flex-1 truncate">{c.name}</span>
                        <span className={`text-xs tabular-nums ${isSelected ? 'text-[#7b5ec7]' : 'text-gray-400'}`}>
                          {c.dialCode}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
