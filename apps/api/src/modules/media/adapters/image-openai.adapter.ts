import type { ImageAdapter, ImageRequest, GeneratedMedia } from '../media.types';

const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
const DEFAULT_MODEL = process.env['IMAGE_OPENAI_MODEL'] ?? 'dall-e-3';

/** Real image generation via the OpenAI images API — active whenever OPENAI_API_KEY is set. */
export class OpenAiImageAdapter implements ImageAdapter {
  readonly name = 'openai-image';

  available(): boolean {
    return !!process.env['OPENAI_API_KEY'];
  }

  async generateImage(req: ImageRequest): Promise<GeneratedMedia> {
    // dall-e-3 supports fixed sizes; pick the closest orientation
    const size = req.width >= req.height ? '1792x1024' : '1024x1792';
    const res = await fetch(OPENAI_IMAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env['OPENAI_API_KEY']}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        prompt: req.negativePrompt
          ? `${req.prompt}\n\nAvoid: ${req.negativePrompt}`
          : req.prompt,
        n: 1,
        size,
        response_format: 'b64_json',
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI image generation failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI image generation returned no image data');
    return {
      buffer: Buffer.from(b64, 'base64'),
      mimeType: 'image/png',
      ext: 'png',
      model: DEFAULT_MODEL,
    };
  }
}
