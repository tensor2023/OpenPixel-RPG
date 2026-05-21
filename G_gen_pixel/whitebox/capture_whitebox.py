#!/usr/bin/env python3
"""Capture Baidu Maps 3D whitebox screenshot for NYC Central Park."""

import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright

HTML_PATH = Path(__file__).parent / "baidu_whitebox.html"
OUTPUT_PATH = Path(__file__).parent / "whitebox.png"

async def capture():
    async with async_playwright() as p:
        browser = await p.firefox.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 960})

        print(f"Loading {HTML_PATH.as_uri()} ...")
        await page.goto(HTML_PATH.as_uri(), wait_until="networkidle", timeout=30000)

        # Wait for map tiles to load (title changes to READY)
        try:
            await page.wait_for_function("document.title === 'READY'", timeout=20000)
            print("Tiles loaded.")
        except Exception:
            print("Timeout waiting for tilesloaded, taking screenshot anyway...")

        # Extra wait for 3D buildings to render
        await asyncio.sleep(3)

        await page.screenshot(path=str(OUTPUT_PATH), full_page=False)
        print(f"Saved: {OUTPUT_PATH}")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(capture())
