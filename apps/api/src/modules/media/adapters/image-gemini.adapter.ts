import type { ImageAdapter, ImageRequest, GeneratedMedia } from '../media.types';

const DEFAULT_MODEL = process.env['IMAGE_GEMINI_MODEL'] ?? 'gemini-2.5-flash-image';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Real image generation via the Gemini API — active whenever GEMINI_API_KEY is set. */
export class GeminiImageAdapter implements ImageAdapter {
  readonly name = 'gemini-image';

  available(): boolean {
    return !!process.env['GEMINI_API_KEY'];
  }

  async generateImage(req: ImageRequest): Promise<GeneratedMedia> {
    const orientation = req.width >= req.height ? 'wide 16:9 landscape' : 'tall 9:16 portrait';
    const prompt = [
      `Generate a single ${orientation} image.`,
      req.prompt,
      req.negativePrompt ? `Avoid: ${req.negativePrompt}` : '',
    ].filter(Boolean).join('\n\n');

    const res = await fetch(`${API_BASE}/${DEFAULT_MODEL}:generateContent?key=${process.env['GEMINI_API_KEY']}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini image generation failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
    };
    const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!inline?.data) throw new Error('Gemini image generation returned no image data');
    const mimeType = inline.mimeType ?? 'image/png';
    return {
      buffer: Buffer.from(inline.data, 'base64'),
      mimeType,
      ext: mimeType.includes('jpeg') ? 'jpg' : 'png',
      model: DEFAULT_MODEL,
    };
  }
}
