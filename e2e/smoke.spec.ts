import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tauriMockScript } from './tauri-mock';

const __filename = fileURLToPath(import.meta.url);
const __e2eDir = path.dirname(__filename);

// Helper: inject mock before navigation so it's available when React boots.
async function loadWithMock(page: import('@playwright/test').Page, path = '/') {
  await page.addInitScript(tauriMockScript);
  await page.goto(path);
}

// ---------------------------------------------------------------------------
// 1. App loads
// ---------------------------------------------------------------------------
test('app loads and shows initializing status', async ({ page }) => {
  await loadWithMock(page);

  // The main container should be visible
  const container = page.locator('[data-testid="app-container"]');
  await expect(container).toBeVisible();

  // The sprite element should exist
  const sprite = page.locator('[data-testid="mascot-sprite"]');
  await expect(sprite).toBeVisible();

  // The status pill should show "Initializing..." (the default state)
  const label = page.locator('[data-testid="status-label"]');
  await expect(label).toHaveText('Initializing...');
});

// ---------------------------------------------------------------------------
// 2. Status transition to busy
// ---------------------------------------------------------------------------
test('status transitions to busy', async ({ page }) => {
  await loadWithMock(page);

  // Wait for initial render
  await expect(page.locator('[data-testid="status-label"]')).toBeVisible();

  // Emit a status-changed event with "busy"
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('status-changed', 'busy');
  });

  // The label should now read "Working..."
  const label = page.locator('[data-testid="status-label"]');
  await expect(label).toHaveText('Working...');

  // The dot should have the "busy" class
  const dot = page.locator('[data-testid="status-dot"]');
  await expect(dot).toHaveClass(/\bbusy\b/);
});

// ---------------------------------------------------------------------------
// 3. Status transition to idle
// ---------------------------------------------------------------------------
test('status transitions to idle', async ({ page }) => {
  await loadWithMock(page);

  await expect(page.locator('[data-testid="status-label"]')).toBeVisible();

  // Emit idle
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('status-changed', 'idle');
  });

  const label = page.locator('[data-testid="status-label"]');
  await expect(label).toHaveText('Free');

  const dot = page.locator('[data-testid="status-dot"]');
  await expect(dot).toHaveClass(/\bidle\b/);
});

// ---------------------------------------------------------------------------
// 4. Speech bubble appears and dismisses
// ---------------------------------------------------------------------------
test('speech bubble appears on task-completed and dismisses on click', async ({ page }) => {
  await loadWithMock(page);

  await expect(page.locator('[data-testid="status-label"]')).toBeVisible();

  // The bubble should not be visible initially
  await expect(page.locator('[data-testid="speech-bubble"]')).not.toBeVisible();

  // Emit a task-completed event (useBubble listens to this)
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('task-completed', { duration_secs: 5 });
  });

  // The bubble should now be visible with some message text
  const bubble = page.locator('[data-testid="speech-bubble"]');
  await expect(bubble).toBeVisible();

  const bubbleText = page.locator('[data-testid="speech-bubble-text"]');
  await expect(bubbleText).not.toBeEmpty();

  // Click the bubble to dismiss it
  await bubble.click();

  // The bubble should disappear
  await expect(bubble).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// 5. Scenario mode
// ---------------------------------------------------------------------------
test('scenario override shows badge and changes status', async ({ page }) => {
  await loadWithMock(page);

  await expect(page.locator('[data-testid="status-label"]')).toBeVisible();

  // No scenario badge initially
  await expect(page.locator('[data-testid="scenario-badge"]')).not.toBeVisible();

  // Emit scenario-override with status "service"
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('scenario-override', { status: 'service' });
  });

  // The scenario badge should appear
  const badge = page.locator('[data-testid="scenario-badge"]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('SCENARIO');

  // The container should have scenario-active class
  const container = page.locator('[data-testid="app-container"]');
  await expect(container).toHaveClass(/scenario-active/);

  // The status pill should show "Service"
  const label = page.locator('[data-testid="status-label"]');
  await expect(label).toHaveText('Service');
});

// ---------------------------------------------------------------------------
// 6. Status transition to disconnected
// ---------------------------------------------------------------------------
test('status transitions to disconnected', async ({ page }) => {
  await loadWithMock(page);

  await expect(page.locator('[data-testid="status-label"]')).toBeVisible();

  // Emit disconnected
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('status-changed', 'disconnected');
  });

  const label = page.locator('[data-testid="status-label"]');
  await expect(label).toHaveText('Sleep');

  const dot = page.locator('[data-testid="status-dot"]');
  await expect(dot).toHaveClass(/\bdisconnected\b/);
});

// ---------------------------------------------------------------------------
// 7. Status transition to searching
// ---------------------------------------------------------------------------
test('status transitions to searching', async ({ page }) => {
  await loadWithMock(page);

  await expect(page.locator('[data-testid="status-label"]')).toBeVisible();

  // Emit searching
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('status-changed', 'searching');
  });

  const label = page.locator('[data-testid="status-label"]');
  await expect(label).toHaveText('Searching...');

  const dot = page.locator('[data-testid="status-dot"]');
  await expect(dot).toHaveClass(/\bsearching\b/);
});

// ---------------------------------------------------------------------------
// 8. Visiting status hides mascot
// ---------------------------------------------------------------------------
test('visiting status hides mascot', async ({ page }) => {
  await loadWithMock(page);

  // Wait for initial render and set idle so mascot is visible
  await expect(page.locator('[data-testid="status-label"]')).toBeVisible();
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('status-changed', 'idle');
  });
  await expect(page.locator('[data-testid="mascot-sprite"]')).toBeVisible();

  // Emit dog-away with true to trigger visiting status
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('dog-away', true);
  });

  // The mascot sprite should no longer be visible (replaced by placeholder div)
  await expect(page.locator('[data-testid="mascot-sprite"]')).not.toBeVisible();

  // The status pill should show "Visiting..."
  const label = page.locator('[data-testid="status-label"]');
  await expect(label).toHaveText('Visiting...');
});

// ---------------------------------------------------------------------------
// 9. Settings page loads
// ---------------------------------------------------------------------------
test('settings page loads and renders form', async ({ page }) => {
  await loadWithMock(page, '/settings.html');

  // The settings container should be visible
  const settings = page.locator('.settings');
  await expect(settings).toBeVisible();

  // The sidebar should be rendered with tab buttons
  const sidebar = page.locator('.settings-sidebar');
  await expect(sidebar).toBeVisible();

  // Should have General, Mime, and About tabs
  await expect(sidebar.locator('.sidebar-item')).toHaveCount(3);
  await expect(sidebar.locator('.sidebar-item').nth(0)).toHaveText('General');
  await expect(sidebar.locator('.sidebar-item').nth(1)).toHaveText('Mime');
  await expect(sidebar.locator('.sidebar-item').nth(2)).toHaveText('About');

  // The content area with the title should be visible
  const content = page.locator('.settings-content');
  await expect(content).toBeVisible();

  // The title should show "General" (the default tab)
  const title = page.locator('.settings-title');
  await expect(title).toHaveText('General');
});

// ---------------------------------------------------------------------------
// 10. Upload Charlotte as custom sprite
// ---------------------------------------------------------------------------
test('upload Charlotte as custom sprite via manual flow', async ({ page }) => {
  await loadWithMock(page, '/settings.html');

  // Navigate to Mime tab
  await page.click('.sidebar-item:nth-child(2)');
  await expect(page.locator('.settings-title')).toHaveText('Mime');

  // Click the Manual add card to open the creator form
  await page.click('.pet-card.add-card:has-text("Manual")');
  const creator = page.locator('.custom-creator');
  await expect(creator).toBeVisible();

  const saveBtn = creator.locator('.creator-btn.save');

  // Clicking Save without a name shows validation error
  await saveBtn.click();
  await expect(page.locator('.save-error')).toHaveText('Name is required');

  // Enter "Charlotte" as the mime name
  await creator.locator('.settings-input').fill('Charlotte');

  // Configure mock file dialog to return a fake sprite path
  await page.evaluate(() => {
    (window as any).__MOCK_DIALOG_RESULT__ = '/mock/sprites/charlotte.png';
  });

  // Pick a sprite file for each of the 7 statuses
  const pickButtons = creator.locator('.sprite-pick-btn');
  await expect(pickButtons).toHaveCount(7);

  for (let i = 0; i < 7; i++) {
    await pickButtons.nth(i).click();
    // Button text changes from "Choose PNG" to the selected filename
    await expect(pickButtons.nth(i)).toHaveText('charlotte.png');
  }

  // Customise frame specs using range expressions
  // idle=1-5, busy=8, service=1-3, disconnected=1, searching=41-55,57,58, initializing=1-4, visiting=2-6,8
  const frameInputs = creator.locator('.frame-count-input');
  const frameSpecs = ['1-5', '8', '1-3', '1', '41-55,57,58', '1-4', '2-6,8'];

  for (let i = 0; i < frameSpecs.length; i++) {
    await frameInputs.nth(i).fill(frameSpecs[i]);
  }

  // Save should be enabled (name + files + valid frame specs)
  await expect(saveBtn).toBeEnabled();

  // Save the custom mime
  await saveBtn.click();

  // The creator form should close
  await expect(creator).not.toBeVisible();

  // Charlotte should appear in the custom mimes list
  const charlotteName = page.locator('.pet-card-wrapper .pet-name', { hasText: 'Charlotte' });
  await expect(charlotteName).toBeVisible();
});

// ---------------------------------------------------------------------------
// 11. Charlotte sprite renders at tiny (0.5x) size
// ---------------------------------------------------------------------------
test('Charlotte sprite renders at tiny size (64×64) on main page', async ({ page }) => {
  await loadWithMock(page);

  // Wait for initial render
  await expect(page.locator('[data-testid="app-container"]')).toBeVisible();

  const charlotte = {
    id: 'custom-12345',
    name: 'Charlotte',
    sprites: {
      idle:          { fileName: 'custom-12345-idle.png',          frames: 5 },
      busy:          { fileName: 'custom-12345-busy.png',          frames: 8 },
      service:       { fileName: 'custom-12345-service.png',       frames: 3 },
      disconnected:  { fileName: 'custom-12345-disconnected.png',  frames: 1 },
      searching:     { fileName: 'custom-12345-searching.png',     frames: 17 },
      initializing:  { fileName: 'custom-12345-initializing.png',  frames: 4 },
      visiting:      { fileName: 'custom-12345-visiting.png',      frames: 6 },
    },
  };

  // Set Charlotte as the active pet at tiny (0.5x) scale via events
  await page.evaluate((mimeData) => {
    const emit = (window as any).__TEST_EMIT__;
    emit('custom-mimes-changed', [mimeData]);
    emit('pet-changed', 'custom-12345');
    emit('scale-changed', 0.5);
  }, charlotte);

  // The sprite appears once the custom sprite URL resolves asynchronously
  const sprite = page.locator('[data-testid="mascot-sprite"]');
  await expect(sprite).toBeVisible();

  // At scale 0.5, sprite should be 64×64 (128 * 0.5)
  await expect(sprite).toHaveCSS('width', '64px');
  await expect(sprite).toHaveCSS('height', '64px');
});

// ---------------------------------------------------------------------------
// 12. Edit Charlotte: rename and change busy frame range
// ---------------------------------------------------------------------------
test('edit Charlotte sprite: rename and change busy frame range', async ({ page }) => {
  await loadWithMock(page, '/settings.html');

  // Navigate to Mime tab
  await page.click('.sidebar-item:nth-child(2)');
  await expect(page.locator('.settings-title')).toHaveText('Mime');

  // Inject Charlotte into custom mimes via event
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('custom-mimes-changed', [{
      id: 'custom-12345',
      name: 'Charlotte',
      sprites: {
        idle:          { fileName: 'custom-12345-idle.png',          frames: 5 },
        busy:          { fileName: 'custom-12345-busy.png',          frames: 8 },
        service:       { fileName: 'custom-12345-service.png',       frames: 3 },
        disconnected:  { fileName: 'custom-12345-disconnected.png',  frames: 1 },
        searching:     { fileName: 'custom-12345-searching.png',     frames: 17 },
        initializing:  { fileName: 'custom-12345-initializing.png',  frames: 4 },
        visiting:      { fileName: 'custom-12345-visiting.png',      frames: 6 },
      },
    }]);
  });

  // Charlotte should appear in the custom section
  await expect(page.locator('.pet-card-wrapper .pet-name', { hasText: 'Charlotte' })).toBeVisible();

  // Hover the card to reveal the edit button, then click it
  const charlotteWrapper = page.locator('.pet-card-wrapper', { has: page.locator('.pet-name', { hasText: 'Charlotte' }) });
  await charlotteWrapper.hover();
  await page.click('[data-testid="edit-mime-custom-12345"]');

  // The creator form should open with Charlotte's data pre-filled
  const creator = page.locator('.custom-creator');
  await expect(creator).toBeVisible();

  // Name should be pre-filled with "Charlotte"
  const nameInput = creator.locator('.settings-input');
  await expect(nameInput).toHaveValue('Charlotte');

  // Frame inputs should be pre-filled from existing data
  const frameInputs = creator.locator('.frame-count-input');
  await expect(frameInputs.nth(0)).toHaveValue('5');   // idle
  await expect(frameInputs.nth(1)).toHaveValue('8');   // busy

  // Sprite buttons should show existing file names (not "Choose PNG")
  const pickButtons = creator.locator('.sprite-pick-btn');
  await expect(pickButtons.nth(1)).toHaveText('custom-12345-busy.png');

  // --- Make edits ---

  // Rename to "Charlotte v2"
  await nameInput.fill('Charlotte v2');

  // Change busy frames from "8" to "1-10"
  await frameInputs.nth(1).fill('1-10');

  // Save should be enabled (existing files carry over when editing)
  const saveBtn = creator.locator('.creator-btn.save');
  await expect(saveBtn).toBeEnabled();

  // Save
  await saveBtn.click();

  // The creator form should close
  await expect(creator).not.toBeVisible();

  // The updated name should appear; the old name should not
  const allNames = await page.locator('.pet-card-wrapper .pet-name').allTextContents();
  expect(allNames).toContain('Charlotte v2');
  expect(allNames).not.toContain('Charlotte');
});

// ---------------------------------------------------------------------------
// 13. SmartImport Charlotte: auto-fill name and custom frame selection
// ---------------------------------------------------------------------------
test('SmartImport Charlotte with auto-fill name and frame selection', async ({ page }) => {
  await loadWithMock(page, '/settings.html');

  // Load Charlotte sprite sheet and inject as mock readFile result
  const charlottePath = path.resolve(__e2eDir, '../src/__tests__/fixtures/sprites/charlotte/input.png');
  const b64 = readFileSync(charlottePath).toString('base64');

  await page.evaluate((data: string) => {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    (window as any).__MOCK_READ_FILE_BYTES__ = bytes;
    (window as any).__MOCK_DIALOG_RESULT__ = '/mock/sprites/Charlotte.png';
  }, b64);

  // Navigate to Mime tab
  await page.click('.sidebar-item:nth-child(2)');
  await expect(page.locator('.settings-title')).toHaveText('Mime');

  // Click "Import Sheet" to trigger file dialog mock → SmartImport opens
  await page.click('.pet-card.add-card:has-text("Import Sheet")');

  // Wait for sprite sheet processing — frame assignments should appear
  const frameAssign = page.locator('.smart-import-frame-assign');
  await expect(frameAssign.first()).toBeVisible();
  await expect(frameAssign).toHaveCount(7);

  // Verify name is auto-filled as "Charlotte" (filename without extension)
  const nameInput = page.locator('.smart-import .settings-input');
  await expect(nameInput).toHaveValue('Charlotte');

  // Frame ranges matching the Charlotte sprite sheet assignment
  // (from screenshots: idle=1-5,51-55,57,58 busy=6-43 etc.)
  const frameRanges: Record<string, { input: string; count: number }> = {
    idle:          { input: '1-5,51-55,57,58', count: 12 },
    busy:          { input: '6-43',            count: 38 },
    service:       { input: '14-19',           count: 6 },
    disconnected:  { input: '44-50',           count: 7 },
    searching:     { input: '35-43',           count: 9 },
    initializing:  { input: '6-13',            count: 8 },
    visiting:      { input: '20-43',           count: 24 },
  };
  const statusOrder = ['idle', 'busy', 'service', 'disconnected', 'searching', 'initializing', 'visiting'];

  // Edit frame ranges and verify thumbnails update
  const frameInputs = page.locator('.smart-import-frame-input');
  for (let i = 0; i < statusOrder.length; i++) {
    const status = statusOrder[i];
    const input = frameInputs.nth(i);
    await input.clear();
    await input.fill(frameRanges[status].input);
    await input.blur(); // triggers thumbnail update
  }

  // Verify each status shows the correct number of frame thumbnails with numbers
  for (let i = 0; i < statusOrder.length; i++) {
    const status = statusOrder[i];
    const assign = frameAssign.nth(i);
    const thumbs = assign.locator('.smart-import-frame-thumb-item');
    const nums = assign.locator('.smart-import-frame-num');

    // Correct frame count
    await expect(thumbs).toHaveCount(frameRanges[status].count);
    // Each thumbnail has a frame number label
    await expect(nums).toHaveCount(frameRanges[status].count);
  }

  // Verify first frame number for idle is "1"
  const idleFirstNum = frameAssign.first().locator('.smart-import-frame-num').first();
  await expect(idleFirstNum).toHaveText('1');

  // Save the mime
  const saveBtn = page.locator('.creator-btn.save');
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();

  // SmartImport should close and Charlotte appears in mime list
  await expect(page.locator('.smart-import')).not.toBeVisible();
  await expect(page.locator('.pet-card-wrapper .pet-name', { hasText: 'Charlotte' })).toBeVisible();
});

// ---------------------------------------------------------------------------
// 13b. SmartImport create → edit → re-save round trip
// ---------------------------------------------------------------------------
test('smart-import mime can be edited via Smart Import and keeps its meta', async ({ page }) => {
  await loadWithMock(page, '/settings.html');

  // Load Charlotte fixture bytes
  const charlottePath = path.resolve(__e2eDir, '../src/__tests__/fixtures/sprites/charlotte/input.png');
  const charlotteBytes = readFileSync(charlottePath);
  const b64 = charlotteBytes.toString('base64');

  await page.evaluate((data: string) => {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    (window as any).__MOCK_READ_FILE_BYTES__ = bytes;
    (window as any).__MOCK_DIALOG_RESULT__ = '/mock/sprites/Charlotte.png';
  }, b64);

  // --- Step A: create a smart-import mime ---------------------------------
  await page.click('.sidebar-item:nth-child(2)');
  await expect(page.locator('.settings-title')).toHaveText('Mime');
  await page.click('.pet-card.add-card:has-text("Import Sheet")');

  const frameAssign = page.locator('.smart-import-frame-assign');
  await expect(frameAssign.first()).toBeVisible();
  await expect(frameAssign).toHaveCount(7);

  // Rename the mime
  const nameInput = page.locator('.smart-import .settings-input');
  await nameInput.fill('RoundTrip');

  // Accept auto-distributed frame ranges; save immediately
  const saveBtn = page.locator('.creator-btn.save');
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(page.locator('.smart-import')).not.toBeVisible();

  // --- Step B: verify source sheet was written + meta persisted ------------
  const wroteSource = await page.evaluate(() => {
    const files = (window as any).__MOCK_WRITTEN_FILES__ || [];
    return files.some((f: any) => /-source\.png$/.test(f.path ?? ''));
  });
  expect(wroteSource).toBe(true);

  const storedMimes = await page.evaluate(async () => {
    const rid = await (window as any).__TAURI_INTERNALS__.invoke(
      'plugin:store|load', { path: 'settings.json' }
    );
    const val = await (window as any).__TAURI_INTERNALS__.invoke(
      'plugin:store|get', { rid, key: 'customMimes' }
    );
    return val ? val[0] : null;
  });
  expect(storedMimes).toHaveLength(1);
  expect(storedMimes[0].name).toBe('RoundTrip');
  expect(storedMimes[0].smartImportMeta).toBeDefined();
  expect(storedMimes[0].smartImportMeta.sheetFileName).toMatch(/^custom-\d+-source\.png$/);
  expect(storedMimes[0].smartImportMeta.frameInputs).toBeDefined();
  const originalFrameInputs = storedMimes[0].smartImportMeta.frameInputs;
  const mimeId = storedMimes[0].id;

  // --- Step C: click edit → Smart Import should re-open --------------------
  // Point the FS mock at the same Charlotte bytes for source sheet re-read
  await page.evaluate((data: string) => {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    (window as any).__MOCK_READ_FILE_BYTES__ = bytes;
    // Clear the written files log to isolate update writes
    (window as any).__MOCK_WRITTEN_FILES__ = [];
  }, b64);

  // Hover to reveal edit button (hidden by default, shown on hover)
  const roundTripWrapper = page.locator('.pet-card-wrapper', {
    has: page.locator('.pet-name', { hasText: 'RoundTrip' }),
  });
  await roundTripWrapper.hover();
  await page.click(`[data-testid="edit-mime-${mimeId}"]`);

  // Smart Import editor opens (not Manual)
  await expect(page.locator('.smart-import-frame-assign').first()).toBeVisible();
  await expect(page.locator('.smart-import-frame-assign')).toHaveCount(7);
  await expect(page.locator('.manual-status-row')).toHaveCount(0);

  // Name is pre-filled with the saved name
  await expect(page.locator('.smart-import .settings-input')).toHaveValue('RoundTrip');

  // Frame inputs should be pre-filled with the saved values before the user edits them
  const frameInputs = page.locator('.smart-import-frame-input');
  await expect(frameInputs.nth(0)).toHaveValue(originalFrameInputs.idle);

  // --- Step D: change the first status's frame range (idle) and save -------
  const idleInput = frameInputs.nth(0); // statusOrder[0] = idle
  await idleInput.clear();
  await idleInput.fill('3-4');
  await idleInput.blur();

  const editSaveBtn = page.locator('.creator-btn.save');
  await expect(editSaveBtn).toBeEnabled();
  await editSaveBtn.click();
  await expect(page.locator('.smart-import')).not.toBeVisible();

  // --- Step E: verify the store's meta reflects the edit -------------------
  const updatedMimes = await page.evaluate(async () => {
    const rid = await (window as any).__TAURI_INTERNALS__.invoke(
      'plugin:store|load', { path: 'settings.json' }
    );
    const val = await (window as any).__TAURI_INTERNALS__.invoke(
      'plugin:store|get', { rid, key: 'customMimes' }
    );
    return val ? val[0] : null;
  });
  expect(updatedMimes).toHaveLength(1);
  expect(updatedMimes[0].id).toBe(mimeId); // same id, in-place update
  expect(updatedMimes[0].name).toBe('RoundTrip');
  expect(updatedMimes[0].smartImportMeta).toBeDefined();
  expect(updatedMimes[0].smartImportMeta.frameInputs.idle).toBe('3-4');

  // Other statuses should be preserved from original
  for (const status of ['busy', 'service', 'disconnected', 'searching', 'initializing', 'visiting']) {
    expect(updatedMimes[0].smartImportMeta.frameInputs[status]).toBe(originalFrameInputs[status]);
  }

  // --- Step F: verify the update wrote the source sheet again --------------
  const reWroteSource = await page.evaluate((id: string) => {
    const files = (window as any).__MOCK_WRITTEN_FILES__ || [];
    return files.some((f: any) => new RegExp(`${id}-source\\.png$`).test(f.path ?? ''));
  }, mimeId);
  expect(reWroteSource).toBe(true);
});

// ---------------------------------------------------------------------------
// 13c. Imported .animime mime (no smart meta) opens Manual editor on edit
// ---------------------------------------------------------------------------
test('imported .animime mime (no smart meta) opens Manual editor on edit', async ({ page }) => {
  await loadWithMock(page, '/settings.html');

  // Navigate to Mime tab first
  await page.click('.sidebar-item:nth-child(2)');
  await expect(page.locator('.settings-title')).toHaveText('Mime');

  // Inject a manual-style mime (no smartImportMeta) via event
  await page.evaluate(() => {
    const mimes = [{
      id: 'custom-imported-1',
      name: 'FromAnimime',
      sprites: {
        idle:          { fileName: 'custom-imported-1-idle.png',          frames: 3 },
        busy:          { fileName: 'custom-imported-1-busy.png',          frames: 3 },
        service:       { fileName: 'custom-imported-1-service.png',       frames: 3 },
        disconnected:  { fileName: 'custom-imported-1-disconnected.png',  frames: 3 },
        searching:     { fileName: 'custom-imported-1-searching.png',     frames: 3 },
        initializing:  { fileName: 'custom-imported-1-initializing.png',  frames: 3 },
        visiting:      { fileName: 'custom-imported-1-visiting.png',      frames: 3 },
      },
    }];
    (window as any).__TEST_SEED_STORE__('settings.json', 'customMimes', mimes);
    (window as any).__TEST_EMIT__('custom-mimes-changed', mimes);
  });

  // The mime should appear
  await expect(page.locator('.pet-card-wrapper .pet-name', { hasText: 'FromAnimime' })).toBeVisible();

  // Hover to reveal edit button, then click it
  const fromAnimimeWrapper = page.locator('.pet-card-wrapper', {
    has: page.locator('.pet-name', { hasText: 'FromAnimime' }),
  });
  await fromAnimimeWrapper.hover();
  await page.click('[data-testid="edit-mime-custom-imported-1"]');

  // Manual editor is visible (not Smart Import)
  await expect(page.locator('.manual-status-row').first()).toBeVisible();
  await expect(page.locator('.manual-status-row')).toHaveCount(7);
  await expect(page.locator('.smart-import-frame-assign')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 14. Export Charlotte as .animime file
// ---------------------------------------------------------------------------
test('export Charlotte mime as .animime file', async ({ page }) => {
  await loadWithMock(page, '/settings.html');

  const mimeId = 'custom-1776007930810';
  const charlotte = {
    id: mimeId,
    name: 'Charlotte',
    sprites: {
      idle:          { fileName: `${mimeId}-idle.png`,          frames: 12 },
      busy:          { fileName: `${mimeId}-busy.png`,          frames: 38 },
      service:       { fileName: `${mimeId}-service.png`,       frames: 11 },
      disconnected:  { fileName: `${mimeId}-disconnected.png`,  frames: 7 },
      searching:     { fileName: `${mimeId}-searching.png`,     frames: 8 },
      initializing:  { fileName: `${mimeId}-initializing.png`,  frames: 5 },
      visiting:      { fileName: `${mimeId}-visiting.png`,      frames: 24 },
    },
  };

  // Load real Charlotte sprite PNGs and inject as mock file map
  const spritesDir = path.resolve(
    os.homedir(),
    'Library/Application Support/com.vietnguyenwsilentium.ani-mime/custom-sprites',
  );
  const fileMap: Record<string, string> = {};
  for (const [status, info] of Object.entries(charlotte.sprites)) {
    const filePath = path.join(spritesDir, (info as any).fileName);
    fileMap[(info as any).fileName] = readFileSync(filePath).toString('base64');
  }

  await page.evaluate(({ fileMap, mimeId }) => {
    // Inject per-file read map (base64 → Uint8Array)
    const map: Record<string, Uint8Array> = {};
    for (const [name, b64] of Object.entries(fileMap)) {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      map[name] = bytes;
    }
    (window as any).__MOCK_READ_FILE_MAP__ = map;

    // Mock save dialog to return a path
    (window as any).__MOCK_SAVE_DIALOG_RESULT__ = `/mock/export/Charlotte.animime`;
  }, { fileMap, mimeId });

  // Navigate to Mime tab
  await page.click('.sidebar-item:nth-child(2)');
  await expect(page.locator('.settings-title')).toHaveText('Mime');

  // Inject Charlotte into custom mimes
  await page.evaluate((data) => {
    (window as any).__TEST_EMIT__('custom-mimes-changed', [data]);
  }, charlotte);

  // Charlotte should appear in the custom section
  await expect(page.locator('.pet-card-wrapper .pet-name', { hasText: 'Charlotte' })).toBeVisible();

  // Hover to reveal export button, then click it
  const charlotteWrapper = page.locator('.pet-card-wrapper', {
    has: page.locator('.pet-name', { hasText: 'Charlotte' }),
  });
  await charlotteWrapper.hover();
  await page.click(`[data-testid="export-mime-${mimeId}"]`);

  // Wait for export to complete — writeFile should have been called
  await page.waitForFunction(() => {
    const files = (window as any).__MOCK_WRITTEN_FILES__;
    return files && files.length > 0;
  });

  // Read and verify the exported .animime data
  const exported = await page.evaluate(() => {
    const files = (window as any).__MOCK_WRITTEN_FILES__;
    const last = files[files.length - 1];
    const raw = last.contents;
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(Object.values(raw) as number[]);
    const text = new TextDecoder().decode(bytes);
    return { path: last.path, json: JSON.parse(text) };
  });

  // Verify export path
  expect(exported.path).toContain('Charlotte.animime');

  // Verify .animime structure
  expect(exported.json.version).toBe(1);
  expect(exported.json.name).toBe('Charlotte');

  // Verify all 7 statuses with correct frame counts
  const expectedFrames: Record<string, number> = {
    idle: 12, busy: 38, service: 11, disconnected: 7,
    searching: 8, initializing: 5, visiting: 24,
  };
  for (const [status, frames] of Object.entries(expectedFrames)) {
    expect(exported.json.sprites[status]).toBeDefined();
    expect(exported.json.sprites[status].frames).toBe(frames);
    // Each sprite should have non-empty base64 data
    expect(exported.json.sprites[status].data.length).toBeGreaterThan(0);
  }
});

// ---------------------------------------------------------------------------
// 15. Delete Charlotte custom mime
// ---------------------------------------------------------------------------
test('delete Charlotte custom mime', async ({ page }) => {
  await loadWithMock(page, '/settings.html');

  const mimeId = 'custom-1776007930810';
  const charlotte = {
    id: mimeId,
    name: 'Charlotte',
    sprites: {
      idle:          { fileName: `${mimeId}-idle.png`,          frames: 12 },
      busy:          { fileName: `${mimeId}-busy.png`,          frames: 38 },
      service:       { fileName: `${mimeId}-service.png`,       frames: 11 },
      disconnected:  { fileName: `${mimeId}-disconnected.png`,  frames: 7 },
      searching:     { fileName: `${mimeId}-searching.png`,     frames: 8 },
      initializing:  { fileName: `${mimeId}-initializing.png`,  frames: 5 },
      visiting:      { fileName: `${mimeId}-visiting.png`,      frames: 24 },
    },
  };

  // Navigate to Mime tab
  await page.click('.sidebar-item:nth-child(2)');
  await expect(page.locator('.settings-title')).toHaveText('Mime');

  // Inject Charlotte into custom mimes
  await page.evaluate((data) => {
    (window as any).__TEST_EMIT__('custom-mimes-changed', [data]);
  }, charlotte);
  await expect(page.locator('.pet-card-wrapper .pet-name', { hasText: 'Charlotte' })).toBeVisible();

  // Hover to reveal delete button, then click it
  const charlotteWrapper = page.locator('.pet-card-wrapper', {
    has: page.locator('.pet-name', { hasText: 'Charlotte' }),
  });
  await charlotteWrapper.hover();
  await page.click(`[data-testid="delete-mime-${mimeId}"]`);

  // Charlotte should be gone
  await expect(page.locator('.pet-card-wrapper .pet-name', { hasText: 'Charlotte' })).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// 16. Import Charlotte from .animime file
// ---------------------------------------------------------------------------
test('import Charlotte from .animime file', async ({ page }) => {
  await loadWithMock(page, '/settings.html');

  const charlotte = {
    idle:          { frames: 12 },
    busy:          { frames: 38 },
    service:       { frames: 11 },
    disconnected:  { frames: 7 },
    searching:     { frames: 8 },
    initializing:  { frames: 5 },
    visiting:      { frames: 24 },
  };

  // Build .animime payload from real Charlotte sprite files
  const spritesDir = path.resolve(
    os.homedir(),
    'Library/Application Support/com.vietnguyenwsilentium.ani-mime/custom-sprites',
  );
  const mimeId = 'custom-1776007930810';
  const animimeSprites: Record<string, { frames: number; data: string }> = {};
  for (const [status, info] of Object.entries(charlotte)) {
    const fileName = `${mimeId}-${status}.png`;
    const b64 = readFileSync(path.join(spritesDir, fileName)).toString('base64');
    animimeSprites[status] = { frames: info.frames, data: b64 };
  }
  const animimePayload = JSON.stringify({ version: 1, name: 'Charlotte', sprites: animimeSprites });

  // Set up mocks: dialog returns .animime path, readFile returns the payload bytes
  await page.evaluate((payload: string) => {
    (window as any).__MOCK_DIALOG_RESULT__ = '/mock/import/Charlotte.animime';
    const encoder = new TextEncoder();
    (window as any).__MOCK_READ_FILE_BYTES__ = encoder.encode(payload);
  }, animimePayload);

  // Navigate to Mime tab
  await page.click('.sidebar-item:nth-child(2)');
  await expect(page.locator('.settings-title')).toHaveText('Mime');

  // Click import .animime button
  await page.click('[data-testid="import-animime-btn"]');

  // Charlotte should appear in the mime list
  await expect(page.locator('.pet-card-wrapper .pet-name', { hasText: 'Charlotte' })).toBeVisible();

  // Verify the imported mime was stored with correct frame counts
  const storedMimes = await page.evaluate(() => {
    return new Promise<any>((resolve) => {
      (window as any).__TAURI_INTERNALS__.invoke('plugin:store|load', { path: 'settings.json' })
        .then((rid: number) => (window as any).__TAURI_INTERNALS__.invoke('plugin:store|get', { rid, key: 'customMimes' }))
        .then((val: any) => resolve(val ? val[0] : null));
    });
  });

  expect(storedMimes).toBeTruthy();
  expect(storedMimes.length).toBe(1);
  expect(storedMimes[0].name).toBe('Charlotte');

  const expectedFrames: Record<string, number> = {
    idle: 12, busy: 38, service: 11, disconnected: 7,
    searching: 8, initializing: 5, visiting: 24,
  };
  for (const [status, frames] of Object.entries(expectedFrames)) {
    expect(storedMimes[0].sprites[status].frames).toBe(frames);
  }
});

// ---------------------------------------------------------------------------
// 17. Window auto-resizes to fit sprite content
// ---------------------------------------------------------------------------
test('window resizes to match sprite content, not fixed 500x220', async ({ page }) => {
  await loadWithMock(page);

  // Wait for initial render and auto-size
  await expect(page.locator('[data-testid="app-container"]')).toBeVisible();

  // Wait for at least one setSize call from the ResizeObserver
  await page.waitForFunction(() => {
    const sizes = (window as any).__MOCK_WINDOW_SIZES__;
    return sizes && sizes.length > 0;
  });

  const lastSize = await page.evaluate(() => {
    const sizes = (window as any).__MOCK_WINDOW_SIZES__;
    const last = sizes[sizes.length - 1];
    // Serialize through JSON to flatten class instances
    const parsed = JSON.parse(JSON.stringify(last.value));
    const logical = parsed.Logical ?? parsed;
    return { width: logical.width, height: logical.height };
  });

  // Window should NOT be the old hardcoded 500x220
  const isOldFixed = lastSize.width === 500 && lastSize.height === 220;
  expect(isOldFixed).toBe(false);

  // Window size should be positive and reasonable (content-driven)
  expect(lastSize.width).toBeGreaterThan(0);
  expect(lastSize.height).toBeGreaterThan(0);

  // The container's actual size should match what was sent to setSize
  const containerSize = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="app-container"]') as HTMLElement;
    return { width: el.offsetWidth, height: el.offsetHeight };
  });
  expect(lastSize.width).toBe(containerSize.width);
  expect(lastSize.height).toBe(containerSize.height);
});
