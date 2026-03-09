import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.FLOCK_TEST_URL || 'https://taurant.onrender.com';

const DEVICES = [
  { name: 'iPhone-SE',        width: 320, height: 568 },
  { name: 'iPhone-12-mini',   width: 375, height: 812 },
  { name: 'iPhone-14',        width: 390, height: 844 },
  { name: 'Pixel-7',          width: 393, height: 851 },
  { name: 'Galaxy-S23',       width: 412, height: 915 },
  { name: 'iPhone-14-Pro-Max', width: 430, height: 932 },
];

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.03,
    },
  },
  use: {
    baseURL: BASE_URL,
    colorScheme: 'dark',
    locale: 'en-IN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: DEVICES.map((d) => ({
    name: d.name,
    use: {
      viewport: { width: d.width, height: d.height },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
  })),
  reporter: [['html', { open: 'never' }]],
  outputDir: './tests/results',
});
