// Web-only views of the agent-written JSON that shared/types.ts leaves open (plan shots, report, critique, lyrics…).
// Only the fields the UI reads; everything is optional unless the page can't render without it.
import type { Snapshot, Plan, PlanCharacter, ChatMessage } from '../../shared/types.ts';

export type Camera = { move: string; lens?: number | string; from?: { fill?: number | null }; to?: { fill?: number | null }; pace?: string };
export type Shot = {
  id: string; start_s?: number; end_s?: number; summary?: string; action?: string; camera?: string | Camera; camera_note?: string;
  ref_shot?: number | string | null; ref_what?: string; transition_in?: string; transition_out?: string; reads?: string[]; text_overlay?: { text: string }[]; assets?: string[];
};
export type PlanAsset = { id: string; file?: string; kind?: string; purpose?: string; status?: string; source?: string; license?: string };
export interface PlanView extends Plan {
  logline?: string; style?: string; engine?: string;
  format?: { width?: number; height?: number; duration_s?: number };
  look?: { palette?: string[]; medium?: string; color_arc?: string };
  borrowed_from_reference?: string[];
  music?: { file?: string; source?: string; bpm?: number; license?: string; section?: { start_s?: number; end_s?: number } };
  style_frames?: string[];
  characters?: (PlanCharacter & { design?: string; arc?: string })[];
  shots?: Shot[];
  assets?: PlanAsset[];
  open_questions?: string[];
  changelog?: string[];
}

export type Report = {
  video: { duration: number; width: number; height: number; fps: number };
  crop?: { w: number; h: number } | null;
  audio?: { bpm?: number; present?: boolean; silent?: boolean };
  pacing?: { count?: number; mean_shot_s?: number; mean_shot_beats?: number };
};
export type Route = { engine?: string; style?: string; medium?: string; confidence?: number; why?: string[] };
export type MustFix = { shot?: string; time?: number | null; issue: string; fix?: string };
export type PeakVerdict = { id: string; ours?: number[]; ref?: number[]; strip?: string; verdict?: 'ours_better' | 'equal' | 'ref_better'; why?: string };
export type Critique = { pass?: boolean; summary?: string; scores?: Record<string, number>; must_fix?: (MustFix | null)[]; peaks?: PeakVerdict[] };
export type Production = { characters?: { id: string; name?: string }[] };
export type LyricLine = { start?: number; end?: number; text: string; match: number };
export type Lyrics = { lines?: LyricLine[] };

// the project snapshot with those files narrowed (cast once where it is loaded)
export type SnapshotView = Omit<Snapshot, 'report' | 'route' | 'plan' | 'critique' | 'production' | 'lyrics'> & {
  report: Report | null; route: Route | null; plan: PlanView | null; critique: Critique | null; production: Production | null; lyrics: Lyrics | null;
};

// what a chat message is about (a shot, a moment in the film, or an open question from the plan)
export type Tag = { shot?: string; time?: number; q?: string };
export type MessageMeta = Pick<ChatMessage, 'shot' | 'time' | 'attachments' | 'notes'>;
