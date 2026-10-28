"use client";

import Image from 'next/image';

export type ClipOption = { id: string; name: string; trackName: string; startUs: number; durationUs: number };
const timestamp = (us: number) => { const seconds = us / 1e6; return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`; };

export function ClipSelection({ projectId, clips, scope, selected, disabled, onScope, onSelected }: {
  projectId: string; clips: ClipOption[]; scope: 'project' | 'clips'; selected: string[]; disabled: boolean;
  onScope: (scope: 'project' | 'clips') => void; onSelected: (ids: string[]) => void;
}) {
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="mb-3 text-sm font-medium text-slate-200">What should AI edit?</legend>
    <div className="grid gap-2 sm:grid-cols-2">
      {([{ id: 'project', title: 'Entire project', detail: 'AI follows your prompt across the active timeline.' },
        { id: 'clips', title: 'Selected clips', detail: 'Limit changes to the clips you check below.' }] as const).map(option =>
        <label key={option.id} className={`flex min-h-20 cursor-pointer gap-3 rounded-xl border p-3 ${scope === option.id ? 'border-emerald-300 bg-emerald-300/10' : 'border-white/15 bg-[#0b1220]'}`}>
          <input type="radio" name="edit-scope" value={option.id} checked={scope === option.id} onChange={() => onScope(option.id)} className="mt-1 accent-emerald-300" />
          <span><span className="block text-sm font-medium">{option.title}</span><span className="mt-1 block text-xs leading-5 text-slate-400">{option.detail}</span></span>
        </label>)}
    </div>
    {scope === 'clips' ? <>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span aria-live="polite">{selected.length} of {clips.length} clips selected</span>
        <div className="flex gap-3"><button type="button" className="min-h-11 text-emerald-300" onClick={() => onSelected(clips.map(clip => clip.id))}>Select all</button>
          <button type="button" className="min-h-11 text-emerald-300" onClick={() => onSelected([])}>Clear</button></div>
      </div>
      <div className="max-h-80 space-y-2 overflow-auto" aria-label="Clips to edit">
        {clips.map((clip, index) => <label key={clip.id} className={`flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border p-3 focus-within:outline-2 focus-within:outline-emerald-300 ${selected.includes(clip.id) ? 'border-emerald-300 bg-emerald-300/10' : 'border-white/10 bg-[#0b1220]'}`}>
          <input type="checkbox" checked={selected.includes(clip.id)} onChange={event => onSelected(event.target.checked ? [...selected, clip.id] : selected.filter(id => id !== clip.id))} className="h-4 w-4 shrink-0 accent-emerald-300" />
          <Image unoptimized src={`/api/clip-thumbnail?projectId=${encodeURIComponent(projectId)}&clipId=${encodeURIComponent(clip.id)}`} alt="" width={80} height={60} className="h-14 w-16 shrink-0 rounded-lg bg-black object-cover" />
          <span className="min-w-0"><span className="block break-words text-sm font-medium">{index + 1}. {clip.name}</span>
            <span className="mt-1 block text-xs text-slate-400">{clip.trackName} · {timestamp(clip.startUs)}–{timestamp(clip.startUs + clip.durationUs)}</span></span>
        </label>)}
      </div>
      <p className="text-xs leading-5 text-slate-400">Unchecked clips stay unchanged. A reference is optional.</p>
    </> : <p className="text-xs leading-5 text-slate-400">{clips.length} video clips available. Describe the result you want; AI plans which clips need changes and preserves unrelated content. Existing text/audio edits and unsupported timeline operations are reported explicitly.</p>}
    {!clips.length && <p className="text-sm text-amber-200">This timeline has no editable video clips.</p>}
  </fieldset>;
}
