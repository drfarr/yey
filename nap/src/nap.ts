import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

export const MODEL = 'claude-opus-5-5';
export const MIN_CHARS = 40;
export const MAX_CHARS = 60_000;
const WORDS_PER_MINUTE = 238; // average adult silent reading speed
const SECONDS_TO_READ_A_NAP = 8;

export class NapError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'NapError';
  }
}

const NapOutput = z.object({
  tldr: z.string().describe('One plain sentence. If someone reads only this, they lose nothing important.'),
  need_to_know: z
    .array(z.string())
    .describe('At most 3 bullets, each under 15 words. Only things that change what the reader does, decides, or believes. Empty is valid.'),
  action: z
    .string()
    .describe('The one concrete thing the reader must do, with any deadline. If nothing, exactly "Nothing."'),
  nap_score: z
    .number()
    .describe('0-100. The percentage of the text that was filler, repetition, throat-clearing, or already known.'),
  verdict: z
    .string()
    .describe('One line, under 12 words, funny but never cruel to the author. Screenshot-worthy.'),
});

export interface NapResult {
  tldr: string;
  needToKnow: string[];
  action: string;
  napScore: number;
  verdict: string;
  stats: {
    words: number;
    readSeconds: number;
    savedSeconds: number;
  };
  share: string;
}

export interface NapOptions {
  client?: Anthropic;
  model?: string;
}

export const SYSTEM_PROMPT = `You are nap. People paste you things they were supposed to read: emails, Slack threads, meeting notes, articles, terms of service, group chats, announcements. You tell them what they could have slept through.

Write for the reader who skipped it. Never address the author. Never invent facts that are not in the text. If the text is dense and every line matters, say so and give it a low nap score. If it is a "quick update" with one real sentence buried in pleasantries, be honest and a little savage about it.

Scoring guide for nap_score:
- 0-20: dense, every line matters (contracts, specs, instructions)
- 21-50: mostly useful with some padding
- 51-80: one or two real points wrapped in filler
- 81-100: could have been a single sentence, or nothing at all`;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function buildShareText(r: Pick<NapResult, 'napScore' | 'verdict'> & { words: number }): string {
  return `I just napped through ${r.words.toLocaleString()} words. ${r.napScore}% nappable.\n\n"${r.verdict}"\n\n#nap`;
}

export function validateInput(text: string): string {
  const trimmed = (text ?? '').trim();
  if (trimmed.length < MIN_CHARS) {
    throw new NapError('Too short to nap through. Paste something longer.');
  }
  if (trimmed.length > MAX_CHARS) {
    throw new NapError(`That is a novel, not a nap. Keep it under ${MAX_CHARS.toLocaleString()} characters.`);
  }
  return trimmed;
}

let defaultClient: Anthropic | undefined;
function getClient(): Anthropic {
  if (!defaultClient) defaultClient = new Anthropic();
  return defaultClient;
}

export async function napify(text: string, opts: NapOptions = {}): Promise<NapResult> {
  const input = validateInput(text);
  const client = opts.client ?? getClient();
  const words = countWords(input);

  const response = await client
    .messages
    .parse({
      model: opts.model ?? MODEL,
      max_tokens: 2048,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: zodOutputFormat(NapOutput) },
      messages: [
        {
          role: 'user',
          content: `Here is what I was supposed to read:\n\n<text>\n${input}\n</text>`,
        },
      ],
    })
    .catch((err: unknown) => {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new NapError('nap has no API key. Set ANTHROPIC_API_KEY.', 500);
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new NapError('nap is too popular right now. Try again in a minute.', 429);
      }
      if (err instanceof Anthropic.APIError) {
        throw new NapError(`nap tripped over the API (${err.status}).`, 502);
      }
      throw err;
    });

  if (response.stop_reason === 'refusal') {
    throw new NapError('nap would rather not read that one.', 422);
  }
  const out = response.parsed_output;
  if (!out) {
    throw new NapError('nap woke up confused. Try again.', 502);
  }

  const napScore = clampScore(out.nap_score);
  const readSeconds = Math.round((words / WORDS_PER_MINUTE) * 60);
  const savedSeconds = Math.max(0, Math.round((readSeconds * napScore) / 100) - SECONDS_TO_READ_A_NAP);
  const verdict = out.verdict.trim();

  return {
    tldr: out.tldr.trim(),
    needToKnow: out.need_to_know.map((s) => s.trim()).filter(Boolean).slice(0, 3),
    action: out.action.trim() || 'Nothing.',
    napScore,
    verdict,
    stats: { words, readSeconds, savedSeconds },
    share: buildShareText({ napScore, verdict, words }),
  };
}
