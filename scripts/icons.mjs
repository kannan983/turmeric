// Renders public/logo.svg to the PNG icon sizes Chrome needs. Run: node scripts/icons.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'

const svg = fs.readFileSync('public/logo.svg', 'utf8')
fs.mkdirSync('public/icons', { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage()
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`)
  await page.screenshot({ path: `public/icons/icon-${size}.png`, omitBackground: true })
}
await browser.close()
