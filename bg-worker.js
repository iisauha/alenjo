import {
  AutoModel,
  AutoProcessor,
  RawImage,
  env
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/+esm';

env.allowLocalModels = false;

let modelCtx = null;

async function loadContext() {
  if (modelCtx) return modelCtx;
  const modelId = 'briaai/RMBG-1.4';
  const model = await AutoModel.from_pretrained(modelId, {
    config: { model_type: 'custom' }
  });
  const processor = await AutoProcessor.from_pretrained(modelId, {
    config: {
      do_normalize: true,
      do_pad: false,
      do_rescale: true,
      do_resize: true,
      image_mean: [0.5, 0.5, 0.5],
      image_std: [1, 1, 1],
      resample: 2,
      rescale_factor: 0.00392156862745098,
      size: { width: 1024, height: 1024 }
    }
  });
  modelCtx = { model, processor };
  return modelCtx;
}

self.addEventListener('message', async (e) => {
  const { blob } = e.data || {};
  if (!blob) return;
  try {
    const { model, processor } = await loadContext();
    self.postMessage({ type: 'status', text: 'Extracting card...' });

    const image = await RawImage.fromBlob(blob);
    const inputs = await processor(image);
    const out = await model({ input: inputs.pixel_values });
    const tensor = out.output || out[Object.keys(out)[0]];
    const scaled = tensor[0].mul(255).to('uint8');
    const mask = await RawImage.fromTensor(scaled).resize(image.width, image.height);

    const canvas = new OffscreenCanvas(image.width, image.height);
    const c = canvas.getContext('2d');
    c.drawImage(image.toCanvas(), 0, 0);
    const px = c.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < mask.data.length; i++) {
      px.data[4 * i + 3] = mask.data[i];
    }
    c.putImageData(px, 0, 0);
    const result = await canvas.convertToBlob({ type: 'image/png' });

    self.postMessage({ type: 'result', blob: result });
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
  }
});
