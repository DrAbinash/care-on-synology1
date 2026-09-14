import { FindingsHighlightEditor } from "@/components/FindingsHighlightEditor";
import { useWorkspace } from "@/lib/zai-workspace/store";

/**
 * Live findings highlight editor — keeps caret/value in sync on every keystroke
 * without forcing the reporting workspace shell to subscribe to findingsText.
 */
export function ConnectedFindingsHighlightEditor({
  placeholder,
  className,
  disabled,
  dataEditor = "findings",
}: {
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  dataEditor?: string;
}) {
  const value = useWorkspace((s) => s.findingsText);
  const setField = useWorkspace((s) => s.setField);
  return (
    <FindingsHighlightEditor
      value={value}
      onChange={(v) => setField("findings", v)}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      dataEditor={dataEditor}
    />
  );
}
