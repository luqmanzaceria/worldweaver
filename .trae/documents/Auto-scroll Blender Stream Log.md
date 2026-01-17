I will implement auto-scrolling for the Blender stream log in `GenerationPanel.tsx`.

### Plan:
1.  **Ref**: Create a `useRef` for the log container div (`scrollRef`).
2.  **Effect**: Add a `useEffect` that triggers whenever the `events` array changes.
3.  **Scroll Logic**: Inside the effect, set `scrollRef.current.scrollTop = scrollRef.current.scrollHeight` to scroll to the bottom.
4.  **Attach**: Attach the `ref` to the scrollable container div.

This ensures that as new generation events arrive, the view automatically keeps the latest event visible.
