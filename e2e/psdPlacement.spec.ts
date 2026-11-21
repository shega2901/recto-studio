import { test, expect } from '@playwright/test';
import { writePsdBuffer } from 'ag-psd';
import { importProject, projectFixture, savedProject } from './fixtures';

test('places a layered PSD through the picker, loading the reader on demand', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  const psdRequests: string[] = [];
  page.on('request', request => { if (/\/psdParser[^/]*\.(js|ts)(\?|$)/.test(request.url())) psdRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('#spread-canvas')).toBeVisible();

  const project = projectFixture();
  project.spreads[0].elements = [];
  await importProject(page, project);
  const canvas = page.locator('#spread-canvas');
  const payload = await page.evaluate(() => {
    const bitmap = document.createElement('canvas');
    bitmap.width = 40;
    bitmap.height = 30;
    bitmap.getContext('2d')!.fillRect(0, 0, 40, 30);
    return bitmap.toDataURL().split(',')[1];
  });
  await canvas.evaluate((element, encoded) => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    transfer.items.add(new File([bytes], 'placed.png', { type: 'image/png' }));
    const { x, y, width, height } = element.getBoundingClientRect();
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true,
      clientX: x + width / 2, clientY: y + height / 2 }));
  }, payload);
  await expect.poll(async () => (await savedProject(page)).spreads[0].elements.length).toBe(1);
  // The Photoshop reader is not part of start-up or of placing an ordinary image.
  expect(psdRequests).toEqual([]);

  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('button', { name: 'Replace Photo', exact: true })).toBeVisible();
  const psd = writePsdBuffer({
    width: 200, height: 150,
    children: [
      { name: 'Base Layer', hidden: false, opacity: 1, left: 0, top: 0, right: 200, bottom: 150 },
      { name: 'Badge', hidden: true, opacity: 1, left: 10, top: 10, right: 100, bottom: 100 },
    ],
  } as Parameters<typeof writePsdBuffer>[0]);
  await page.locator('input[accept="image/*,.psd,.psb"]')
    .setInputFiles({ name: 'cover.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: Buffer.from(psd) });

  await expect.poll(async () => (await savedProject(page)).spreads[0].elements[0].name).toBe('cover.psd');
  const image = (await savedProject(page)).spreads[0].elements[0];
  expect(image).toMatchObject({ isPsd: true, format: 'PSD', originalWidth: 200, originalHeight: 150 });
  expect(image.psdLayers?.map((layer: { name: string }) => layer.name)).toEqual(['Base Layer', 'Badge']);
  expect(image.activePsdLayerIds).toEqual([1]);
  expect(psdRequests.length).toBeGreaterThan(0);
});
