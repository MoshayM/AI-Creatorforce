import { BaseAgent, type AgentContext } from './base-agent';
import { EditPlanOutputSchema, type EditPlanOutput } from '@cf/shared';
import type { ScriptOutput } from '@cf/shared';

export interface EditPlanAgentInput {
  script: ScriptOutput;
  availableAssets: Array<{
    id: string;
    kind: string;
    label: string;
    durationMs?: number;
    sectionRef?: string;
  }>;
  brandKit?: {
    colorPalette?: string[];
    fontStyle?: string;
  };
  format?: 'landscape' | 'portrait';
  projectId: string;
}

export class EditPlanAgent extends BaseAgent<EditPlanAgentInput, EditPlanOutput> {
  readonly name = 'EditPlanAgent';
  readonly systemPrompt = `You are a professional video editor AI. Given a script and available assets, you create a first-cut timeline by sequencing voice narration, video clips, music, subtitles, and overlays. The timeline must follow the script structure exactly. Respond only with valid JSON.`;

  async run(input: EditPlanAgentInput, _ctx: AgentContext): Promise<EditPlanOutput> {
    const isPortrait = input.format === 'portrait';
    const resolution = isPortrait
      ? { width: 1080, height: 1920 }
      : { width: 1920, height: 1080 };

    const totalDurationMs = input.script.sections.reduce(
      (sum, s) => sum + s.durationEstimateSecs * 1000, 0,
    );

    return this.callStructured(
      [{
        role: 'user',
        content: `Create an AI first-cut video timeline.

Script: "${input.script.title}"
Format: ${isPortrait ? '9:16 Shorts' : '16:9 Standard'}
Resolution: ${resolution.width}×${resolution.height}
Total Duration: ~${Math.round(totalDurationMs / 1000)}s

Script sections:
${input.script.sections.map((s, i) => `[${i}] ${s.heading}: ${s.durationEstimateSecs}s`).join('\n')}

Available assets:
${input.availableAssets.map(a => `- [${a.id}] ${a.kind}: "${a.label}" ${a.durationMs ? `(${Math.round(a.durationMs / 1000)}s)` : ''}`).join('\n')}

Brand kit: ${JSON.stringify(input.brandKit ?? {})}

Create a multi-track timeline with:
1. Voice track: sequence voice clips per section
2. Video track: match video/image assets to sections
3. Music track: background music ducked under narration
4. Subtitle track: subtitle cues aligned to voice
5. Overlay track: title card at start, CTA at end

Use actual asset IDs from the available list. Timeline must be schematically valid.
Project ID: ${input.projectId}`,
      }],
      EditPlanOutputSchema,
      { maxTokens: 6000 },
    ) as Promise<EditPlanOutput>;
  }
}
