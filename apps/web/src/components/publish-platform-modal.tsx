'use client';

import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

const PLATFORMS = [
  { id: 'YOUTUBE',   label: 'YouTube',     color: '#FF0000', emoji: '▶' },
  { id: 'FACEBOOK',  label: 'Facebook',    color: '#1877F2', emoji: '📘' },
  { id: 'INSTAGRAM', label: 'Instagram',   color: '#E1306C', emoji: '📷' },
  { id: 'TIKTOK',    label: 'TikTok',      color: '#010101', emoji: '🎵' },
  { id: 'LINKEDIN',  label: 'LinkedIn',    color: '#0A66C2', emoji: '💼' },
  { id: 'TWITTER',   label: 'X (Twitter)', color: '#000000', emoji: '𝕏' },
];

export interface PublishPlatformModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectTitle?: string;
  connectedPlatforms?: string[];
}

export function PublishPlatformModal({
  isOpen,
  onClose,
  projectId,
  projectTitle,
  connectedPlatforms = [],
}: PublishPlatformModalProps) {
  const router = useRouter();

  if (!isOpen) return null;

  const connected = new Set(connectedPlatforms.map((p) => p.toUpperCase()));

  function handleConnect(platformId: string) {
    const returnUrl =
      window.location.pathname + '?publishProjectId=' + projectId;
    sessionStorage.setItem('cf.oauth.returnUrl', returnUrl);
    router.push('/library?tab=channels');
  }

  function handlePublish() {
    onClose();
    router.push(`/publish?tab=publishing&projectId=${projectId}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          Publish to Platform
        </h2>
        {projectTitle && (
          <p className="text-sm text-gray-500 mb-4 truncate">{projectTitle}</p>
        )}

        <ul className="space-y-3 mt-4">
          {PLATFORMS.map((platform) => {
            const isConnected = connected.has(platform.id);
            return (
              <li
                key={platform.id}
                className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full text-lg"
                    style={{ backgroundColor: platform.color + '18' }}
                    aria-hidden="true"
                  >
                    {platform.emoji}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-gray-800">
                      {platform.label}
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        isConnected ? 'text-green-600' : 'text-gray-400'
                      }`}
                    >
                      {isConnected ? 'Connected' : 'Not Connected'}
                    </span>
                  </div>
                </div>

                {isConnected ? (
                  <button
                    onClick={handlePublish}
                    className="rounded-lg bg-[#6D4AE0] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#5a3bc7] transition-colors"
                  >
                    Publish
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnect(platform.id)}
                    className="rounded-lg border border-[#6D4AE0] px-4 py-1.5 text-sm font-medium text-[#6D4AE0] hover:bg-[#6D4AE0]/5 transition-colors"
                  >
                    Connect
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default PublishPlatformModal;
