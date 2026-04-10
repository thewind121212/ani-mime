# Adding Features Guide

Step-by-step recipes for common feature additions. Follow these to maintain consistency with existing patterns.

## New UI Status

Example: adding a "compiling" status.

### Steps

1. **Frontend type** - `src/types/status.ts`:
   ```typescript
   export type Status = "idle" | "busy" | ... | "compiling";
   ```

2. **Sprite for every character** - `src/constants/sprites.ts`:
   ```typescript
   compiling: { file: "RottweilerCompile.png", frames: 10 },
   // ... for each character
   ```

3. **Status pill color** - `src/styles/status-pill.css`:
   ```css
   .dot-compiling { background-color: #00bcd4; }
   ```

4. **Status pill label** - `src/components/StatusPill.tsx`:
   ```typescript
   case "compiling": return { dot: "dot-compiling", label: "Compiling..." };
   ```

5. **Backend resolution** - `src-tauri/src/state.rs` in `resolve_ui_state()`:
   - Set priority relative to existing states

6. **Auto-freeze?** - If the status should freeze after 10s, add to `autoStopStatuses` in `sprites.ts`

7. **Trigger** - Add HTTP route or modify shell hook classification to trigger the new state

---

## New HTTP Endpoint

Example: adding a `GET /info` endpoint.

### Steps

1. **Add route** - `src-tauri/src/server.rs` in the request match:
   ```rust
   "/info" => {
       let st = state.lock().unwrap();
       let body = serde_json::json!({
           "version": env!("CARGO_PKG_VERSION"),
           "sessions": st.sessions.len(),
       });
       respond_json(&request, &body);
   }
   ```

2. **If mutating state** - lock `AppState`, mutate, then call `emit_if_changed()` if UI state may have changed

3. **CORS** - already handled globally (all responses include `Access-Control-Allow-Origin: *`)

---

## New Tauri Command

Example: adding a command the frontend can call.

### Steps

1. **Define in Rust** - `src-tauri/src/lib.rs`:
   ```rust
   #[tauri::command]
   fn my_command(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Result<String, String> {
       let st = state.lock().unwrap();
       Ok(st.current_ui.clone())
   }
   ```

2. **Register** - in the `invoke_handler` macro call in `lib.rs`:
   ```rust
   .invoke_handler(tauri::generate_handler![
       start_visit,
       my_command,  // add here
   ])
   ```

3. **Call from frontend**:
   ```typescript
   import { invoke } from "@tauri-apps/api/core";
   const result = await invoke<string>("my_command");
   ```

---

## New React Component

### Steps

1. **Create component** - `src/components/MyComponent.tsx`:
   ```typescript
   interface Props { /* ... */ }

   export default function MyComponent({ ... }: Props) {
     return <div className="my-component">...</div>;
   }
   ```

2. **Create styles** - `src/styles/my-component.css`
   - Use CSS variables from `theme.css` for colors
   - Import in the component file

3. **Add to parent** - compose in `App.tsx` or relevant parent

---

## New Hook

### Steps

1. **Create hook** - `src/hooks/useMyThing.ts`:
   ```typescript
   export function useMyThing() {
     const [value, setValue] = useState<T>(defaultValue);

     useEffect(() => {
       const unlisten = listen<T>("my-event", (e) => setValue(e.payload));
       return () => { unlisten.then(f => f()); };
     }, []);

     return value;
   }
   ```

2. **If persistent** - follow the Store pattern from `useTheme`:
   - Read from `Store("settings.json")` on mount
   - Write + emit on change
   - Listen for cross-window broadcast

---

## New Persistent Setting

Example: adding a "compact mode" toggle.

### Steps

1. **Create hook** - `src/hooks/useCompactMode.ts` following the persistent settings pattern (read/write Store, emit event)

2. **Add UI** - in `Settings.tsx` (General tab), add a toggle row

3. **Use in components** - import the hook where needed

4. **No backend changes needed** - settings are frontend-only

---

## New Character/Pet

See [Animation System - Adding a New Character](animation-system.md#adding-a-new-character).

---

## New Shell Support

Example: adding `nushell` support.

### Steps

1. **Create script** - `src-tauri/script/terminal-mirror.nu`
   - Must support: preexec/postexec hooks, heartbeat loop, PID guard, command classification
   - All HTTP calls: `curl -s --max-time 1 ... > /dev/null 2>&1 || true`
   - Prefix functions with `_tm_`

2. **Register in setup** - `src-tauri/src/setup/shell.rs`:
   - Add `ShellInfo` entry with RC file path, marker string, script filename
   - Add to `detect_shells()`

3. **Bundle the script** - `src-tauri/tauri.conf.json` in `bundle.resources`:
   ```json
   "resources": ["script/terminal-mirror.nu"]
   ```

4. **Test**: manually source the script, run commands, verify status changes

---

## New Window

Example: adding a "history" window.

### Steps

1. **Create HTML entry** - `history.html` (copy structure from `settings.html`)

2. **Create React entry** - `src/history-main.tsx` (mount your root component)

3. **Register in Vite** - `vite.config.ts` in `build.rollupOptions.input`:
   ```typescript
   history: resolve(__dirname, "history.html"),
   ```

4. **Register in Tauri** - `src-tauri/tauri.conf.json` in `app.windows`:
   ```json
   { "label": "history", "url": "history.html", "visible": false, ... }
   ```

5. **Open from Rust** - use `app.get_webview_window("history").unwrap().show()`

6. **Theme sync** - include `useTheme` in your root component to respect theme settings

---

## Checklist for Any Feature

- [ ] Does it affect status resolution? → Update `resolve_ui_state()`
- [ ] Does it need persistence? → Use Tauri Store pattern
- [ ] Does it emit events? → Document in events-reference.md
- [ ] Does it add constants? → Document in constants-reference.md
- [ ] Does it touch shell scripts? → Update ALL three shells (zsh, bash, fish)
- [ ] Does it add a new dependency? → Justify why existing deps can't do it
- [ ] Keep frontend and backend status strings in sync (no codegen yet)
