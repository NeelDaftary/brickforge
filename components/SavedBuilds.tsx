'use client';

import { useState, useEffect } from 'react';
import { loadBuildMetaList, deleteBuild, getStorageInfo } from '@/lib/storage/saved-builds';
import type { SavedBuildMeta } from '@/lib/storage/saved-builds';

interface SavedBuildsProps {
  onLoadBuild: (id: string) => void;
  refreshKey: number;
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}

export function SavedBuilds({ onLoadBuild, refreshKey }: SavedBuildsProps) {
  const [builds, setBuilds] = useState<SavedBuildMeta[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [storageInfo, setStorageInfo] = useState({ usedKB: 0, buildCount: 0 });

  useEffect(() => {
    setBuilds(loadBuildMetaList());
    setStorageInfo(getStorageInfo());
  }, [refreshKey]);

  if (builds.length === 0) return null;

  return (
    <div className="w-full">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-2 px-1 text-sm font-semibold text-[#666666] hover:text-[#1A1A1A] transition-colors"
      >
        <span>My Builds ({builds.length})</span>
        <span className="text-xs text-[#BBBBBB]">
          {expanded ? '▲ Hide' : '▼ Show'}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2 mt-1 mb-2">
          {builds.map((b) => (
            <div
              key={b.id}
              className="flex items-center gap-3 py-3 px-4 bg-surface border-2 border-border rounded-card shadow-card transition-all duration-200 hover:border-brick-red hover:shadow-card-hover cursor-pointer group"
              onClick={() => onLoadBuild(b.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-[#1A1A1A] truncate">{b.name}</div>
                <div className="text-xs text-[#999999]">
                  {b.totalBricks} bricks · {formatRelativeTime(b.updatedAt)}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${b.name}"?`)) {
                    deleteBuild(b.id);
                    setBuilds(loadBuildMetaList());
                    setStorageInfo(getStorageInfo());
                  }
                }}
                className="text-xs text-[#CCCCCC] hover:text-brick-red transition-colors opacity-0 group-hover:opacity-100"
                title="Delete build"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="text-[10px] text-[#BBBBBB] text-center mt-1">
            {storageInfo.usedKB}KB used
          </div>
        </div>
      )}
    </div>
  );
}
