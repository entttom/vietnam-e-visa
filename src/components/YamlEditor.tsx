import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { EditorView } from '@codemirror/view';
import { githubDark, githubLight } from '@uiw/codemirror-theme-github';
import { cn } from '@/lib/utils';

function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPrefersDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return prefersDark;
}

function useElementHeight(enabled: boolean): {
  ref: RefObject<HTMLDivElement | null>;
  height: number | null;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setHeight(null);
      return;
    }

    const element = ref.current;
    if (!element) return;

    const update = () => {
      const next = element.getBoundingClientRect().height;
      setHeight(next > 0 ? Math.floor(next) : null);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);

  return { ref, height };
}

type YamlEditorProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  height?: string;
  fill?: boolean;
  readOnly?: boolean;
};

export type YamlEditorHandle = {
  focusAtOffset: (offset: number) => void;
};

export const YamlEditor = forwardRef<YamlEditorHandle, YamlEditorProps>(function YamlEditor(
  { value, onChange, className, height = '520px', fill = false, readOnly = false },
  ref
) {
  const prefersDark = usePrefersDark();
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const { ref: containerRef, height: measuredHeight } = useElementHeight(fill);

  const editorHeight = fill
    ? measuredHeight !== null
      ? `${measuredHeight}px`
      : '100%'
    : height;

  useImperativeHandle(ref, () => ({
    focusAtOffset(offset: number) {
      const view = cmRef.current?.view;
      if (!view) return;

      const pos = Math.min(Math.max(0, offset), view.state.doc.length);
      view.dispatch({
        selection: { anchor: pos, head: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      });
      view.focus();
    },
  }));

  const extensions = useMemo(
    () => [
      yaml(),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': { fontSize: '13px' },
        '.cm-scroller': {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        },
        '.cm-content': { padding: '12px 0' },
        '.cm-gutters': { borderRight: '1px solid var(--border)' },
      }),
    ],
    []
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        'overflow-hidden rounded-md border border-input bg-background shadow-sm',
        fill && 'h-full max-h-full min-h-0',
        className
      )}
    >
      {(!fill || measuredHeight !== null) && (
        <CodeMirror
          ref={cmRef}
          value={value}
          height={editorHeight}
          maxHeight={fill && measuredHeight !== null ? `${measuredHeight}px` : undefined}
          theme={prefersDark ? githubDark : githubLight}
          extensions={extensions}
          onChange={onChange}
          readOnly={readOnly}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            indentOnInput: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
          }}
        />
      )}
    </div>
  );
});
